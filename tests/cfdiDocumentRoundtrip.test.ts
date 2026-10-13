import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import type { BankTransaction, CfdiRecord, Profile } from '../src/lib/types';
import { XmlCfdiParser } from '../src/lib/xmlParser';
import { cfdiSchema } from '../src/lib/validation';
import { createWorkspaceBackup, serializeWorkspaceBackup } from '../src/lib/workspaceExport';
import { prepareWorkspaceRestore } from '../src/server/workspaceRestore';
import { WorkspaceRepository } from '../src/server/workspaceRepository';
import { applyTestMigrations } from './helpers/migrations';

const source: Profile = {
  id: 'document-source', rfc: 'XAXX010101000', businessName: 'Pruebas de documentos',
  regimeCode: '601', createdAt: '2026-10-12T12:00:00Z',
};
const fixtureNames = ['sample-cfdi40.xml', 'sample-payment20.xml', 'sample-credit-note.xml'] as const;
const jsonCopy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let documents: CfdiRecord[];
const db = new PGlite();
const transport = {connect: async () => ({query: (sql: string, values?: unknown[]) => db.query(sql, values), release() {}})} as unknown as Pick<Pool, 'connect'>;
const repository = new WorkspaceRepository(transport);

before(async () => {
  documents = await Promise.all(fixtureNames.map(async fixture => {
    const rawXml = await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), 'utf8');
    const parsed = XmlCfdiParser.parse(rawXml, source.id);
    assert.ok(parsed.success && parsed.cfdi, `El XML sintético ${fixture} debe ser importable`);
    return {...parsed.cfdi, id: `source-${fixture}`, rawXml};
  }));
  await db.waitReady;
  await applyTestMigrations(db);
});
beforeEach(async () => {
  await db.exec('TRUNCATE TABLE "user" CASCADE');
  for (const id of ['document-target-a', 'document-target-b']) {
    await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [id, id, `${id}@example.test`]);
    await repository.saveProfile(id, {rfc: source.rfc, businessName: `Perfil ${id}`, regimeCode: '612'});
  }
});
after(async () => {await db.close();});

const backup = (cfdis = documents, transactions: BankTransaction[] = []) => createWorkspaceBackup({profile: source, cfdis, transactions}, {mode: 'workspace', exportedAt: '2026-10-12T12:00:00.000Z'});
const documentByType = (cfdis: CfdiRecord[], type: CfdiRecord['tipoComprobante']) => {
  const document = cfdis.find(value => value.tipoComprobante === type);
  assert.ok(document, `Debe conservarse el comprobante ${type}`);
  return document;
};

test('JSON backups retain payment decimals, PPD/PUE and related UUIDs while stripping nested credential extras', () => {
  const payment = structuredClone(documentByType(documents, 'P'));
  payment.paymentComplement!.payments[0].relatedDocuments[0] = {
    ...payment.paymentComplement!.payments[0].relatedDocuments[0],
    previousBalance: '116.123456', paidAmount: '58.000001', remainingBalance: '58.123455',
  };
  payment.paymentComplement!.payments[0].amount = '58.000001';
  payment.rawXml = payment.rawXml?.replace('Monto="58.00"', 'Monto="58.000001"')
    .replace('ImpSaldoAnt="116.00"', 'ImpSaldoAnt="116.123456"')
    .replace('ImpPagado="58.00"', 'ImpPagado="58.000001"')
    .replace('ImpSaldoInsoluto="58.00"', 'ImpSaldoInsoluto="58.123455"');
  const input = [documents[0], payment, documents[2]];
  const polluted = JSON.parse(JSON.stringify(input));
  polluted[1].paymentComplement.sessionToken = 'secret-complement';
  polluted[1].paymentComplement.payments[0].apiKey = 'secret-payment';
  polluted[1].paymentComplement.payments[0].relatedDocuments[0].password = 'secret-balance';
  polluted[2].relatedCfdis[0].token = 'secret-relation';
  const text = serializeWorkspaceBackup({profile: source, cfdis: polluted, transactions: []}, {mode: 'workspace'});
  const exported = JSON.parse(text);
  const savedPayment = documentByType(exported.cfdis, 'P');
  assert.equal(savedPayment.total, 0);
  assert.equal(savedPayment.currency, 'XXX');
  assert.deepEqual(savedPayment.paymentComplement, jsonCopy(payment.paymentComplement));
  assert.deepEqual(documentByType(exported.cfdis, 'E').relatedCfdis, documents[2].relatedCfdis);
  assert.equal(exported.cfdis[0].metodoPago, documents[0].metodoPago);
  assert.equal(savedPayment.rawXml, payment.rawXml);
  for (const secret of ['secret-complement', 'secret-payment', 'secret-balance', 'secret-relation']) assert.ok(!text.includes(secret));
});

