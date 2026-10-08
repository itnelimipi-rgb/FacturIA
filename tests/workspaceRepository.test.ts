import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { namespacedTransactionId, WorkspaceRepository } from '../src/server/workspaceRepository';
import { HttpError } from '../src/server/http';
import { SEED_PROFILE, SEED_CFDIS, SEED_TRANSACTIONS } from '../src/lib/seed';
import type { BankTransaction, CfdiRecord } from '../src/lib/types';
import { transactionSchema, cfdiSchema, manualDocumentSchema, snapshotSchema, WORKSPACE_DOCUMENT_LIMIT, WORKSPACE_TRANSACTION_LIMIT } from '../src/lib/validation';
import { createWorkspaceBackup } from '../src/lib/workspaceExport';

const userA = SEED_PROFILE.id;
const userB = 'user-other';
const otherRfc = 'PEPJ800101ABC';
const db = new PGlite();
// Only adapt the pg transport interface. SQL, BEGIN/ROLLBACK, constraints and
// advisory locks run in the embedded PostgreSQL engine without query mocks.
const database = {
  connect: async () => ({
    query: (sql: string, values?: unknown[]) => db.query(sql, values),
    release() {}
  })
} as unknown as Pick<Pool, 'connect'>;
const repository = new WorkspaceRepository(database);
const migrationPath = path.resolve('db/migrations/001_workspace.sql');

before(async () => {
  await db.waitReady;
  await db.exec(await readFile(migrationPath, 'utf8'));
});
beforeEach(async () => {
  await db.exec('TRUNCATE TABLE "user" CASCADE');
  await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3),($4,$5,$6)', [userA, 'Business A', 'a@example.test', userB, 'Business B', 'b@example.test']);
});
after(async () => { await db.close(); });

