import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createWorkspaceBackup } from '../src/lib/workspaceExport';
import { parseBankCsv } from '../src/lib/bankCsvParser';
import type { BankTransaction, CfdiRecord, Profile } from '../src/lib/types';
import { snapshotSchema, WORKSPACE_DOCUMENT_LIMIT, WORKSPACE_TRANSACTION_LIMIT } from '../src/lib/validation';
import { XmlCfdiParser } from '../src/lib/xmlParser';
import { HttpError } from '../src/server/http';
import { prepareWorkspaceRestore } from '../src/server/workspaceRestore';
import { namespacedTransactionId } from '../src/server/recordIds';

const rawXml = readFileSync(new URL('./fixtures/sample-cfdi40.xml', import.meta.url), 'utf8');
const sourceProfile: Profile = {
  id: 'source-owner', rfc: 'XAXX010101000', businessName: 'Empresa respaldada',
  regimeCode: '626', createdAt: '2026-10-01T12:00:00.000Z',
};
const destinationProfile: Profile = {...sourceProfile, id: 'authenticated-owner', businessName: 'Perfil actual', regimeCode: '601'};
const parsed = XmlCfdiParser.parse(rawXml, sourceProfile.id);
assert.ok(parsed.success && parsed.cfdi);
const invoice = (overrides: Partial<CfdiRecord> = {}): CfdiRecord => ({...parsed.cfdi!, id: 'source-document', rawXml, ...overrides});
const bank = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({
  id: 'source-transaction', userId: sourceProfile.id, accountId: 'cuenta-principal', amount: -116,
  currency: 'MXN', date: '2026-10-01', description: 'Pago proveedor', status: 'conciliado',
  matchedCfdiId: 'source-document', candidateCfdiIds: [], reconciliationLocked: false, ...overrides,
});
const backup = () => createWorkspaceBackup({profile: sourceProfile, cfdis: [invoice()], transactions: [bank()]}, {
  mode: 'workspace', exportedAt: '2026-10-08T18:00:00.000Z',
});
const hasStatus = (status: number) => (error: unknown) => error instanceof HttpError && error.status === status;

test('restore reowns records, remaps links and keeps the authenticated profile without mutating the backup', () => {
  const input = backup();
  const before = structuredClone(input);
  const restored = prepareWorkspaceRestore(input, destinationProfile);
  assert.deepEqual(restored.profile, destinationProfile);
  assert.equal(restored.cfdis[0].userId, destinationProfile.id);
  assert.equal(restored.transactions[0].userId, destinationProfile.id);
  assert.match(restored.cfdis[0].id, /^restore-doc-[a-f0-9]{64}$/);
  assert.match(restored.transactions[0].id, /^restore-bank-[a-f0-9]{64}$/);
  assert.equal(restored.transactions[0].status, 'conciliado');
  assert.equal(restored.transactions[0].matchedCfdiId, restored.cfdis[0].id);
  assert.equal(restored.cfdis[0].rawXml, rawXml);
  assert.equal(snapshotSchema.safeParse(restored).success, true);
  assert.deepEqual(input, before);
});

test('restored IDs are deterministic and isolated by destination, source owner and record kind', () => {
  const input = backup();
  input.transactions[0].id = input.cfdis[0].id;
  const first = prepareWorkspaceRestore(input, destinationProfile);
  const again = prepareWorkspaceRestore(input, destinationProfile);
  assert.deepEqual(first, again);
  assert.notEqual(first.cfdis[0].id, first.transactions[0].id);
  const otherAccount = prepareWorkspaceRestore(input, {...destinationProfile, id: 'second-authenticated-owner'});
  assert.notEqual(first.cfdis[0].id, otherAccount.cfdis[0].id);
  assert.notEqual(first.transactions[0].id, otherAccount.transactions[0].id);
  const anotherSource = structuredClone(input);
  anotherSource.profile!.id = 'another-source-owner';
  anotherSource.cfdis[0].userId = 'another-source-owner';
  anotherSource.transactions[0].userId = 'another-source-owner';
  assert.notEqual(first.cfdis[0].id, prepareWorkspaceRestore(anotherSource, destinationProfile).cfdis[0].id);
});

