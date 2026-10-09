import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { getPool } from '../src/server/db';
import { POST as authPost } from '../src/app/api/auth/[...all]/route';
import { GET as workspaceGet, POST as workspacePost } from '../src/app/api/workspace/route';
import { GET as health } from '../src/app/api/health/route';
import { GET as workspaceExport } from '../src/app/api/workspace/export/route';
import { POST as workspaceRestore } from '../src/app/api/workspace/restore/route';
import { parseBankCsv } from '../src/lib/bankCsvParser';
import type { WorkspaceSnapshot } from '../src/server/workspaceRepository';
import type { createWorkspaceBackup } from '../src/lib/workspaceExport';

const baseURL = 'http://localhost:43211';
const keys = ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'ALLOW_SIGNUP'] as const;
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
process.env.DATABASE_URL = 'postgres://unused.test/never-connected';
process.env.BETTER_AUTH_URL = baseURL;
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString('base64');
process.env.ALLOW_SIGNUP = 'true';

const db = new PGlite();
const pool = getPool();
// Patch only the transport of this process's concrete Pool instance. Auth HTTP
// handlers, signed cookies, requireUser, schemas and SQL remain real. No network.
const query = (sql: string, values?: unknown[]) => db.query(sql, values);
pool.query = query as unknown as Pool['query'];
pool.connect = (async () => ({ query, release() {} })) as unknown as Pool['connect'];
let clientNumber = 0;
let rawXml: string;
let rawCsv: string;
const password = 'Only-Local-API-Tests-2026!';

before(async () => {
  await db.waitReady;
  await db.exec(await readFile(path.resolve('db/migrations/001_workspace.sql'), 'utf8'));
  rawXml = await readFile(path.resolve('tests/fixtures/sample-cfdi40.xml'), 'utf8');
  rawCsv = await readFile(path.resolve('tests/fixtures/sample-bank.csv'), 'utf8');
});
beforeEach(async () => {
  clientNumber++;
  await db.exec('TRUNCATE TABLE "user" CASCADE');
});
after(async () => {
  await db.close();
  await pool.end();
  for (const key of keys) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request(endpoint: string, body?: unknown, cookie?: string, origin = baseURL): Request {
  const headers = new Headers({origin, 'x-forwarded-for': `198.51.100.${clientNumber}`});
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`${baseURL}${endpoint}`, {method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body)});
}
async function register(email = 'first@example.test') {
  const response = await authPost(request('/api/auth/sign-up/email', {name: 'API test account', email, password}));
  assert.equal(response.status, 200, `signup: ${await response.clone().text()}`);
  const body = await response.json() as {user: {id: string}};
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.ok(cookie.includes('session_token='));
  return {id: body.user.id, cookie};
}
async function profile(cookie: string, rfc = 'XAXX010101000', businessName = 'Empresa de pruebas') {
  const response = await workspacePost(request('/api/workspace', {action: 'profile', profile: {rfc, businessName, regimeCode: '601'}}, cookie));
  assert.equal(response.status, 200, `profile: ${await response.clone().text()}`);
  return await response.json() as WorkspaceSnapshot;
}
async function read(cookie?: string) {
  return workspaceGet(request('/api/workspace', undefined, cookie));
}
async function xml(cookie: string, contents = rawXml) {
  return workspacePost(request('/api/workspace', {action: 'xml', rawXml: contents}, cookie));
}
async function csv(cookie: string, userId = 'spoofed-client-user', contents = rawCsv) {
  const parsed = parseBankCsv(contents, {userId, accountId: 'api-account'});
  assert.deepEqual(parsed.errors, []);
  return workspacePost(request('/api/workspace', {action: 'transactions', transactions: parsed.transactions}, cookie));
}

