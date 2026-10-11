import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {before, beforeEach, afterEach, after, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {getPool} from '../src/server/db';
import {HttpError} from '../src/server/http';
import {mailConfigured, sendAuthMail, type AuthMail} from '../src/server/mail';
import {applyTestMigrations} from './helpers/migrations';
import {databaseRateLimit} from '../src/server/rateLimit';

const baseURL = 'http://localhost:43215';
const keys = ['MAIL_PROVIDER', 'RESEND_API_KEY', 'EMAIL_FROM', 'MAIL_DAILY_LIMIT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASSWORD', 'BETTER_AUTH_URL', 'DATABASE_URL', 'BETTER_AUTH_SECRET'] as const;
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const realFetch = globalThis.fetch;
const realTimeout = AbortSignal.timeout;
const syntheticKey = `re_${randomBytes(24).toString('hex')}`;
const syntheticSecret = randomBytes(48).toString('base64');
process.env.DATABASE_URL = 'postgres://unused.test/never-connected';
process.env.BETTER_AUTH_URL = baseURL;
process.env.BETTER_AUTH_SECRET = syntheticSecret;
const db = new PGlite();
const pool = getPool();
const query = (sql: string, values?: unknown[]) => db.query(sql, values);
pool.query = query as unknown as Pool['query'];
pool.connect = (async () => ({query, release() {}})) as unknown as Pool['connect'];
const mail: AuthMail = {to: 'recipient@example.test', kind: 'verification', url: `${baseURL}/api/auth/verify-email?token=synthetic-token`};
const hasStatus = (status: number) => (error: unknown) => error instanceof HttpError && error.status === status;
const unavailable = (error: unknown) => error instanceof Error && error.message === 'AuthMailDeliveryError' && !error.message.includes(syntheticKey);
function restoreEnvironment() {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}
before(async () => {await db.waitReady; await applyTestMigrations(db);});
beforeEach(async () => {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {DATABASE_URL: 'postgres://unused.test/never-connected', BETTER_AUTH_URL: baseURL, BETTER_AUTH_SECRET: syntheticSecret,
    MAIL_PROVIDER: 'resend', RESEND_API_KEY: syntheticKey, EMAIL_FROM: 'auth@example.test', MAIL_DAILY_LIMIT: '100'});
  globalThis.fetch = (async () => {throw new Error('Unexpected network call in isolated mail tests');}) as typeof fetch;
  await db.exec('TRUNCATE TABLE app_rate_limits');
});
afterEach(() => {globalThis.fetch = realFetch; AbortSignal.timeout = realTimeout; restoreEnvironment();});
after(async () => {globalThis.fetch = realFetch; restoreEnvironment(); await pool.end(); await db.close();});

test('disabled or incomplete providers cannot send mail or consume quota', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {calls++; return new Response('{}');}) as typeof fetch;
  for (const provider of ['disabled', 'unknown', 'smtp']) {
    process.env.MAIL_PROVIDER = provider;
    assert.equal(mailConfigured(), false);
    await assert.rejects(sendAuthMail(mail), hasStatus(503));
  }
  process.env.MAIL_PROVIDER = 'resend';
  delete process.env.RESEND_API_KEY;
  assert.equal(mailConfigured(), false);
  await assert.rejects(sendAuthMail(mail), hasStatus(503));
  process.env.RESEND_API_KEY = syntheticKey;
  process.env.EMAIL_FROM = 'invalid sender';
  assert.equal(mailConfigured(), false);
  await assert.rejects(sendAuthMail(mail), hasStatus(503));
  assert.equal(calls, 0);
  assert.equal((await db.query<{count: number}>('SELECT count(*)::int AS count FROM app_rate_limits')).rows[0].count, 0);
});

test('mail origin, recipient and daily limit are validated before transport or quota consumption', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {calls++; return new Response('{}');}) as typeof fetch;
  for (const invalid of [{...mail, url: 'https://untrusted.example/verify'}, {...mail, to: 'recipient@example.test\r\nBcc: attacker@example.test'}]) {
    await assert.rejects(sendAuthMail(invalid), (error: unknown) => error instanceof Error && error.message === 'Invalid authentication mail');
  }
  for (const limit of ['0', '101', '1.5', 'NaN']) {
    process.env.MAIL_DAILY_LIMIT = limit;
    await assert.rejects(sendAuthMail(mail), (error: unknown) => error instanceof Error && error.message === 'Invalid mail daily limit');
  }
  assert.equal(calls, 0);
  assert.equal((await db.query<{count: number}>('SELECT count(*)::int AS count FROM app_rate_limits')).rows[0].count, 0);
});