test('restoring to the original account preserves record IDs and link IDs for bank CSV reimport idempotency', () => {
  const input = backup();
  const restored = prepareWorkspaceRestore(input, {...destinationProfile, id: sourceProfile.id});
  assert.equal(restored.cfdis[0].id, input.cfdis[0].id);
  assert.equal(restored.transactions[0].id, input.transactions[0].id);
  assert.equal(restored.transactions[0].matchedCfdiId, input.cfdis[0].id);
  assert.equal(restored.transactions[0].status, 'conciliado');
});

test('cross-account restore translates canonical bank CSV identities so importing the same CSV keeps the restored IDs', () => {
  const csv = 'fecha,descripcion,monto,moneda\n2026-10-01,Servicio de prueba,-116,MXN\n2026-10-02,Otro cargo,-10,MXN';
  const accountId = 'cuenta-migrada';
  const parsedSource = parseBankCsv(csv, {userId: sourceProfile.id, accountId});
  assert.deepEqual(parsedSource.errors, []);
  const importedSource = parsedSource.transactions.map(transaction => ({...transaction, id: namespacedTransactionId(sourceProfile.id, transaction.id)}));
  const input = {...backup(), transactions: importedSource};
  const restored = prepareWorkspaceRestore(input, destinationProfile);
  const reimportedDestination = parseBankCsv(csv, {userId: destinationProfile.id, accountId}).transactions;
  const expectedIds = reimportedDestination.map(transaction => namespacedTransactionId(destinationProfile.id, transaction.id));
  assert.deepEqual(restored.transactions.map(transaction => transaction.id), expectedIds);
  assert.equal(restored.transactions[0].status, 'conciliado');
  assert.equal(restored.transactions[0].matchedCfdiId, restored.cfdis[0].id);
  assert.equal(restored.transactions[1].status, 'discrepancia');
});

test('cross-account CSV restore preserves both identical rows and their original ordinals even in reordered backups', () => {
  const csv = 'fecha,descripcion,monto\n2026-10-01,Comisión,-10\n2026-10-01,Comisión,-10';
  const accountId = 'cuenta-migrada';
  const importedSource = parseBankCsv(csv, {userId: sourceProfile.id, accountId}).transactions.map(transaction => ({...transaction, id: namespacedTransactionId(sourceProfile.id, transaction.id)}));
  const input = {...backup(), transactions: [...importedSource].reverse()};
  const restored = prepareWorkspaceRestore(input, destinationProfile);
  const reimportedIds = parseBankCsv(csv, {userId: destinationProfile.id, accountId}).transactions.map(transaction => namespacedTransactionId(destinationProfile.id, transaction.id));
  assert.equal(restored.transactions.length, 2);
  assert.notEqual(restored.transactions[0].id, restored.transactions[1].id);
  assert.deepEqual(restored.transactions.map(transaction => transaction.id), [...reimportedIds].reverse());
  assert.deepEqual(restored.transactions.map(transaction => transaction.amount), [-10, -10]);
});

