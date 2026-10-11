import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {before, beforeEach, after, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {getPool} from '../src/server/db';
import {POST as authPost} from '../src/app/api/auth/[...all]/route';
import {GET as workspaceGet, POST as workspacePost} from '../src/app/api/workspace/route';
import {POST as consultSat} from '../src/app/api/workspace/sat/route';
import {GET as exportWorkspace} from '../src/app/api/workspace/export/route';
import {POST as restoreWorkspace} from '../src/app/api/workspace/restore/route';
import {parseBankCsv} from '../src/lib/bankCsvParser';
import {SAT_SERVICE_URL} from '../src/server/satStatus';
import type {WorkspaceSnapshot} from '../src/server/workspaceRepository';
import type {CfdiRecord, SatVerification} from '../src/lib/types';
import {applyTestMigrations} from './helpers/migrations';

const baseURL = 'http://localhost:43212';
const keys = ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'ALLOW_SIGNUP'] as const;
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
process.env.DATABASE_URL = 'postgres://unused.test/never-connected';
process.env.BETTER_AUTH_URL = baseURL;
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString('base64');
process.env.ALLOW_SIGNUP = 'true';
const db = new PGlite();
const pool = getPool();
const query = (sql: string, values?: unknown[]) => db.query(sql, values);
pool.query = query as unknown as Pool['query'];
pool.connect = (async () => ({query, release() {}})) as unknown as Pool['connect'];
let clientNumber = 0;
let rawXml: string;
let rawCsv: string;
const realFetch = globalThis.fetch;