test('restore derives payment amounts, installment and credit references from original XML despite plausible forged JSON', () => {
  const input = backup();
  const payment = documentByType(input.cfdis, 'P');
  payment.paymentComplement = {
    version: '2.0', totalPaymentsMxn: '999.00', payments: [{
      date: '2026-10-05T13:30:00', currency: 'MXN', amount: '999.000000', form: '01',
      relatedDocuments: [{uuid: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', currency: 'MXN', installment: 9,
        previousBalance: '2000.000000', paidAmount: '999.000000', remainingBalance: '1001.000000', taxObject: '01'}],
    }],
  };
  const credit = documentByType(input.cfdis, 'E');
  credit.relatedCfdis = [{type: '04', uuids: ['AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA']}];
  input.cfdis[0].metodoPago = 'PPD';
  assert.equal(cfdiSchema.safeParse(payment).success, true, 'La falsificación tiene forma válida para probar el reparsing');
  const prepared = prepareWorkspaceRestore(input, {...source, id: 'document-target-a'});
  assert.deepEqual(documentByType(prepared.cfdis, 'P').paymentComplement, documentByType(documents, 'P').paymentComplement);
  assert.deepEqual(documentByType(prepared.cfdis, 'E').relatedCfdis, documentByType(documents, 'E').relatedCfdis);
  assert.equal(prepared.cfdis[0].metodoPago, documents[0].metodoPago);
  assert.ok(prepared.cfdis.every(document => document.userId === 'document-target-a'));
});

test('payment and credit references remain SAT UUIDs across account restore and cannot forge bank matches', () => {
  const payment = documentByType(documents, 'P');
  const credit = documentByType(documents, 'E');
  const transactions: BankTransaction[] = [
    {id: 'paid-transaction', userId: source.id, accountId: 'pruebas', date: payment.paymentComplement!.payments[0].date,
      amount: -58, currency: 'MXN', description: 'Pago parcial', status: 'conciliado', matchedCfdiId: payment.id},
    {id: 'credit-transaction', userId: source.id, accountId: 'pruebas', date: credit.fechaEmision,
      amount: credit.total, currency: 'MXN', description: 'Nota de crédito', status: 'conciliado', matchedCfdiId: credit.id},
  ];
  const prepared = prepareWorkspaceRestore(backup([payment, credit], transactions), {...source, id: 'document-target-a'});
  assert.equal(prepared.transactions.length, transactions.length);
  assert.deepEqual(prepared.transactions.map(transaction => transaction.status), ['discrepancia', 'discrepancia']);
  assert.deepEqual(prepared.transactions.map(transaction => transaction.matchedCfdiId), [null, null]);
  assert.deepEqual(prepared.transactions.map(transaction => transaction.amount), [-58, 58]);
  assert.deepEqual(prepared.cfdis[0].paymentComplement, payment.paymentComplement);
  assert.deepEqual(prepared.cfdis[1].relatedCfdis, credit.relatedCfdis);
  assert.ok(prepared.cfdis.every(document => document.id.startsWith('restore-doc-')));
});

test('PostgreSQL JSONB preserves owner payment metadata and original XML through export and second-account restore', async () => {
  for (const original of documents) {
    await repository.addDocument('document-target-a', {...original, id: `owned-${original.id}`, userId: 'document-target-a'}, original.rawXml);
  }
  const snapshot = await repository.get('document-target-a');
  assert.equal(snapshot.cfdis.length, 3);
  assert.ok(snapshot.cfdis.every(document => document.rawXml === undefined));
  assert.deepEqual(documentByType(snapshot.cfdis, 'P').paymentComplement, jsonCopy(documentByType(documents, 'P').paymentComplement));
  const exported = await repository.getExport('document-target-a');
  const sourceBackup = createWorkspaceBackup(exported, {mode: 'workspace'});
  const preview = await repository.previewRestore('document-target-b', sourceBackup);
  assert.equal(preview.documents, 3);
  assert.equal(preview.matchedTransactions, 0);
  const restored = await repository.restore('document-target-b', sourceBackup);
  const reexported = await repository.getExport('document-target-b');
  assert.ok(restored.cfdis.every(document => document.userId === 'document-target-b' && document.rawXml === undefined));
  assert.deepEqual(documentByType(reexported.cfdis, 'P').paymentComplement, jsonCopy(documentByType(documents, 'P').paymentComplement));
  assert.deepEqual(documentByType(reexported.cfdis, 'E').relatedCfdis, documentByType(documents, 'E').relatedCfdis);
  for (const original of documents) assert.equal(reexported.cfdis.find(document => document.uuidSat === original.uuidSat)!.rawXml, original.rawXml);
  assert.deepEqual(await repository.getExport('document-target-a'), exported, 'La recuperación no modifica la cuenta de origen');
  const rows = await db.query<{user_id: string; uuid_sat: string; payload: CfdiRecord}>('SELECT user_id,uuid_sat,payload FROM app_documents ORDER BY user_id,uuid_sat');
  assert.equal(rows.rows.length, 6);
  assert.equal(rows.rows.filter(row => row.payload.tipoComprobante === 'P' && row.payload.total === 0 && row.payload.currency === 'XXX').length, 2);
  assert.ok(rows.rows.every(row => row.payload.userId === row.user_id));
});
