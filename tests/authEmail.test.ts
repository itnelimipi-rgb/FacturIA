import assert from 'node:assert/strict';
import {createHmac, randomBytes} from 'node:crypto';
import {before, beforeEach, after, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {createConfiguredAuth} from '../src/server/auth';
import {getPool} from '../src/server/db';
import {sendAuthMail, smtpConfigured, type AuthMail} from '../src/server/mail';
import {GET as accountFeatures} from '../src/app/api/account/features/route';
import {POST as publicAuthPost} from '../src/app/api/auth/[...all]/route';
import {applyTestMigrations} from './helpers/migrations';

const baseURL = 'http://localhost:43214';
const password = 'Only-Local-Mail-Tests-Passphrase-2026!';
const newPassword = 'Only-Local-Mail-Changed-Passphrase-2026!';
const secret = randomBytes(48).toString('base64');
const db = new PGlite();
const query = (sql: string, values?: unknown[]) => db.query(sql, values);
const database = {options: {}, query, connect: async () => ({query, release() {}}), async end() {}} as unknown as Pool;
const mails: AuthMail[] = [];
const auth = createConfiguredAuth({database, baseURL, secret, allowSignUp: true, requireEmailVerification: true, sendMail: async mail => {mails.push(mail);}});
let clientNumber = 0;
let publicPool: Pool | undefined;
before(async () => {await db.waitReady; await applyTestMigrations(db);});
beforeEach(async () => {
  clientNumber++; mails.length = 0;
  await db.exec('TRUNCATE TABLE "user" CASCADE; TRUNCATE TABLE app_rate_limits');
});
after(async () => {await publicPool?.end(); await db.close();});
function request(endpoint: string, body?: Record<string, unknown>, cookie?: string, origin = baseURL): Request {
  const headers = new Headers({origin, 'x-forwarded-for': `192.0.2.${clientNumber}`});
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`${baseURL}/api/auth/${endpoint}`, {method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body)});
}
function cookies(response: Response) {return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');}
function mail(kind: AuthMail['kind']) {
  const found = mails.findLast(item => item.kind === kind);
  assert.ok(found, `expected captured ${kind} mail`);
  return found;
}
async function signup(email = 'mail-owner@example.test') {
  const response = await auth.handler(request('sign-up/email', {name: 'Mail test account', email, password}));
  assert.equal(response.status, 200);
  const body = await response.json() as {user: {id: string}; token: string | null};
  return {id: body.user.id, email, cookie: cookies(response), token: body.token};
}
async function verify() {
  const target = new URL(mail('verification').url);
  assert.equal(target.origin, baseURL);
  const response = await auth.handler(request(`verify-email?token=${encodeURIComponent(target.searchParams.get('token')!)}`));
  assert.equal(response.status, 200);
  return response;
}
async function verifiedAccount(email = 'mail-owner@example.test') {
  const user = await signup(email);
  await verify();
  const response = await auth.handler(request('sign-in/email', {email, password}));
  assert.equal(response.status, 200);
  return {...user, cookie: cookies(response)};
}
async function resetToken(email = 'mail-owner@example.test') {
  const response = await auth.handler(request('request-password-reset', {email, redirectTo: `${baseURL}/workspace/reset-password`}));
  assert.equal(response.status, 200);
  const target = new URL(mail('password-reset').url);
  assert.equal(target.origin, baseURL);
  return target.pathname.split('/').at(-1)!;
}

test('mandatory email verification sends a captured link, blocks login and never automatically creates a session', async () => {
  const user = await signup();
  assert.equal(user.token, null);
  assert.ok(!user.cookie.includes('session_token='));
  assert.equal(mail('verification').to, user.email);
  const unverified = await auth.handler(request('sign-in/email', {email: user.email, password}));
  assert.equal(unverified.status, 403);
  const verified = await verify();
  assert.ok(!cookies(verified).includes('session_token='));
  const stored = await db.query<{emailVerified: boolean}>('SELECT "emailVerified" FROM "user" WHERE id=$1', [user.id]);
  assert.equal(stored.rows[0].emailVerified, true);
  await verify(); // Repeated verification is idempotent; it still creates no session.
  assert.equal((await db.query<{count: number}>('SELECT count(*)::int AS count FROM session')).rows[0].count, 0);
  const signedIn = await auth.handler(request('sign-in/email', {email: user.email, password}));
  assert.equal(signedIn.status, 200);
  assert.ok(cookies(signedIn).includes('session_token='));
});

test('tampered and expired verification JWTs cannot verify an account', async () => {
  const owner = await signup();
  const token = new URL(mail('verification').url).searchParams.get('token')!;
  const parts = token.split('.');
  const data = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  data.exp = Math.floor(Date.now() / 1000) - 30;
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
  const unsigned = `${parts[0]}.${encoded}`;
  const expired = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
  for (const candidate of [`${parts[0]}.${encoded}.invalid-signature`, expired]) {
    const response = await auth.handler(request(`verify-email?token=${encodeURIComponent(candidate)}`));
    assert.equal(response.status, 401);
  }
  const stored = await db.query<{emailVerified: boolean}>('SELECT "emailVerified" FROM "user" WHERE id=$1', [owner.id]);
  assert.equal(stored.rows[0].emailVerified, false);
});

test('password reset is single use, requires a strong password and revokes previous signed sessions', async () => {
  const owner = await verifiedAccount();
  const token = await resetToken();
  const weak = await auth.handler(request('reset-password', {token, newPassword: 'short'}));
  assert.equal(weak.status, 400);
  assert.ok(!(await weak.text()).includes(token));
  const response = await auth.handler(request('reset-password', {token, newPassword}));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {status: true});
  assert.equal(await auth.api.getSession({headers: new Headers({cookie: owner.cookie})}), null);
  assert.equal((await auth.handler(request('reset-password', {token, newPassword: password}))).status, 400);
  assert.equal((await auth.handler(request('sign-in/email', {email: owner.email, password}))).status, 401);
  const newLogin = await auth.handler(request('sign-in/email', {email: owner.email, password: newPassword}));
  assert.equal(newLogin.status, 200);
  assert.ok(cookies(newLogin).includes('session_token='));
});