test('authenticated restore previews without writes and reowns a backup while preserving the destination profile', async () => {
  const first = await register('restore-source@example.test');
  const second = await register('restore-destination@example.test');
  await profile(first.cookie);
  const destination = await profile(second.cookie, 'XAXX010101000', 'Perfil destino conservado');
  await xml(first.cookie);
  await csv(first.cookie);
  const backup = await (await workspaceExport(request('/api/workspace/export', undefined, first.cookie))).json() as ReturnType<typeof createWorkspaceBackup>;
  backup.cfdis[0].statusSat = 'vigente';
  backup.cfdis[0].total = 999;
  const body = {action: 'preview', backup, userId: first.id};
  const preview = await workspaceRestore(request('/api/workspace/restore', body, second.cookie));
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('cache-control'), 'no-store');
  const summary = await preview.json();
  assert.equal(summary.preview.documents, 1);
  assert.equal(summary.preview.matchedTransactions, 1);
  assert.deepEqual(await (await read(second.cookie)).json(), destination);
  const response = await workspaceRestore(request('/api/workspace/restore', {...body, action: 'restore'}, second.cookie));
  assert.equal(response.status, 200);
  const restored = await response.json() as WorkspaceSnapshot;
  assert.deepEqual(restored.profile, destination.profile);
  assert.equal(restored.cfdis[0].userId, second.id);
  assert.equal(restored.cfdis[0].total, 116);
  assert.equal(restored.cfdis[0].statusSat, 'no_verificado');
  assert.equal(restored.transactions[0].matchedCfdiId, restored.cfdis[0].id);
  assert.equal((await workspaceRestore(request('/api/workspace/restore', {...body, action: 'restore'}, second.cookie))).status, 409);
  const exported = await (await workspaceExport(request('/api/workspace/export', undefined, second.cookie))).json() as ReturnType<typeof createWorkspaceBackup>;
  assert.equal(exported.cfdis[0].rawXml, rawXml);
  const original = await (await read(first.cookie)).json() as WorkspaceSnapshot;
  assert.equal(original.cfdis[0].userId, first.id);
  assert.notEqual(original.cfdis[0].id, restored.cfdis[0].id);
});

test('restore enforces authentication, same origin, existing profile and matching RFC', async () => {
  const first = await register('restore-owner@example.test');
  const second = await register('restore-other@example.test');
  await profile(first.cookie);
  await xml(first.cookie);
  const backup = await (await workspaceExport(request('/api/workspace/export', undefined, first.cookie))).json();
  const body = {action: 'restore', backup};
  assert.equal((await workspaceRestore(request('/api/workspace/restore', body))).status, 401);
  assert.equal((await workspaceRestore(request('/api/workspace/restore', body, second.cookie, 'https://evil.example'))).status, 403);
  assert.equal((await workspaceRestore(request('/api/workspace/restore', body, second.cookie))).status, 409);
  await profile(second.cookie, 'XEXX010101000');
  assert.equal((await workspaceRestore(request('/api/workspace/restore', body, second.cookie))).status, 400);
  const other = await (await read(second.cookie)).json() as WorkspaceSnapshot;
  assert.deepEqual(other.cfdis, []);
  assert.deepEqual(other.transactions, []);
});

test('invalid or oversized restore bodies fail without importing any records', async () => {
  const first = await register('restore-invalid-source@example.test');
  const second = await register('restore-invalid-destination@example.test');
  await profile(first.cookie);
  await profile(second.cookie);
  await xml(first.cookie);
  const backup = await (await workspaceExport(request('/api/workspace/export', undefined, first.cookie))).json() as ReturnType<typeof createWorkspaceBackup>;
  for (const invalid of [
    {...backup, mode: 'demo'},
    {...backup, cfdis: [{...backup.cfdis[0], rawXml: '<broken-xml/>'}]},
    {...backup, cfdis: [{...backup.cfdis[0], userId: second.id}]},
  ]) {
    const response = await workspaceRestore(request('/api/workspace/restore', {action: 'restore', backup: invalid}, second.cookie));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await (await read(second.cookie)).json() as WorkspaceSnapshot).cfdis, []);
  }
  const headers = new Headers({origin: baseURL, cookie: second.cookie, 'content-type': 'application/json', 'content-length': String(26 * 1024 * 1024)});
  const oversized = await workspaceRestore(new Request(`${baseURL}/api/workspace/restore`, {method: 'POST', headers, body: '{}'}));
  assert.equal(oversized.status, 413);
  assert.deepEqual((await (await read(second.cookie)).json() as WorkspaceSnapshot).transactions, []);
});

 test('authenticated HTTP workflow creates a profile, imports XML and CSV, reconciles and returns unverified SAT status', async () => {
  const user = await register();
  assert.equal((await read()).status, 401);
  const blank = await (await read(user.cookie)).json() as WorkspaceSnapshot;
  assert.equal(blank.profile, null);
  assert.deepEqual(blank.transactions, []);
  assert.equal((await profile(user.cookie)).profile!.id, user.id);
  const imported = await xml(user.cookie);
  assert.equal(imported.status, 200);
  const docs = await imported.json() as WorkspaceSnapshot;
  assert.equal(docs.cfdis[0].userId, user.id);
  assert.equal(docs.cfdis[0].statusSat, 'no_verificado');
  assert.equal(docs.cfdis[0].rawXml, undefined);
  const bankResponse = await csv(user.cookie);
  assert.equal(bankResponse.status, 200);
  const snapshot = await bankResponse.json() as WorkspaceSnapshot;
  assert.equal(snapshot.transactions[0].userId, user.id);
  assert.notEqual(snapshot.transactions[0].userId, 'spoofed-client-user');
  assert.equal(snapshot.transactions[0].status, 'conciliado');
  assert.equal(snapshot.transactions[0].matchedCfdiId, docs.cfdis[0].id);
  assert.match(snapshot.transactions[0].alertReason!, /SAT.*no está verificado/);
  const saved = await read(user.cookie);
  assert.equal(saved.headers.get('cache-control'), 'no-store');
  assert.equal((await saved.json() as WorkspaceSnapshot).transactions.length, 1);
});