test('unrecognized bank IDs are preserved on same-account restore and use an isolated restore namespace in another account', () => {
  const csv = 'fecha,descripcion,monto\n2026-10-01,Comisión,-10';
  const sourceTransaction = parseBankCsv(csv, {userId: 'incorrect-parser-context', accountId: 'cuenta-migrada'}).transactions[0];
  const input = {...backup(), transactions: [{...sourceTransaction, userId: sourceProfile.id, id: namespacedTransactionId(sourceProfile.id, sourceTransaction.id)}]};
  const originalAccount = prepareWorkspaceRestore(input, {...destinationProfile, id: sourceProfile.id});
  assert.equal(originalAccount.transactions[0].id, input.transactions[0].id);
  const migrated = prepareWorkspaceRestore(input, destinationProfile);
  assert.match(migrated.transactions[0].id, /^restore-bank-[a-f0-9]{64}$/);
  const canonicalDestination = parseBankCsv(csv, {userId: destinationProfile.id, accountId: 'cuenta-migrada'}).transactions[0];
  assert.notEqual(migrated.transactions[0].id, namespacedTransactionId(destinationProfile.id, canonicalDestination.id));
});

test('only account backup v1 with a valid profile and UTC export timestamp is accepted', () => {
  for (const change of [
    {format: 'another-format'}, {version: 2}, {mode: 'demo'}, {mode: 'workspace-demo'},
    {exportedAt: '08/10/2026'}, {profile: null}, {transactions: 'invalid'}, {cfdis: null},
  ]) {
    assert.throws(() => prepareWorkspaceRestore({...backup(), ...change}, destinationProfile), hasStatus(400));
  }
  assert.throws(() => prepareWorkspaceRestore(null, destinationProfile), hasStatus(400));
  assert.throws(() => prepareWorkspaceRestore(backup(), {...destinationProfile, rfc: 'invalid'}), hasStatus(409));
});

test('restore refuses mismatched RFC or records owned by someone other than the source profile', () => {
  assert.throws(() => prepareWorkspaceRestore(backup(), {...destinationProfile, rfc: 'XEXX010101000'}), hasStatus(400));
  for (const key of ['cfdis', 'transactions'] as const) {
    const input = backup();
    input[key][0].userId = 'foreign-owner';
    assert.throws(() => prepareWorkspaceRestore(input, destinationProfile), hasStatus(400));
  }
});

test('references outside the backup and duplicate record IDs are refused before preparing data', () => {
  for (const transaction of [bank({matchedCfdiId: 'foreign-document'}), bank({matchedCfdiId: ''}), bank({candidateCfdiIds: ['foreign-document']})]) {
    const input = {...backup(), transactions: [transaction]};
    assert.throws(() => prepareWorkspaceRestore(input, destinationProfile), hasStatus(400));
  }
  const input = backup();
  assert.throws(() => prepareWorkspaceRestore({...input, transactions: [bank(), bank()]}, destinationProfile), hasStatus(400));
  assert.throws(() => prepareWorkspaceRestore({...input, cfdis: [invoice(), invoice()]}, destinationProfile), hasStatus(400));
});