test('expired reset credentials and unknown tokens cannot change the password', async () => {
  const owner = await verifiedAccount();
  const token = await resetToken();
  await db.query('UPDATE verification SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE identifier=$1', [`reset-password:${token}`]);
  for (const candidate of [token, 'unissued-synthetic-token']) {
    assert.equal((await auth.handler(request('reset-password', {token: candidate, newPassword}))).status, 400);
  }
  assert.equal((await auth.handler(request('sign-in/email', {email: owner.email, password}))).status, 200);
});

test('reset and verification requests do not reveal nonexistent accounts in their public response', async () => {
  await signup();
  for (const endpoint of ['request-password-reset', 'send-verification-email']) {
    const body = endpoint === 'request-password-reset' ? {redirectTo: `${baseURL}/workspace/reset-password`} : {callbackURL: `${baseURL}/workspace`};
    const existing = await auth.handler(request(endpoint, {email: 'mail-owner@example.test', ...body}));
    const missing = await auth.handler(request(endpoint, {email: 'mail-missing@example.test', ...body}));
    assert.equal(existing.status, missing.status);
    assert.deepEqual(await existing.json(), await missing.json());
    assert.ok(!mails.some(item => item.to === 'mail-missing@example.test'));
  }
});

test('foreign request origins and callback destinations cannot send or consume authentication credentials', async () => {
  await signup();
  const before = mails.length;
  for (const [endpoint, body] of [
    ['request-password-reset', {email: 'mail-owner@example.test', redirectTo: 'https://untrusted.example/reset'}],
    ['send-verification-email', {email: 'mail-owner@example.test', callbackURL: 'https://untrusted.example/verify'}],
  ] as const) {
    assert.equal((await auth.handler(request(endpoint, body))).status, 403);
    assert.equal((await auth.handler(request(endpoint, {...body, redirectTo: `${baseURL}/workspace`, callbackURL: `${baseURL}/workspace`}, 'synthetic-session-cookie=present', 'https://untrusted.example'))).status, 403);
  }
  assert.equal(mails.length, before);
  const token = new URL(mail('verification').url).searchParams.get('token')!;
  assert.equal((await auth.handler(request(`verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent('https://untrusted.example')}`))).status, 403);
});

test('disabled SMTP exposes false delivery availability and blocks public mail endpoints safely', async () => {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASSWORD', 'REQUIRE_EMAIL_VERIFICATION', 'DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, {DATABASE_URL: 'postgres://unused.test/never-connected', BETTER_AUTH_URL: baseURL, BETTER_AUTH_SECRET: secret});
    publicPool = getPool();
    publicPool.query = query as unknown as Pool['query'];
    publicPool.connect = (async () => ({query, release() {}})) as unknown as Pool['connect'];
    const features = accountFeatures();
    assert.equal((await features.json()).emailDeliveryEnabled, false);
    assert.equal(features.headers.get('cache-control'), 'no-store');
    for (const endpoint of ['request-password-reset', 'send-verification-email']) {
      const response = await publicAuthPost(request(endpoint, {email: 'mail-owner@example.test'}));
      assert.equal(response.status, 503);
      const body = await response.text();
      assert.ok(!body.includes(secret));
      assert.ok(!body.includes(password));
      assert.ok(!body.includes('mail-owner@example.test'));
      assert.ok(body.includes('El envío de correo todavía no está configurado.'));
    }
    assert.throws(() => createConfiguredAuth({database, baseURL, secret, requireEmailVerification: true}));
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('SMTP configuration is validated and foreign mail links fail without connecting or exposing credentials', async () => {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASSWORD', 'BETTER_AUTH_URL'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const smtpPassword = randomBytes(24).toString('hex');
  try {
    Object.assign(process.env, {SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_FROM: 'mail@example.test', SMTP_USER: 'synthetic-user', SMTP_PASSWORD: smtpPassword, BETTER_AUTH_URL: baseURL});
    assert.equal(smtpConfigured(), true);
    assert.equal((await accountFeatures().json()).emailDeliveryEnabled, true);
    await assert.rejects(sendAuthMail({to: 'recipient@example.test', kind: 'password-reset', url: 'https://untrusted.example/token'}), (error: unknown) => error instanceof Error && error.message === 'Invalid authentication mail' && !error.message.includes(smtpPassword));
    process.env.SMTP_PORT = '0';
    assert.equal(smtpConfigured(), false);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