test('Resend uses one fixed HTTPS URL, structured mail, bounded signal and secret only in authorization', async () => {
  let captured: RequestInit | undefined;
  let timeoutMs: number | undefined;
  AbortSignal.timeout = delay => {timeoutMs = delay; return realTimeout.call(AbortSignal, delay);};
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(url, 'https://api.resend.com/emails');
    captured = options;
    return new Response('{"id":"synthetic-provider-id"}', {status: 200, headers: {'content-type': 'application/json'}});
  }) as typeof fetch;
  assert.equal(mailConfigured(), true);
  await sendAuthMail(mail);
  assert.equal(captured?.method, 'POST');
  assert.equal(captured?.redirect, 'error');
  assert.ok(captured?.signal instanceof AbortSignal);
  assert.equal(timeoutMs, 12000);
  const headers = new Headers(captured?.headers);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('authorization'), `Bearer ${syntheticKey}`);
  assert.equal(headers.get('idempotency-key'), createHash('sha256').update(JSON.stringify(mail)).digest('hex'));
  const body = JSON.parse(String(captured?.body)) as {from: string; to: string[]; subject: string; text: string};
  assert.equal(body.from, 'auth@example.test');
  assert.deepEqual(body.to, ['recipient@example.test']);
  assert.equal(body.subject, 'FacturIA · Verifica tu correo');
  assert.ok(body.text.includes(mail.url));
  assert.ok(!String(captured?.body).includes(syntheticKey));
  assert.ok(!String(captured?.body).includes(syntheticSecret));
  assert.equal(Object.keys(body).sort().join(','), 'from,subject,text,to');
});

test('equivalent retry requests use the same provider idempotency key while different links get different keys', async () => {
  const keys: string[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, options?: RequestInit) => {
    keys.push(new Headers(options?.headers).get('idempotency-key')!);
    return new Response('{}', {status: 200});
  }) as typeof fetch;
  await sendAuthMail(mail);
  await sendAuthMail({...mail});
  await sendAuthMail({...mail, kind: 'password-reset', url: `${baseURL}/api/auth/reset-password/another-synthetic-token`});
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
  assert.ok(keys.every(key => /^[a-f0-9]{64}$/.test(key)));
});

test('provider rejection, redirects and transport exceptions return sanitized errors and never echo the key', async () => {
  for (const status of [400, 401, 429, 500, 302]) {
    globalThis.fetch = (async () => new Response(`provider error with ${syntheticKey}`, {status})) as typeof fetch;
    await assert.rejects(sendAuthMail(mail), unavailable);
  }
  globalThis.fetch = (async () => {throw new Error(`transport details ${syntheticKey}`);}) as typeof fetch;
  await assert.rejects(sendAuthMail(mail), unavailable);
  globalThis.fetch = (async () => {throw new DOMException('synthetic timeout', 'TimeoutError');}) as typeof fetch;
  await assert.rejects(sendAuthMail(mail), unavailable);
});

test('daily limit is shared across recipients and mail kinds and survives limiter recreation', async () => {
  process.env.MAIL_DAILY_LIMIT = '2';
  let calls = 0;
  globalThis.fetch = (async () => {calls++; return new Response('{}', {status: 200});}) as typeof fetch;
  await sendAuthMail(mail);
  await sendAuthMail({...mail, to: 'another@example.test', kind: 'password-reset'});
  const recreated = databaseRateLimit(pool, 'auth-mail-daily');
  assert.equal((await recreated.consume('workspace', {max: 2, window: 86400})).allowed, false);
  await assert.rejects(sendAuthMail({...mail, to: 'third@example.test'}), hasStatus(429));
  assert.equal(calls, 2);
  const quota = await db.query<{key: string; count: number; seconds: number}>('SELECT key,count,extract(epoch FROM expires_at-window_started_at)::int AS seconds FROM app_rate_limits');
  assert.equal(quota.rows.length, 1);
  assert.equal(quota.rows[0].count, 3);
  assert.equal(quota.rows[0].seconds, 86400);
  assert.ok(/^[a-f0-9]{64}$/.test(quota.rows[0].key));
  assert.ok(!JSON.stringify(quota.rows).includes(mail.to));
});