test('two signed HTTP sessions expose only their own profiles, documents and bank movements', async () => {
  const first = await register();
  const second = await register('second@example.test');
  await profile(first.cookie);
  await profile(second.cookie, 'XEXX010101000', 'Segunda empresa');
  await xml(first.cookie);
  await csv(first.cookie);
  const firstData = await (await read(first.cookie)).json() as WorkspaceSnapshot;
  const secondData = await (await read(second.cookie)).json() as WorkspaceSnapshot;
  assert.equal(firstData.profile!.id, first.id);
  assert.equal(secondData.profile!.id, second.id);
  assert.equal(firstData.cfdis.length, 1);
  assert.equal(firstData.transactions.length, 1);
  assert.deepEqual(secondData.cfdis, []);
  assert.deepEqual(secondData.transactions, []);
  assert.equal((await xml(second.cookie)).status, 400);
});

test('duplicate XML produces controlled 409, reimported CSV is idempotent and failed import leaves the snapshot intact', async () => {
  const user = await register();
  await profile(user.cookie);
  assert.equal((await xml(user.cookie)).status, 200);
  const duplicate = await xml(user.cookie);
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), {error: 'Este registro ya existe'});
  assert.equal((await csv(user.cookie)).status, 200);
  assert.equal((await csv(user.cookie)).status, 200);
  const data = await (await read(user.cookie)).json() as WorkspaceSnapshot;
  assert.equal(data.cfdis.length, 1);
  assert.equal(data.transactions.length, 1);
});

test('foreign transaction IDs cannot be resolved, unmatched or resumed through the authenticated API', async () => {
  const first = await register();
  const second = await register('second@example.test');
  await profile(first.cookie);
  await profile(second.cookie, 'XEXX010101000');
  const document = await (await xml(first.cookie)).json() as WorkspaceSnapshot;
  const imported = await (await csv(first.cookie)).json() as WorkspaceSnapshot;
  const transactionId = imported.transactions[0].id;
  for (const action of ['unmatch', 'resolve', 'resumeReconciliation']) {
    const response = await workspacePost(request('/api/workspace', {action, transactionId, cfdiId: document.cfdis[0].id}, second.cookie));
    assert.equal(response.status, 404, action);
  }
  const original = await (await read(first.cookie)).json() as WorkspaceSnapshot;
  assert.equal(original.transactions[0].status, 'conciliado');
});

test('HTTP unmatch persists through GET and reimport until explicit resume restores a valid link', async () => {
  const user = await register();
  await profile(user.cookie);
  await xml(user.cookie);
  const initial = await (await csv(user.cookie)).json() as WorkspaceSnapshot;
  const transactionId = initial.transactions[0].id;
  const unlinked = await workspacePost(request('/api/workspace', {action: 'unmatch', transactionId}, user.cookie));
  assert.equal(unlinked.status, 200);
  assert.equal((await unlinked.json() as WorkspaceSnapshot).transactions[0].reconciliationLocked, true);
  await csv(user.cookie);
  const persisted = await (await read(user.cookie)).json() as WorkspaceSnapshot;
  assert.equal(persisted.transactions[0].status, 'discrepancia');
  assert.equal(persisted.transactions[0].matchedCfdiId, null);
  const resumed = await workspacePost(request('/api/workspace', {action: 'resumeReconciliation', transactionId}, user.cookie));
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json() as WorkspaceSnapshot).transactions[0].status, 'conciliado');
});

test('HTTP manual resolver assigns a shared candidate once and refuses subsequent reuse', async () => {
  const user = await register();
  await profile(user.cookie);
  const docs = await (await xml(user.cookie)).json() as WorkspaceSnapshot;
  const duplicatedRows = `${rawCsv.trim()}\n2026-10-01,Servicio de prueba,-116.00,MXN\n`;
  const imported = await (await csv(user.cookie, 'client-user', duplicatedRows)).json() as WorkspaceSnapshot;
  assert.deepEqual(imported.transactions.map(tx => tx.status), ['ambiguo', 'ambiguo']);
  const cfdiId = docs.cfdis[0].id;
  const resolved = await workspacePost(request('/api/workspace', {action: 'resolve', transactionId: imported.transactions[0].id, cfdiId}, user.cookie));
  assert.equal(resolved.status, 200);
  const data = await resolved.json() as WorkspaceSnapshot;
  assert.equal(data.transactions.filter(tx => tx.matchedCfdiId === cfdiId).length, 1);
  const reused = await workspacePost(request('/api/workspace', {action: 'resolve', transactionId: imported.transactions[1].id, cfdiId}, user.cookie));
  assert.equal(reused.status, 409);
});