const createProfile = (userId = userA) => repository.saveProfile(userId, {
  rfc: userId === userA ? SEED_PROFILE.rfc : otherRfc,
  businessName: userId === userA ? SEED_PROFILE.businessName : 'Another business', regimeCode: '626'
});
const document = (overrides: Partial<CfdiRecord> = {}): CfdiRecord => ({
  ...SEED_CFDIS[0], currency: 'MXN', ...overrides
});
const transaction = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({
  ...SEED_TRANSACTIONS[0], status: 'discrepancia', matchedCfdiId: null, ...overrides
});
const hasStatus = (status: number) => (error: unknown) => error instanceof HttpError && error.status === status;
const hasDbCode = (code: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === code;

 test('migration is idempotent and creates auth, workspace and audit tables', async () => {
  await db.exec(await readFile(migrationPath, 'utf8'));
  const tables = await db.query<{ table_name: string }>('SELECT table_name FROM information_schema.tables WHERE table_schema=$1', ['public']);
  for (const table of ['user', 'session', 'account', 'verification', 'app_profiles', 'app_documents', 'app_bank_transactions', 'app_audit_events']) {
    assert.ok(tables.rows.some(row => row.table_name === table), `${table} exists`);
  }
  assert.deepEqual(await repository.get(userA), { profile: null, transactions: [], cfdis: [] });
});

test('profiles are bound to the session user, update business details and refuse RFC changes', async () => {
  const snapshot = await createProfile();
  assert.equal(snapshot.profile!.id, userA);
  assert.equal(snapshot.profile!.rfc, SEED_PROFILE.rfc);
  assert.ok(Number.isFinite(Date.parse(snapshot.profile!.createdAt)));
  await repository.saveProfile(userA, { rfc: SEED_PROFILE.rfc, businessName: 'New business name', regimeCode: '612' });
  assert.equal((await repository.get(userA)).profile!.businessName, 'New business name');
  await assert.rejects(repository.saveProfile(userA, { rfc: otherRfc, businessName: 'Changed RFC', regimeCode: '626' }), hasStatus(409));
  assert.equal((await repository.get(userA)).profile!.rfc, SEED_PROFILE.rfc);
  await assert.rejects(repository.saveProfile('missing-user', { rfc: otherRfc, businessName: 'Missing account', regimeCode: '626' }), hasDbCode('23503'));
});

test('get returns only the caller workspace and import links use the caller RFC', async () => {
  await createProfile();
  await createProfile(userB);
  await repository.addDocument(userA, document());
  const snapshot = await repository.addTransactions(userA, [transaction()]);
  assert.equal(snapshot.transactions[0].status, 'conciliado');
  assert.equal(snapshot.transactions[0].matchedCfdiId, SEED_CFDIS[0].id);
  const other = await repository.get(userB);
  assert.equal(other.profile!.id, userB);
  assert.deepEqual(other.transactions, []);
  assert.deepEqual(other.cfdis, []);
  assert.deepEqual(await repository.get('unknown-user'), { profile: null, transactions: [], cfdis: [] });
});

test('cross-tenant mutations are rejected and bank import rolls back earlier rows in the batch', async () => {
  await createProfile();
  await createProfile(userB);
  await assert.rejects(repository.addDocument(userA, document({ userId: userB })), hasStatus(403));
  await assert.rejects(repository.addTransactions(userA, [transaction(), transaction({ id: 'foreign-bank', userId: userB })]), hasStatus(403));
  assert.deepEqual((await repository.get(userA)).transactions, []);
  await repository.addTransactions(userB, [transaction({ id: 'owned-by-b', userId: userB })]);
  await assert.rejects(repository.unmatch(userA, 'owned-by-b'), hasStatus(404));
  await assert.rejects(repository.resolve(userA, 'owned-by-b', 'any-document'), hasStatus(404));
  assert.equal((await repository.get(userB)).transactions.length, 1);
});

test('canonical UUID duplicates fail atomically and raw XML stays out of browser snapshots', async () => {
  await createProfile();
  const result = await repository.addDocument(userA, document({ rawXml: 'should-not-be-returned' }), '<cfdi:Comprobante/>');
  assert.equal(result.cfdis.length, 1);
  assert.equal(result.cfdis[0].rawXml, undefined);
  const auditBefore = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM app_audit_events WHERE user_id=$1', [userA]);
  await assert.rejects(repository.addDocument(userA, document({ id: 'duplicate-id', uuidSat: SEED_CFDIS[0].uuidSat.toLowerCase() })), hasDbCode('23505'));
  const snapshot = await repository.get(userA);
  assert.equal(snapshot.cfdis.length, 1);
  const auditAfter = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM app_audit_events WHERE user_id=$1', [userA]);
  assert.equal(auditAfter.rows[0].count, auditBefore.rows[0].count);
  const xml = await db.query<{ raw_xml: string }>('SELECT raw_xml FROM app_documents WHERE user_id=$1', [userA]);
  assert.equal(xml.rows[0].raw_xml, '<cfdi:Comprobante/>');
});

test('bank import is idempotent, prevents changed ID collisions and strips forged matching claims', async () => {
  await createProfile();
  const input = transaction({ amount: -987, status: 'conciliado', matchedCfdiId: 'forged-document' });
  const first = await repository.addTransactions(userA, [input]);
  assert.equal(first.transactions[0].status, 'discrepancia');
  assert.equal(first.transactions[0].matchedCfdiId, null);
  const repeated = await repository.addTransactions(userA, [input]);
  assert.equal(repeated.transactions.length, 1);
  await assert.rejects(repository.addTransactions(userA, [{ ...input, amount: -988 }]), hasStatus(409));
  assert.equal((await repository.get(userA)).transactions[0].amount, -987);
});

test('EFOS and cancelled documents cannot reconcile even when date and amount match', async () => {
  await createProfile();
  await repository.addTransactions(userA, [transaction()]);
  await repository.addDocument(userA, document({ statusSat: 'cancelado' }));
  assert.equal((await repository.get(userA)).transactions[0].status, 'discrepancia');
  await db.query('DELETE FROM app_documents WHERE user_id=$1', [userA]);
  await repository.addDocument(userA, document({ isEfos: true }));
  const snapshot = await repository.get(userA);
  assert.equal(snapshot.transactions[0].status, 'discrepancia');
  assert.match(snapshot.transactions[0].alertReason!, /EFOS/);
});

test('manual unmatch is durable across reads, new document imports and transaction imports', async () => {
  await createProfile();
  await repository.addDocument(userA, document());
  await repository.addTransactions(userA, [transaction()]);
  const unlinked = await repository.unmatch(userA, transaction().id);
  assert.equal(unlinked.transactions[0].reconciliationLocked, true);
  assert.equal(unlinked.transactions[0].matchedCfdiId, null);
  await repository.addDocument(userA, document({ id: 'unrelated-document', uuidSat: '550E8400-E29B-41D4-A716-446655443333', total: 999 }));
  await repository.addTransactions(userA, [transaction({ id: 'unrelated-bank', amount: -500 })]);
  const persisted = (await repository.get(userA)).transactions.find(tx => tx.id === transaction().id)!;
  assert.equal(persisted.status, 'discrepancia');
  assert.equal(persisted.matchedCfdiId, null);
  assert.equal(persisted.reconciliationLocked, true);
});

test('manual resolution revalidates ambiguous candidates and leaves a CFDI linked to one movement only', async () => {
  await createProfile();
  await repository.addTransactions(userA, [transaction({ id: 'first-bank' }), transaction({ id: 'second-bank' })]);
  const imported = await repository.addDocument(userA, document());
  assert.deepEqual(imported.transactions.map(tx => tx.status), ['ambiguo', 'ambiguo']);
  await assert.rejects(repository.resolve(userA, 'first-bank', 'unknown-document'), hasStatus(409));
  const resolved = await repository.resolve(userA, 'first-bank', SEED_CFDIS[0].id);
  assert.equal(resolved.transactions.find(tx => tx.id === 'first-bank')!.status, 'conciliado');
  assert.equal(resolved.transactions.find(tx => tx.id === 'second-bank')!.status, 'discrepancia');
  await assert.rejects(repository.resolve(userA, 'second-bank', SEED_CFDIS[0].id), hasStatus(409));
  const links = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM app_bank_transactions WHERE user_id=$1 AND matched_cfdi_id=$2', [userA, SEED_CFDIS[0].id]);
  assert.equal(links.rows[0].count, 1);
});

test('PostgreSQL enforces document owner foreign keys and unique reconciled documents', async () => {
  await createProfile();
  await createProfile(userB);
  await repository.addDocument(userA, document());
  await repository.addTransactions(userA, [transaction()]);
  await repository.addTransactions(userB, [transaction({ id: 'other-bank', userId: userB })]);
  await assert.rejects(db.query('UPDATE app_bank_transactions SET matched_cfdi_id=$1 WHERE id=$2', [SEED_CFDIS[0].id, 'other-bank']), hasDbCode('23503'));
  await repository.addTransactions(userA, [transaction({ id: 'duplicate-bank', amount: -50 })]);
  await assert.rejects(db.query('UPDATE app_bank_transactions SET matched_cfdi_id=$1 WHERE id=$2', [SEED_CFDIS[0].id, 'duplicate-bank']), hasDbCode('23505'));
  await assert.rejects(db.query('INSERT INTO app_documents(id,user_id,uuid_sat,payload) VALUES($1,$2,$3,$4)', ['orphan-document', 'no-profile', '550E8400-E29B-41D4-A716-446655449999', '{}']), hasDbCode('23503'));
});

test('long imported ids become short stable owner-specific ids usable by unmatch and resume', async () => {
  await createProfile();
  const importedId = 'long-bank-id-'.padEnd(200, 'x');
  assert.equal(transactionSchema.safeParse(transaction({id: importedId})).success, true);
  const id = namespacedTransactionId(userA, importedId);
  assert.equal(id.length, 69);
  assert.equal(id, namespacedTransactionId(userA, importedId));
  assert.notEqual(id, namespacedTransactionId(userB, importedId));
  assert.notEqual(id, namespacedTransactionId(userA, `${importedId}2`));
  assert.equal(namespacedTransactionId('u'.repeat(200), importedId).length, 69);
  await repository.addDocument(userA, document());
  await repository.addTransactions(userA, [transaction({id})]);
  assert.equal((await repository.unmatch(userA, id)).transactions[0].reconciliationLocked, true);
  const resumed = await repository.resumeReconciliation(userA, id);
  assert.equal(resumed.transactions[0].reconciliationLocked, false);
  assert.equal(resumed.transactions[0].status, 'conciliado');
  assert.equal(resumed.transactions[0].matchedCfdiId, document().id);
});

test('resume revalidates current candidates, persists the unlocked state and rejects foreign movements', async () => {
  await createProfile();
  await createProfile(userB);
  await repository.addDocument(userA, document());
  await repository.addTransactions(userA, [transaction()]);
  await repository.unmatch(userA, transaction().id);
  await repository.addTransactions(userB, [transaction({id: 'foreign-locked-bank', userId: userB})]);
  await assert.rejects(repository.resumeReconciliation(userA, 'foreign-locked-bank'), hasStatus(404));
  await db.query('UPDATE app_documents SET payload=jsonb_set(payload,$1::text[],$2::jsonb) WHERE id=$3', [['statusSat'], JSON.stringify('cancelado'), document().id]);
  const result = await repository.resumeReconciliation(userA, transaction().id);
  assert.equal(result.transactions[0].reconciliationLocked, false);
  assert.equal(result.transactions[0].status, 'discrepancia');
  assert.equal(result.transactions[0].matchedCfdiId, null);
  assert.equal((await repository.get(userA)).transactions[0].reconciliationLocked, false);
  const audit = await db.query<{action: string}>('SELECT action FROM app_audit_events WHERE user_id=$1 AND action=$2', [userA, 'match_resumed']);
  assert.equal(audit.rows.length, 1);
});

test('get reevaluates obsolete links against current document status without modifying stored data', async () => {
  await createProfile();
  await repository.addDocument(userA, document());
  await repository.addTransactions(userA, [transaction()]);
  await db.query('UPDATE app_documents SET payload=jsonb_set(payload,$1::text[],$2::jsonb) WHERE id=$3', [['statusSat'], JSON.stringify('cancelado'), document().id]);
  const read = await repository.get(userA);
  assert.equal(read.transactions[0].status, 'discrepancia');
  assert.equal(read.transactions[0].matchedCfdiId, null);
  const backup = await repository.getExport(userA);
  assert.equal(backup.transactions[0].status, 'discrepancia');
  assert.equal(backup.transactions[0].matchedCfdiId, null);
  const stored = await db.query<{payload: BankTransaction}>('SELECT payload FROM app_bank_transactions WHERE id=$1', [transaction().id]);
  assert.equal(stored.rows[0].payload.status, 'conciliado');
});

test('documents outside the shared data contract cannot be persisted', async () => {
  await createProfile();
  const oversized = document({nombreEmisor: 'A'.repeat(201)});
  assert.equal(cfdiSchema.safeParse(oversized).success, false);
  await assert.rejects(repository.addDocument(userA, oversized), error => !!error && typeof error === 'object' && 'name' in error && error.name === 'ZodError');
  assert.deepEqual((await repository.get(userA)).cfdis, []);
});

test('accumulated movement quota blocks only new ids and preserves idempotent imports at the limit', async () => {
  await createProfile();
  const records = Array.from({length: WORKSPACE_TRANSACTION_LIMIT}, (_, index) => transaction({id: `quota-bank-${index}`}));
  const initial = await repository.addTransactions(userA, records);
  assert.equal(initial.transactions.length, WORKSPACE_TRANSACTION_LIMIT);
  assert.equal(snapshotSchema.safeParse(initial).success, true);
  const retry = await repository.addTransactions(userA, [records[0]]);
  assert.equal(retry.transactions.length, WORKSPACE_TRANSACTION_LIMIT);
  await assert.rejects(repository.addTransactions(userA, [transaction({id: 'exceeds-quota'})]), hasStatus(413));
  const persisted = await repository.get(userA);
  assert.equal(persisted.transactions.length, WORKSPACE_TRANSACTION_LIMIT);
  assert.ok(!persisted.transactions.some(tx => tx.id === 'exceeds-quota'));
  await createProfile(userB);
  const other = await repository.addTransactions(userB, [transaction({id: 'other-owner-bank', userId: userB})]);
  assert.equal(other.transactions.length, 1);
});

test('document quota rolls back the exceeding insert and retains duplicate detection at the limit', async () => {
  await createProfile();
  const provisional = document({uuidSat: '', sourceType: 'manual', statusSat: 'no_verificado'});
  await db.query('INSERT INTO app_documents(id,user_id,uuid_sat,payload) SELECT $1 || entry,$2,NULL,$3::jsonb || jsonb_build_object(\'id\',$1 || entry) FROM generate_series(1,$4) AS entry', ['quota-document-', userA, JSON.stringify(provisional), WORKSPACE_DOCUMENT_LIMIT]);
  await assert.rejects(repository.addDocument(userA, document({id: 'exceeds-document-quota'})), hasStatus(413));
  await assert.rejects(repository.addDocument(userA, document({id: 'quota-document-1'})), hasDbCode('23505'));
  const snapshot = await repository.get(userA);
  assert.equal(snapshot.cfdis.length, WORKSPACE_DOCUMENT_LIMIT);
  assert.equal(snapshotSchema.safeParse(snapshot).success, true);
  assert.ok(!snapshot.cfdis.some(doc => doc.id === 'exceeds-document-quota'));
});

test('manual documents require a positive total and cent amounts, including their concepts', () => {
  const valid = {rfcEmisor: document().rfcEmisor, nombreEmisor: 'Proveedor de pruebas', subtotal: 100.25, iva: 16.04, retenciones: 0, fechaEmision: '2024-02-29'};
  assert.equal(manualDocumentSchema.safeParse(valid).success, true);
  for (const changes of [{subtotal: 0, iva: 0}, {retenciones: 116.29}, {subtotal: 100.001}, {iva: 16.001}, {retenciones: 1.005}, {conceptos: [{descripcion: 'Concepto', importe: 0.333}]}]) {
    assert.equal(manualDocumentSchema.safeParse({...valid, ...changes}).success, false, JSON.stringify(changes));
  }
  const normalized = manualDocumentSchema.parse({...valid, subtotal: 0.1 + 0.2, iva: 0});
  assert.equal(normalized.subtotal, 0.3);
});

test('manual and bank dates reject calendar rollovers, localized dates and hour 24', () => {
  const valid = {rfcEmisor: document().rfcEmisor, nombreEmisor: 'Proveedor de pruebas', subtotal: 100, iva: 16, retenciones: 0, fechaEmision: '2024-02-29'};
  for (const invalid of ['2026-02-30', '2026-02-29', '2026-13-01', '2026-10-01T24:00:00Z', '10/08/2026', '2026-1-1']) {
    assert.equal(manualDocumentSchema.safeParse({...valid, fechaEmision: invalid}).success, false, invalid);
    assert.equal(transactionSchema.safeParse(transaction({date: invalid})).success, false, invalid);
  }
  for (const date of ['2024-02-29', '2024-02-29T23:15:30.123Z', '2024-02-29T23:15:30-06:00']) {
    assert.equal(transactionSchema.safeParse(transaction({date})).success, true, date);
  }
});

test('bank amounts enforce cents without removing the six-decimal precision of CFDI amounts', () => {
  for (const amount of [0.29, -123.45, 0.1 + 0.2]) {
    const parsed = transactionSchema.safeParse(transaction({amount}));
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.amount, Math.round(amount * 100) / 100);
  }
  assert.equal(transactionSchema.safeParse(transaction({amount: -100.001})).success, false);
  const precise = cfdiSchema.parse(document({subtotal: 100.123456, iva: 16.019753, retenciones: 0.000001}));
  assert.equal(precise.subtotal, 100.123456);
  assert.equal(precise.iva, 16.019753);
  assert.equal(precise.retenciones, 0.000001);
});

