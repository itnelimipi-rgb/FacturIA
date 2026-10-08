import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { createConfiguredAuth } from '../src/server/auth';
import { WorkspaceRepository } from '../src/server/workspaceRepository';

const baseURL = 'http://localhost:43210';
const password = 'Only-Local-Tests-Passphrase-2026!';
const db = new PGlite();
const query = (sql: string, values?: unknown[]) => db.query(sql, values);
const database = {
  options: {}, query, connect: async () => ({ query, release() {} }), async end() {}
} as unknown as Pool;
const secret = randomBytes(48).toString('base64');
const auth = createConfiguredAuth({ database, baseURL, secret, allowSignUp: true });
const closedAuth = createConfiguredAuth({ database, baseURL, secret, allowSignUp: false });
const repository = new WorkspaceRepository(database);
let clientNumber = 0;

before(async () => {
  await db.waitReady;
  await db.exec(await readFile(path.resolve('db/migrations/001_workspace.sql'), 'utf8'));
});
beforeEach(async () => {
  clientNumber++;
  await db.exec('TRUNCATE TABLE "user" CASCADE');
});
after(async () => { await db.close(); });

function request(endpoint: string, body?: Record<string, unknown>, cookie?: string, origin = baseURL): Request {
  const headers = new Headers({ origin, 'x-forwarded-for': `192.0.2.${clientNumber}` });
  if (cookie) headers.set('cookie', cookie);
  if (body) headers.set('content-type', 'application/json');
  return new Request(`${baseURL}/api/auth/${endpoint}`, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined
  });
}
function cookieFrom(response: Response): string {
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}
async function signUp(email = 'user@example.test') {
  const response = await auth.handler(request('sign-up/email', { email, password, name: 'Local test account' }));
  assert.equal(response.status, 200, `sign-up failed: ${await response.clone().text()}`);
  const cookie = cookieFrom(response);
  assert.ok(cookie.includes('session_token='));
  const payload = await response.json() as { user: { id: string; email: string }; token: string };
  return { cookie, user: payload.user };
}

 test('registration creates a hashed credential, a database session and usable HTTP cookie', async () => {
  const { cookie, user } = await signUp();
  assert.ok(user.id);
  assert.equal(user.email, 'user@example.test');
  const credentials = await db.query<{ password: string; providerId: string; userId: string }>('SELECT password,"providerId","userId" FROM account WHERE "userId"=$1', [user.id]);
  assert.equal(credentials.rows[0].providerId, 'credential');
  assert.ok(credentials.rows[0].password);
  assert.notEqual(credentials.rows[0].password, password);
  const response = await auth.handler(request('get-session', undefined, cookie));
  assert.equal(response.status, 200);
  const session = await response.json() as { user: { id: string }; session: { userId: string } };
  assert.equal(session.user.id, user.id);
  assert.equal(session.session.userId, user.id);
  const sessions = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM session WHERE "userId"=$1', [user.id]);
  assert.equal(sessions.rows[0].count, 1);
});

test('correct credentials log in; wrong password and nonexistent accounts are rejected', async () => {
  await signUp();
  const wrong = await auth.handler(request('sign-in/email', { email: 'user@example.test', password: `${password}-wrong` }));
  assert.equal(wrong.status, 401);
  const missing = await auth.handler(request('sign-in/email', { email: 'missing@example.test', password }));
  assert.equal(missing.status, 401);
  const correct = await auth.handler(request('sign-in/email', { email: 'user@example.test', password }));
  assert.equal(correct.status, 200);
  assert.ok(cookieFrom(correct).includes('session_token='));
});

test('weak passwords and explicitly disabled registration are rejected without creating users', async () => {
  const weak = await auth.handler(request('sign-up/email', { email: 'weak@example.test', password: 'short', name: 'Weak account' }));
  assert.equal(weak.status, 400);
  const closed = await closedAuth.handler(request('sign-up/email', { email: 'closed@example.test', password, name: 'Closed account' }));
  assert.equal(closed.status, 400);
  const users = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM "user"');
  assert.equal(users.rows[0].count, 0);
});

test('foreign origins and cross-site requests cannot register or sign out an authenticated user', async () => {
  const blocked = await auth.handler(request('sign-up/email', { email: 'blocked@example.test', password, name: 'Blocked account' }, undefined, 'https://untrusted.example'));
  assert.equal(blocked.status, 403);
  const { cookie, user } = await signUp();
  const foreignSignOut = await auth.handler(request('sign-out', {}, cookie, 'https://untrusted.example'));
  assert.equal(foreignSignOut.status, 403);
  const crossSite = request('sign-out', {}, cookie);
  crossSite.headers.delete('origin');
  crossSite.headers.set('sec-fetch-site', 'cross-site');
  const csrf = await auth.handler(crossSite);
  assert.equal(csrf.status, 403);
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  assert.equal(session!.user.id, user.id);
});

test('sign-out revokes the database session and the old cookie can no longer authenticate', async () => {
  const { cookie } = await signUp();
  const response = await auth.handler(request('sign-out', {}, cookie));
  assert.equal(response.status, 200);
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie }) }), null);
  const session = await auth.handler(request('get-session', undefined, cookie));
  assert.equal(await session.json(), null);
  const rows = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM session');
  assert.equal(rows.rows[0].count, 0);
});

test('authenticated session identities isolate the corresponding PostgreSQL workspaces', async () => {
  const first = await signUp('first@example.test');
  const second = await signUp('second@example.test');
  const firstSession = await auth.api.getSession({ headers: new Headers({ cookie: first.cookie }) });
  const secondSession = await auth.api.getSession({ headers: new Headers({ cookie: second.cookie }) });
  assert.notEqual(firstSession!.user.id, secondSession!.user.id);
  await repository.saveProfile(firstSession!.user.id, { rfc: 'GARM900101XYZ', businessName: 'First company', regimeCode: '626' });
  await repository.saveProfile(secondSession!.user.id, { rfc: 'PEPJ800101ABC', businessName: 'Second company', regimeCode: '612' });
  assert.equal((await repository.get(firstSession!.user.id)).profile!.businessName, 'First company');
  assert.equal((await repository.get(secondSession!.user.id)).profile!.businessName, 'Second company');
  const unknown = await auth.handler(request('get-session'));
  assert.equal(await unknown.json(), null);
});
