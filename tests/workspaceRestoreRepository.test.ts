import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { WorkspaceRepository } from '../src/server/workspaceRepository';
import { prepareWorkspaceRestore } from '../src/server/workspaceRestore';
import { XmlCfdiParser } from '../src/lib/xmlParser';
import { createWorkspaceBackup } from '../src/lib/workspaceExport';
import type { BankTransaction, CfdiRecord, Profile } from '../src/lib/types';
import { HttpError } from '../src/server/http';

const db = new PGlite();
const database = {connect: async () => ({query: (sql: string, values?: unknown[]) => db.query(sql, values), release() {}})} as unknown as Pick<Pool, 'connect'>;
const repository = new WorkspaceRepository(database);
let rawXml: string;
let original: CfdiRecord;
const source: Profile = {id: 'source-account', rfc: 'XAXX010101000', businessName: 'Empresa original', regimeCode: '601', createdAt: '2026-10-08T12:00:00Z'};
const hasStatus = (status: number) => (error: unknown) => error instanceof HttpError && error.status === status;

before(async () => {
  await db.waitReady;
  await db.exec(await readFile('db/migrations/001_workspace.sql', 'utf8'));
  rawXml = await readFile('tests/fixtures/sample-cfdi40.xml', 'utf8');
  const parsed = XmlCfdiParser.parse(rawXml, source.id);
  assert.ok(parsed.success && parsed.cfdi);
  original = {...parsed.cfdi, rawXml};
});
beforeEach(async () => {
  await db.exec('TRUNCATE TABLE "user" CASCADE');
  for (const id of ['destination-a', 'destination-b']) {
    await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [id, id, `${id}@example.test`]);
    await repository.saveProfile(id, {rfc: source.rfc, businessName: `Perfil de ${id}`, regimeCode: '612'});
  }
});
after(async () => {await db.close();});

function backup() {
  const transaction: BankTransaction = {id: 'original-bank', userId: source.id, accountId: 'pruebas', date: '2026-10-01', amount: -116, currency: 'MXN', description: 'Servicio de prueba', status: 'conciliado', matchedCfdiId: original.id};
  return createWorkspaceBackup({profile: source, cfdis: [original], transactions: [transaction, {...transaction, id: 'paused-bank', amount: -50, matchedCfdiId: null, status: 'discrepancia', reconciliationLocked: true}]}, {mode: 'workspace'});
}

test('restore preview is read-only and recovery stores original XML, owner links, pauses and one audit event', async () => {
  const input = backup();
  const before = await repository.get('destination-a');
  const auditsBefore = await db.query<{count: number}>('SELECT count(*)::int AS count FROM app_audit_events WHERE user_id=$1', ['destination-a']);
  assert.deepEqual(await repository.previewRestore('destination-a', input), {rfc: source.rfc, documents: 1, transactions: 2, lockedTransactions: 1, matchedTransactions: 1});
  assert.deepEqual(await repository.get('destination-a'), before);
  const auditsAfterPreview = await db.query<{count: number}>('SELECT count(*)::int AS count FROM app_audit_events WHERE user_id=$1', ['destination-a']);
  assert.equal(auditsAfterPreview.rows[0].count, auditsBefore.rows[0].count);
  const restored = await repository.restore('destination-a', input);
  assert.deepEqual(restored.profile, before.profile);
  assert.equal(restored.cfdis[0].userId, 'destination-a');
  assert.equal(restored.cfdis[0].rawXml, undefined);
  assert.equal(restored.transactions.filter(transaction => transaction.matchedCfdiId === restored.cfdis[0].id).length, 1);
  assert.equal(restored.transactions.find(transaction => transaction.amount === -50)!.reconciliationLocked, true);
  const exported = await repository.getExport('destination-a');
  assert.equal(exported.cfdis[0].rawXml, rawXml);
  const links = await db.query<{matched_cfdi_id: string}>('SELECT matched_cfdi_id FROM app_bank_transactions WHERE user_id=$1 AND matched_cfdi_id IS NOT NULL', ['destination-a']);
  assert.equal(links.rows[0].matched_cfdi_id, restored.cfdis[0].id);
  const audit = await db.query<{action: string}>('SELECT action FROM app_audit_events WHERE user_id=$1 ORDER BY created_at', ['destination-a']);
  assert.deepEqual(audit.rows.map(row => row.action), ['profile_saved', 'workspace_restored']);
  assert.deepEqual((await repository.get('destination-b')).cfdis, []);
});

test('restore checks emptiness again after preview, repeated imports cannot overwrite records or profile', async () => {
  const input = backup();
  await repository.previewRestore('destination-a', input);
  await repository.addDocument('destination-a', {...original, id: 'imported-in-another-tab', userId: 'destination-a'}, rawXml);
  const before = await repository.getExport('destination-a');
  await assert.rejects(repository.restore('destination-a', input), hasStatus(409));
  assert.deepEqual(await repository.getExport('destination-a'), before);
  const first = await repository.restore('destination-b', input);
  await assert.rejects(repository.restore('destination-b', input), hasStatus(409));
  assert.deepEqual(await repository.get('destination-b'), first);
});

test('a late bank primary-key conflict rolls back inserted documents and audit without affecting another account', async () => {
  const input = backup();
  const destination = (await repository.get('destination-a')).profile!;
  const prepared = prepareWorkspaceRestore(input, destination);
  const collision = prepared.transactions[0].id;
  await repository.addTransactions('destination-b', [{...input.transactions[0], id: collision, userId: 'destination-b', matchedCfdiId: null}]);
  const foreignBefore = await repository.get('destination-b');
  await assert.rejects(repository.restore('destination-a', input), (error: unknown) => (error as {code?: string})?.code === '23505');
  const unchanged = await repository.getExport('destination-a');
  assert.deepEqual(unchanged.cfdis, []);
  assert.deepEqual(unchanged.transactions, []);
  assert.deepEqual(await repository.get('destination-b'), foreignBefore);
  const events = await db.query<{count: number}>('SELECT count(*)::int AS count FROM app_audit_events WHERE user_id=$1 AND action=$2', ['destination-a', 'workspace_restored']);
  assert.equal(events.rows[0].count, 0);
});