test('duplicate UUID is detected using reparsed originals even when the JSON invents another UUID', () => {
  const input = backup();
  input.cfdis.push(invoice({id: 'second-document', uuidSat: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'}));
  assert.throws(() => prepareWorkspaceRestore(input, destinationProfile), hasStatus(400));
});

test('XML identity, RFC, concepts, currency and arithmetic prevail over forged JSON fiscal claims', () => {
  const input = backup();
  Object.assign(input.cfdis[0], {
    uuidSat: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', total: 9999, subtotal: 9990, iva: 9,
    rfcEmisor: 'BBB010101BBB', rfcReceptor: 'CCC010101CCC', currency: 'USD', tipoComprobante: 'E',
    conceptos: [{descripcion: 'Concepto inventado', importe: 9990}], statusSat: 'vigente',
  });
  const restored = prepareWorkspaceRestore(input, destinationProfile);
  const document = restored.cfdis[0];
  assert.equal(document.uuidSat, parsed.cfdi!.uuidSat);
  assert.equal(document.rfcEmisor, parsed.cfdi!.rfcEmisor);
  assert.equal(document.rfcReceptor, destinationProfile.rfc);
  assert.equal(document.total, 116);
  assert.equal(document.subtotal, 100);
  assert.equal(document.iva, 16);
  assert.equal(document.currency, 'MXN');
  assert.equal(document.tipoComprobante, 'I');
  assert.deepEqual(document.conceptos, parsed.cfdi!.conceptos);
  assert.equal(document.statusSat, 'no_verificado');
  assert.equal(restored.transactions[0].status, 'conciliado');
});

test('restore never rehabilitates prior cancellation or EFOS alerts and never upgrades to SAT verified', () => {
  for (const flags of [{statusSat: 'cancelado' as const, isEfos: false}, {statusSat: 'vigente' as const, isEfos: true}]) {
    const input = {...backup(), cfdis: [invoice(flags)]};
    const restored = prepareWorkspaceRestore(input, destinationProfile);
    assert.equal(restored.cfdis[0].statusSat, flags.statusSat === 'cancelado' ? 'cancelado' : 'no_verificado');
    assert.equal(restored.cfdis[0].isEfos, flags.isEfos);
    assert.equal(restored.transactions[0].status, 'discrepancia');
    assert.equal(restored.transactions[0].matchedCfdiId, null);
  }
});

test('XML originals are mandatory, parsed safely and must include the target RFC', () => {
  for (const document of [
    invoice({rawXml: undefined}), invoice({rawXml: ''}), invoice({rawXml: '<broken>'}),
    invoice({rawXml: rawXml.replace('XAXX010101000', 'XEXX010101000')}),
    invoice({rawXml: '<!DOCTYPE a [<!ENTITY secret SYSTEM "file:///private">]>' + rawXml}),
  ]) {
    assert.throws(() => prepareWorkspaceRestore({...backup(), cfdis: [document]}, destinationProfile), hasStatus(400));
  }
});

test('unsupported PDF/image/missing source documents and XML oversized originals are refused', () => {
  for (const document of [invoice({sourceType: 'pdf'}), invoice({sourceType: 'image'}), invoice({sourceType: undefined}), invoice({rawXml: 'x'.repeat(2_000_001)})]) {
    assert.throws(() => prepareWorkspaceRestore({...backup(), cfdis: [document]}, destinationProfile), hasStatus(400));
  }
});

test('manual documents restore provisionally with cent arithmetic and can never invent a timbre or match', () => {
  const manual: CfdiRecord = {
    id: 'manual-document', userId: sourceProfile.id, uuidSat: '', rfcEmisor: 'AAA010101AAA', nombreEmisor: 'Proveedor manual',
    rfcReceptor: sourceProfile.rfc, subtotal: 100, iva: 0, retenciones: 10, total: 9999, fechaEmision: '2026-10-01',
    tipoComprobante: 'I', statusSat: 'vigente', isEfos: false, sourceType: 'manual', currency: 'MXN',
  };
  const input = {...backup(), cfdis: [manual], transactions: [bank({amount: -90, matchedCfdiId: manual.id})]};
  const restored = prepareWorkspaceRestore(input, destinationProfile);
  assert.equal(restored.cfdis[0].total, 90);
  assert.equal(restored.cfdis[0].iva, 0);
  assert.equal(restored.cfdis[0].uuidSat, '');
  assert.equal(restored.cfdis[0].sourceType, 'manual');
  assert.equal(restored.cfdis[0].statusSat, 'no_verificado');
  assert.equal(restored.transactions[0].status, 'discrepancia');
  for (const changes of [
    {uuidSat: '12345678-ABCD-4321-8ABC-123456789ABC'}, {tipoComprobante: 'E'}, {rawXml}, {rfcReceptor: 'XEXX010101000'},
    {currency: 'USD'}, {iva: 0.001}, {retenciones: 101}, {nombreEmisor: undefined},
    {subtotal: 1e10, iva: 1e10, retenciones: 0},
  ]) {
    assert.throws(() => prepareWorkspaceRestore({...input, cfdis: [{...manual, ...changes}]}, destinationProfile), hasStatus(400));
  }
});

test('manual resolution is retained only when its restored XML is still a valid matching candidate', () => {
  const input = backup();
  const secondXml = rawXml.replace(parsed.cfdi!.uuidSat, 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA');
  input.cfdis.push(invoice({id: 'second-document', rawXml: secondXml}));
  input.transactions[0].matchedCfdiId = 'second-document';
  input.transactions[0].status = 'discrepancia';
  input.transactions[0].candidateCfdiIds = ['source-document'];
  input.transactions[0].alertReason = 'Untrusted note';
  const restored = prepareWorkspaceRestore(input, destinationProfile);
  assert.equal(restored.transactions[0].status, 'conciliado');
  assert.equal(restored.transactions[0].matchedCfdiId, restored.cfdis[1].id);
  assert.deepEqual(restored.transactions[0].candidateCfdiIds, []);
  assert.notEqual(restored.transactions[0].alertReason, 'Untrusted note');
  for (const changes of [{amount: -500}, {date: '2026-11-01'}, {currency: 'USD'}, {amount: 116}]) {
    const changed = structuredClone(input);
    Object.assign(changed.transactions[0], changes);
    const transaction = prepareWorkspaceRestore(changed, destinationProfile).transactions[0];
    assert.equal(transaction.status, 'discrepancia');
    assert.equal(transaction.matchedCfdiId, null);
  }
});

test('paused reconciliation remains paused and forged status or candidates cannot create a match', () => {
  const paused = backup();
  paused.transactions[0].reconciliationLocked = true;
  const restored = prepareWorkspaceRestore(paused, destinationProfile);
  assert.equal(restored.transactions[0].reconciliationLocked, true);
  assert.equal(restored.transactions[0].status, 'discrepancia');
  assert.equal(restored.transactions[0].matchedCfdiId, null);
  assert.deepEqual(restored.transactions[0].candidateCfdiIds, []);
  const forged = backup();
  forged.transactions[0].amount = -999;
  forged.transactions[0].status = 'conciliado';
  forged.transactions[0].candidateCfdiIds = ['source-document'];
  assert.equal(prepareWorkspaceRestore(forged, destinationProfile).transactions[0].status, 'discrepancia');
});

test('duplicate claims are reevaluated instead of allowing the same restored CFDI to match twice', () => {
  const input = backup();
  input.transactions.push(bank({id: 'second-transaction'}));
  const restored = prepareWorkspaceRestore(input, destinationProfile);
  assert.deepEqual(restored.transactions.map(transaction => transaction.status), ['ambiguo', 'ambiguo']);
  assert.deepEqual(restored.transactions.map(transaction => transaction.matchedCfdiId), [null, null]);
});

test('record quotas apply to backups before any document preparation', () => {
  const input = backup();
  assert.throws(() => prepareWorkspaceRestore({...input, transactions: Array(WORKSPACE_TRANSACTION_LIMIT + 1).fill(bank())}, destinationProfile), hasStatus(400));
  assert.throws(() => prepareWorkspaceRestore({...input, cfdis: Array(WORKSPACE_DOCUMENT_LIMIT + 1).fill(invoice())}, destinationProfile), hasStatus(400));
});

test('unknown credentials, session fields and nested extras are discarded from restored records', () => {
  const input = backup();
  const polluted = {
    ...input, credentials: 'secret-credential', profile: {...input.profile, password: 'secret-password'},
    transactions: [{...input.transactions[0], sessionToken: 'secret-session-token'}],
    cfdis: [{...input.cfdis[0], apiKey: 'secret-api-key'}],
  };
  const restored = prepareWorkspaceRestore(polluted, {...destinationProfile, email: 'private-login@example.test'} as Profile);
  const serialized = JSON.stringify(restored);
  for (const secret of ['secret-credential', 'secret-password', 'secret-session-token', 'secret-api-key', 'private-login@example.test']) assert.ok(!serialized.includes(secret));
});
