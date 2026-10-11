import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {before, beforeEach, after, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {getPool} from '../src/server/db';
import {POST as authPost} from '../src/app/api/auth/[...all]/route';
import {POST as uploadPost} from '../src/app/api/workspace/documents/provisional/route';
import {applyTestMigrations} from './helpers/migrations';

const baseURL = 'http://localhost:43230';
const environmentKeys = ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'ALLOW_SIGNUP', 'MAIL_PROVIDER', 'REQUIRE_EMAIL_VERIFICATION'] as const;
const previous = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
Object.assign(process.env, {DATABASE_URL: 'postgres://unused.test/never-connected', BETTER_AUTH_URL: baseURL,
  BETTER_AUTH_SECRET: randomBytes(48).toString('base64'), ALLOW_SIGNUP: 'true', MAIL_PROVIDER: 'disabled', REQUIRE_EMAIL_VERIFICATION: 'false'});
const db = new PGlite();
const pool = getPool();
const query = (sql: string, values?: unknown[]) => db.query(sql, values);
pool.query = query as unknown as Pool['query'];
pool.connect = (async () => ({query, release() {}})) as unknown as Pool['connect'];
let cookie: string;
let number = 0;
before(async () => {await db.waitReady; await applyTestMigrations(db);});
beforeEach(async () => {
  await db.exec('TRUNCATE TABLE "user" CASCADE; TRUNCATE TABLE app_rate_limits');
  const response = await authPost(new Request(`${baseURL}/api/auth/sign-up/email`, {method: 'POST',
    headers: {origin: baseURL, 'Content-Type': 'application/json', 'x-forwarded-for': `192.0.2.${++number}`},
    body: JSON.stringify({name: 'Upload boundary test', email: `upload-${number}@example.test`, password: 'Only-Local-Upload-Boundary-2026!'})}));
  assert.equal(response.status, 200);
  cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
});
after(async () => {
  await pool.end(); await db.close();
  for (const key of environmentKeys) {
    if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});

function request(body: ReadableStream<Uint8Array> | string, signal?: AbortSignal) {
  return new Request(`${baseURL}/api/workspace/documents/provisional`, {method: 'POST',
    headers: {origin: baseURL, cookie, 'Content-Type': 'multipart/form-data; boundary=boundary-test'},
    body, signal, ...typeof body === 'string' ? {} : {duplex: 'half'} as RequestInit});
}
function hangingBody({neverFinishCancel = false} = {}) {
  let started!: () => void;
  const reading = new Promise<void>(resolve => {started = resolve;});
  const body = new ReadableStream<Uint8Array>({
    pull() {started();},
    cancel() {if (neverFinishCancel) return new Promise<void>(() => {});},
  }, {highWaterMark: 0});
  return {body, reading};
}
async function noPartialWrite() {
  const rows = await db.query<{documents: number; files: number}>('SELECT (SELECT count(*)::int FROM app_documents) AS documents,(SELECT count(*)::int FROM app_document_files) AS files');
  assert.deepEqual(rows.rows[0], {documents: 0, files: 0});
}

test('aborting two unfinished bodies releases both global upload slots without writing records', async () => {
  const abort = new AbortController();
  const first = hangingBody(); const second = hangingBody();
  const pending = [uploadPost(request(first.body, abort.signal)), uploadPost(request(second.body, abort.signal))];
  try {
    await Promise.all([first.reading, second.reading]);
    assert.equal((await uploadPost(request('--boundary-test--'))).status, 429);
    abort.abort();
    assert.deepEqual((await Promise.all(pending)).map(response => response.status), [408, 408]);
    assert.equal((await uploadPost(request('--boundary-test--'))).status, 400, 'a new upload is admitted after cancellation');
    await noPartialWrite();
  } finally {abort.abort(); await Promise.allSettled(pending);}
});

test('a body timeout returns a controlled error and frees its slot without waiting for a malicious cancel callback', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const abort = new AbortController();
  const hanging = hangingBody({neverFinishCancel: true});
  const pending = uploadPost(request(hanging.body, abort.signal));
  try {
    await hanging.reading;
    context.mock.timers.tick(30_001);
    const response = await pending;
    assert.equal(response.status, 408);
    assert.match(await response.text(), /30 segundos/);
    assert.equal((await uploadPost(request('--boundary-test--'))).status, 400);
    await noPartialWrite();
  } finally {abort.abort(); context.mock.timers.reset(); await Promise.allSettled([pending]);}
});