test('HTTP workspace writes reject foreign origins and sign-out invalidates API access', async () => {
  const user = await register();
  const forbidden = await workspacePost(request('/api/workspace', {action: 'profile', profile: {rfc: 'XAXX010101000', businessName: 'Wrong origin', regimeCode: '601'}}, user.cookie, 'https://untrusted.example'));
  assert.equal(forbidden.status, 403);
  assert.equal((await (await read(user.cookie)).json() as WorkspaceSnapshot).profile, null);
  const logout = await authPost(request('/api/auth/sign-out', {}, user.cookie));
  assert.equal(logout.status, 200);
  assert.equal((await read(user.cookie)).status, 401);
});

test('health recognizes the fully configured migrated PostgreSQL workspace', async () => {
  const response = await health();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {status: 'ok', mode: 'workspace'});
});

test('HTTP backup download authenticates the owner, ignores requested user IDs and returns original XML with private attachment headers', async () => {
  const unsigned = await workspaceExport(request('/api/workspace/export?userId=another-account'));
  assert.equal(unsigned.status, 401);
  assert.equal(unsigned.headers.get('cache-control'), 'no-store');
  assert.equal(unsigned.headers.get('content-disposition'), null);
  const first = await register();
  const second = await register('second@example.test');
  const empty = await workspaceExport(request('/api/workspace/export', undefined, first.cookie));
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).profile, null);
  await profile(first.cookie);
  await profile(second.cookie, 'XEXX010101000', 'Segunda empresa');
  assert.equal((await xml(first.cookie)).status, 200);
  assert.equal((await csv(first.cookie)).status, 200);
  const secondXml = rawXml.replace('XAXX010101000', 'XEXX010101000').replace('Servicio de prueba', 'Servicio privado segunda cuenta');
  assert.equal((await xml(second.cookie, secondXml)).status, 200);
  const auditBefore = await db.query<{count: number}>('SELECT count(*)::int AS count FROM app_audit_events');
  const download = await workspaceExport(request(`/api/workspace/export?userId=${second.id}`, undefined, first.cookie));
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.equal(download.headers.get('content-disposition'), 'attachment; filename="facturia-respaldo-v1.json"');
  assert.equal(download.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  const text = await download.text();
  const backup = JSON.parse(text) as ReturnType<typeof createWorkspaceBackup>;
  assert.equal(backup.version, 1);
  assert.equal(backup.mode, 'workspace');
  assert.equal(backup.profile!.id, first.id);
  assert.equal(backup.transactions.length, 1);
  assert.equal(backup.transactions[0].userId, first.id);
  assert.equal(backup.cfdis.length, 1);
  assert.equal(backup.cfdis[0].rawXml, rawXml);
  assert.equal(backup.cfdis[0].statusSat, 'no_verificado');
  assert.ok(!text.includes('Servicio privado segunda cuenta'));
  assert.ok(!text.includes(password));
  assert.ok(!text.includes(first.cookie));
  const other = await (await workspaceExport(request(`/api/workspace/export?userId=${first.id}`, undefined, second.cookie))).json() as ReturnType<typeof createWorkspaceBackup>;
  assert.equal(other.profile!.id, second.id);
  assert.equal(other.cfdis[0].rawXml, secondXml);
  assert.deepEqual(other.transactions, []);
  const auditAfter = await db.query<{count: number}>('SELECT count(*)::int AS count FROM app_audit_events');
  assert.equal(auditAfter.rows[0].count, auditBefore.rows[0].count);
});

test('HTTP refuses oversized XML imports and the account backup remains empty', async () => {
  const user = await register();
  await profile(user.cookie);
  const oversized = await xml(user.cookie, 'x'.repeat(2_000_001));
  assert.equal(oversized.status, 400);
  const download = await workspaceExport(request('/api/workspace/export', undefined, user.cookie));
  assert.equal(download.status, 200);
  const backup = await download.json() as ReturnType<typeof createWorkspaceBackup>;
  assert.deepEqual(backup.cfdis, []);
  assert.deepEqual(backup.transactions, []);
});