test('owner backup includes only original XML for the authenticated workspace and performs no database writes', async () => {
  await createProfile();
  await createProfile(userB);
  const ownXml = await readFile(path.resolve('tests/fixtures/sample-cfdi40.xml'), 'utf8');
  const foreignXml = ownXml.replace('Servicio de prueba', 'Documento privado de otra cuenta');
  await repository.addDocument(userA, document({statusSat: 'no_verificado'}), ownXml);
  await repository.addDocument(userA, document({id: 'manual-backup-document', uuidSat: '', sourceType: 'manual', statusSat: 'no_verificado'}));
  await repository.addTransactions(userA, [transaction()]);
  await repository.unmatch(userA, transaction().id);
  await repository.addDocument(userB, document({id: 'foreign-backup-document', userId: userB}), foreignXml);
  const before = await db.query<{data: unknown}>('SELECT jsonb_build_object(\'documents\',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM app_documents AS d),\'transactions\',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM app_bank_transactions AS t),\'audit\',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM app_audit_events AS a)) AS data');
  const own = await repository.getExport(userA);
  const backup = createWorkspaceBackup(own, {mode: 'workspace', exportedAt: '2026-10-08T18:00:00.000Z'});
  assert.equal(backup.profile!.id, userA);
  assert.equal(backup.cfdis.find(value => value.id === document().id)!.rawXml, ownXml);
  assert.equal(backup.cfdis.find(value => value.id === document().id)!.statusSat, 'no_verificado');
  assert.equal(backup.cfdis.find(value => value.id === 'manual-backup-document')!.rawXml, undefined);
  assert.equal(backup.transactions[0].reconciliationLocked, true);
  assert.ok(!backup.cfdis.some(value => value.id === 'foreign-backup-document'));
  assert.ok(!JSON.stringify(backup).includes('Documento privado de otra cuenta'));
  const other = await repository.getExport(userB);
  assert.equal(other.cfdis.length, 1);
  assert.equal(other.cfdis[0].rawXml, foreignXml);
  assert.deepEqual(other.transactions, []);
  assert.deepEqual(await repository.getExport('unknown-user'), {profile: null, transactions: [], cfdis: []});
  assert.ok((await repository.get(userA)).cfdis.every(value => value.rawXml === undefined));
  const after = await db.query<{data: unknown}>('SELECT jsonb_build_object(\'documents\',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM app_documents AS d),\'transactions\',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM app_bank_transactions AS t),\'audit\',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM app_audit_events AS a)) AS data');
  assert.deepEqual(after.rows[0].data, before.rows[0].data);
});

test('owner backup preflight rejects aggregate XML size before loading originals and leaves data intact', async () => {
  await createProfile();
  await db.query('INSERT INTO app_documents(id,user_id,uuid_sat,payload,raw_xml) SELECT $1 || entry,$2,NULL,$3::jsonb || jsonb_build_object(\'id\',$1 || entry),repeat(\'x\',2000000) FROM generate_series(1,14) AS entry', ['large-backup-', userA, JSON.stringify(document({uuidSat: '', statusSat: 'no_verificado'}))]);
  const countBefore = await db.query<{count: number}>('SELECT count(*)::int AS count FROM app_audit_events WHERE user_id=$1', [userA]);
  await assert.rejects(repository.getExport(userA), hasStatus(413));
  const countAfter = await db.query<{count: number}>('SELECT count(*)::int AS count FROM app_audit_events WHERE user_id=$1', [userA]);
  assert.equal(countAfter.rows[0].count, countBefore.rows[0].count);
  assert.equal((await repository.get(userA)).cfdis.length, 14);
});