before(async () => {
  await db.waitReady;
  await applyTestMigrations(db);
  rawXml = await readFile(path.resolve('tests/fixtures/sample-cfdi40.xml'), 'utf8');
  rawCsv = await readFile(path.resolve('tests/fixtures/sample-bank.csv'), 'utf8');
});
beforeEach(async () => {clientNumber++; await db.exec('TRUNCATE TABLE "user" CASCADE; TRUNCATE TABLE app_rate_limits');});
after(async () => {
  globalThis.fetch = realFetch;
  await db.close(); await pool.end();
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});
function request(endpoint: string, body?: unknown, cookie?: string, origin = baseURL): Request {
  const headers = new Headers({origin, 'x-forwarded-for': `198.51.100.${clientNumber}`});
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`${baseURL}${endpoint}`, {method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body)});
}
async function account(email: string) {
  const signup = await authPost(request('/api/auth/sign-up/email', {name: 'SAT API test', email, password: 'Only-Local-SAT-Tests-2026!'}));
  assert.equal(signup.status, 200);
  const body = await signup.json() as {user: {id: string}};
  const cookie = signup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const profile = await workspacePost(request('/api/workspace', {action: 'profile', profile: {rfc: 'XAXX010101000', businessName: 'Empresa SAT pruebas', regimeCode: '601'}}, cookie));
  assert.equal(profile.status, 200);
  return {cookie, id: body.user.id};
}
async function importXml(cookie: string) {
  const result = await workspacePost(request('/api/workspace', {action: 'xml', rawXml}, cookie));
  assert.equal(result.status, 200);
  return await result.json() as WorkspaceSnapshot;
}
function reply(state = 'Vigente', efos = '200', code = 'S - Comprobante obtenido satisfactoriamente.') {
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><ConsultaResponse xmlns="http://tempuri.org/"><ConsultaResult xmlns:a="http://schemas.datacontract.org/2004/07/Sat.Cfdi.Negocio.ConsultaCfdi.Servicio"><a:CodigoEstatus>${code}</a:CodigoEstatus><a:Estado>${state}</a:Estado><a:ValidacionEFOS>${efos}</a:ValidacionEFOS></ConsultaResult></ConsultaResponse></s:Body></s:Envelope>`;
}
async function withTransport<T>(fetcher: typeof fetch, work: () => Promise<T>): Promise<T> {
  globalThis.fetch = fetcher;
  try { return await work(); } finally { globalThis.fetch = realFetch; }
}
const responding = (body = reply()) => (async () => new Response(body, {headers: {'content-type': 'text/xml; charset=utf-8'}})) as typeof fetch;

test('SAT HTTP requires owner session, same origin and one document ID; rejected requests never reach SAT', async () => {
  const first = await account('sat-owner@example.test');
  const second = await account('sat-other@example.test');
  const imported = await importXml(first.cookie);
  const documentId = imported.cfdis[0].id;
  let calls = 0;
  await withTransport((async () => {calls++; return new Response(reply());}) as typeof fetch, async () => {
    for (const [req, status] of [
      [request('/api/workspace/sat', {documentId}), 401],
      [request('/api/workspace/sat', {documentId}, second.cookie), 404],
      [request('/api/workspace/sat', {documentId}, first.cookie, 'https://untrusted.example'), 403],
      [request('/api/workspace/sat', {documentId, total: 1, url: 'https://evil.example'}, first.cookie), 400],
      [request('/api/workspace/sat', {documentId: 'absent'}, first.cookie), 404],
    ] as const) {
      const response = await consultSat(req);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  });
  assert.equal(calls, 0);
  assert.equal((await (await workspaceGet(request('/api/workspace', undefined, first.cookie))).json()).cfdis[0].statusSat, 'no_verificado');
});

test('SAT success queries stored XML identity, persists dated provenance and enforces cooldown', async () => {
  const owner = await account('sat-success@example.test');
  const imported = await importXml(owner.cookie);
  let calls = 0;
  await withTransport((async (url: string | URL | Request, options?: RequestInit) => {
    calls++; assert.equal(url, SAT_SERVICE_URL);
    assert.ok(String(options?.body).includes('tt=116.0'));
    return new Response(reply(), {headers: {'content-type': 'text/xml'}});
  }) as typeof fetch, async () => {
    const response = await consultSat(request('/api/workspace/sat', {documentId: imported.cfdis[0].id}, owner.cookie));
    assert.equal(response.status, 200);
    const result = await response.json() as {snapshot: WorkspaceSnapshot; consultation: SatVerification};
    assert.equal(result.consultation.status, 'vigente');
    assert.equal(result.snapshot.cfdis[0].statusSat, 'vigente');
    assert.equal(result.snapshot.cfdis[0].rawXml, undefined);
    assert.equal(result.snapshot.cfdis[0].satVerification?.source, 'sat');
    const repeated = await consultSat(request('/api/workspace/sat', {documentId: imported.cfdis[0].id}, owner.cookie));
    assert.equal(repeated.status, 429);
    assert.equal(repeated.headers.get('retry-after'), '60');
  });
  assert.equal(calls, 1);
  const read = await (await workspaceGet(request('/api/workspace', undefined, owner.cookie))).json() as WorkspaceSnapshot;
  assert.equal(read.cfdis[0].satVerification?.outcome, 'found');
  const audit = await db.query<{action: string}>('SELECT action FROM app_audit_events WHERE user_id=$1', [owner.id]);
  assert.ok(audit.rows.some(row => row.action === 'sat_status_consulted'));
});

test('official cancellation and EFOS100 each break existing matching atomically', async () => {
  for (const [state, efos] of [['Cancelado', '200'], ['Vigente', '100']]) {
    const owner = await account(`sat-risk-${state.toLowerCase()}@example.test`);
    const documents = await importXml(owner.cookie);
    const parsed = parseBankCsv(rawCsv, {userId: owner.id, accountId: 'sat-test'});
    const bank = await workspacePost(request('/api/workspace', {action: 'transactions', transactions: parsed.transactions}, owner.cookie));
    assert.equal((await bank.json() as WorkspaceSnapshot).transactions[0].status, 'conciliado');
    await withTransport(responding(reply(state, efos)), async () => {
      const response = await consultSat(request('/api/workspace/sat', {documentId: documents.cfdis[0].id}, owner.cookie));
      assert.equal(response.status, 200);
      const result = await response.json() as {snapshot: WorkspaceSnapshot};
      assert.equal(result.snapshot.transactions[0].status, 'discrepancia');
      assert.equal(result.snapshot.transactions[0].matchedCfdiId, null);
      assert.equal(result.snapshot.cfdis[0].statusSat, state.toLowerCase());
      assert.equal(result.snapshot.cfdis[0].isEfos, efos === '100');
    });
    const links = await db.query<{matched_cfdi_id: string | null}>('SELECT matched_cfdi_id FROM app_bank_transactions WHERE user_id=$1', [owner.id]);
    assert.equal(links.rows[0].matched_cfdi_id, null);
  }
});

test('unavailable SAT and N602 preserve cancellation and previous EFOS alerts without inventing verification', async () => {
  for (const kind of ['unavailable', 'not_found']) {
    const owner = await account(`sat-${kind}@example.test`);
    const imported = await importXml(owner.cookie);
    const document = {...imported.cfdis[0], statusSat: 'cancelado', isEfos: true};
    await db.query('UPDATE app_documents SET payload=$1 WHERE id=$2 AND user_id=$3', [JSON.stringify(document), document.id, owner.id]);
    const failure = (async () => {throw new Error('sensitive transport details');}) as typeof fetch;
    await withTransport(kind === 'unavailable' ? failure : responding(reply('No Encontrado', '200', 'N - 602: Comprobante no encontrado.')), async () => {
      const response = await consultSat(request('/api/workspace/sat', {documentId: document.id}, owner.cookie));
      assert.equal(response.status, 200);
      const result = await response.json() as {snapshot: WorkspaceSnapshot; consultation: SatVerification};
      assert.equal(result.snapshot.cfdis[0].statusSat, 'cancelado');
      assert.equal(result.snapshot.cfdis[0].isEfos, true);
      assert.equal(result.consultation.status, 'no_verificado');
      assert.equal(result.consultation.outcome, kind);
      assert.ok(!JSON.stringify(result).includes('sensitive'));
    });
  }
});

test('provisional documents and inconsistent original XML cannot call SAT', async () => {
  const owner = await account('sat-invalid-identity@example.test');
  const imported = await importXml(owner.cookie);
  const original = imported.cfdis[0];
  await db.query('UPDATE app_documents SET payload=$1 WHERE id=$2 AND user_id=$3', [JSON.stringify({...original, total: 999}), original.id, owner.id]);
  let calls = 0;
  await withTransport((async () => {calls++; return new Response(reply());}) as typeof fetch, async () => {
    assert.equal((await consultSat(request('/api/workspace/sat', {documentId: original.id}, owner.cookie))).status, 409);
    await db.query('UPDATE app_documents SET payload=$1,raw_xml=NULL WHERE id=$2 AND user_id=$3', [JSON.stringify({...original, sourceType: 'manual', uuidSat: ''}), original.id, owner.id]);
    assert.equal((await consultSat(request('/api/workspace/sat', {documentId: original.id}, owner.cookie))).status, 409);
  });
  assert.equal(calls, 0);
});

test('identity change during the network call refuses saving the stale SAT result', async () => {
  const owner = await account('sat-concurrent@example.test');
  const imported = await importXml(owner.cookie);
  const original = imported.cfdis[0];
  await withTransport((async () => {
    await db.query('UPDATE app_documents SET payload=$1 WHERE id=$2 AND user_id=$3', [JSON.stringify({...original, total: 117}), original.id, owner.id]);
    return new Response(reply(), {headers: {'content-type': 'text/xml'}});
  }) as typeof fetch, async () => {
    assert.equal((await consultSat(request('/api/workspace/sat', {documentId: original.id}, owner.cookie))).status, 409);
  });
  const stored = await db.query<{payload: CfdiRecord}>('SELECT payload FROM app_documents WHERE id=$1 AND user_id=$2', [original.id, owner.id]);
  assert.equal(stored.rows[0].payload.statusSat, 'no_verificado');
  assert.equal(stored.rows[0].payload.satVerification, undefined);
});

test('backup restores fiscal XML but cannot turn copied SAT provenance into fresh verification', async () => {
  const source = await account('sat-backup-source@example.test');
  const target = await account('sat-backup-target@example.test');
  const imported = await importXml(source.cookie);
  await withTransport(responding(), async () => {
    assert.equal((await consultSat(request('/api/workspace/sat', {documentId: imported.cfdis[0].id}, source.cookie))).status, 200);
  });
  const backup = await (await exportWorkspace(request('/api/workspace/export', undefined, source.cookie))).json();
  assert.equal(backup.cfdis[0].satVerification.outcome, 'found');
  const response = await restoreWorkspace(request('/api/workspace/restore', {action: 'restore', backup}, target.cookie));
  assert.equal(response.status, 200);
  const restored = await response.json() as WorkspaceSnapshot;
  assert.equal(restored.cfdis[0].statusSat, 'no_verificado');
  assert.equal(restored.cfdis[0].satVerification, undefined);
});

test('account quota permits six SAT requests per minute and durably rejects the seventh before transport', async () => {
  const owner = await account('sat-quota@example.test');
  const ids: string[] = [];
  for (let index = 0; index < 7; index++) {
    const xml = rawXml.replace('12345678-ABCD-4321-8ABC-123456789ABC', `12345678-ABCD-4321-8ABC-${String(index).padStart(12, '0')}`);
    const response = await workspacePost(request('/api/workspace', {action: 'xml', rawXml: xml}, owner.cookie));
    assert.equal(response.status, 200);
    const snapshot = await response.json() as WorkspaceSnapshot;
    ids.push(snapshot.cfdis.find(record => record.uuidSat.endsWith(String(index).padStart(12, '0')))!.id);
  }
  let calls = 0;
  await withTransport((async () => {calls++; return new Response(reply(), {headers: {'content-type': 'text/xml'}});}) as typeof fetch, async () => {
    for (let index = 0; index < ids.length; index++) {
      const response = await consultSat(request('/api/workspace/sat', {documentId: ids[index]}, owner.cookie));
      assert.equal(response.status, index < 6 ? 200 : 429);
    }
  });
  assert.equal(calls, 6);
  const buckets = await db.query<{count: number}>('SELECT count FROM app_rate_limits WHERE count=7');
  assert.ok(buckets.rows.length >= 1);
});
