import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createWorkspaceBackup, serializeTransactionsCsv, serializeWorkspaceBackup, WorkspaceExportLimitError } from '../src/lib/workspaceExport';
import { snapshotSchema, transactionSchema, WORKSPACE_DOCUMENT_LIMIT, WORKSPACE_TRANSACTION_LIMIT } from '../src/lib/validation';
import { SEED_PROFILE, SEED_CFDIS, SEED_TRANSACTIONS } from '../src/lib/seed';
import { MatchingEngineService } from '../src/lib/MatchingEngineService';
import type { WorkspaceExportSnapshot } from '../src/lib/workspaceExport';
import { GET as exportGet } from '../src/app/api/workspace/export/route';
import { POST as matchingPost } from '../src/app/api/matching/route';

const exportedAt = '2026-10-08T18:00:00.000Z';
const snapshot: WorkspaceExportSnapshot = {
  profile: {...SEED_PROFILE},
  transactions: [{...SEED_TRANSACTIONS[0]}],
  cfdis: [{...SEED_CFDIS[0], statusSat: 'no_verificado', rawXml: '<cfdi:Comprobante Nombre="Prueba &amp; respaldo">\n</cfdi:Comprobante>'}],
};

test('JSON v1 preserves owned fiscal data, original XML, currency and paused reconciliation without changing input', () => {
  const input = structuredClone(snapshot);
  input.transactions[0].reconciliationLocked = true;
  const before = structuredClone(input);
  const backup = createWorkspaceBackup(input, {mode: 'workspace', exportedAt});
  assert.equal(backup.format, 'facturia-workspace-backup');
  assert.equal(backup.version, 1);
  assert.equal(backup.mode, 'workspace');
  assert.equal(backup.exportedAt, exportedAt);
  assert.equal(backup.cfdis[0].rawXml, snapshot.cfdis[0].rawXml);
  assert.equal(backup.cfdis[0].statusSat, 'no_verificado');
  assert.equal(backup.transactions[0].currency, 'MXN');
  assert.equal(backup.transactions[0].reconciliationLocked, true);
  assert.deepEqual(input, before);
  assert.deepEqual(JSON.parse(serializeWorkspaceBackup(input, {mode: 'workspace', exportedAt})), backup);
});

test('backup strips injected session, credentials, prototype and unknown nested concept fields', () => {
  const input = JSON.parse(JSON.stringify(snapshot));
  input.sessions = [{token: 'secret-session-token'}];
  input.profile.email = 'private-login@example.test';
  input.profile.password = 'secret-password';
  input.profile.__proto__ = {extra: 'prototype-secret'};
  input.transactions[0].apiKey = 'secret-api-key';
  input.cfdis[0].credential = 'secret-credential';
  input.cfdis[0].conceptos = [{descripcion: 'Concepto exportable', importe: 100, sessionToken: 'secret-concept-token'}];
  const text = serializeWorkspaceBackup(input, {mode: 'demo', exportedAt});
  const result = JSON.parse(text);
  for (const secret of ['secret-session-token', 'private-login@example.test', 'secret-password', 'prototype-secret', 'secret-api-key', 'secret-credential', 'secret-concept-token']) {
    assert.ok(!text.includes(secret));
  }
  assert.deepEqual(result.cfdis[0].conceptos, [{descripcion: 'Concepto exportable', importe: 100}]);
  assert.equal(result.mode, 'demo');
  assert.equal(Object.getPrototypeOf(result.profile), Object.prototype);
});

test('exports reject records owned by another user and records without an owner profile', () => {
  for (const key of ['transactions', 'cfdis'] as const) {
    const input = structuredClone(snapshot);
    input[key][0].userId = 'different-account';
    assert.throws(() => createWorkspaceBackup(input, {mode: 'workspace', exportedAt}), /perfil exportado/);
    assert.throws(() => serializeTransactionsCsv(input), /perfil exportado/);
  }
  assert.throws(() => createWorkspaceBackup({...snapshot, profile: null}, {mode: 'workspace'}), /perfil propietario/);
  const empty = createWorkspaceBackup({profile: null, transactions: [], cfdis: []}, {mode: 'workspace', exportedAt});
  assert.deepEqual(empty.transactions, []);
  assert.equal(empty.profile, null);
});

test('101 real matching candidates remain exportable and accepted by the shared matching HTTP contract', async () => {
  const cfdis = Array.from({length: 101}, (_, index) => ({
    ...SEED_CFDIS[0], id: `matching-candidate-${index}`,
    uuidSat: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  }));
  const transactions = MatchingEngineService.evaluateBatch([
    {...SEED_TRANSACTIONS[0], status: 'discrepancia', matchedCfdiId: null},
  ], cfdis, SEED_PROFILE);
  assert.equal(transactions[0].status, 'ambiguo');
  assert.equal(transactions[0].candidateCfdiIds!.length, 101);
  const input = {profile: SEED_PROFILE, transactions, cfdis};
  assert.equal(snapshotSchema.safeParse(input).success, true);
  const backup = JSON.parse(serializeWorkspaceBackup(input, {mode: 'demo', exportedAt}));
  assert.deepEqual(backup.transactions[0].candidateCfdiIds, cfdis.map(document => document.id));
  assert.ok(serializeTransactionsCsv(input).includes(',"ambiguo","",'));
  const response = await matchingPost(new Request('http://localhost:3000/api/matching', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(input),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.transactions[0].candidateCfdiIds.length, 101);
  assert.equal(transactionSchema.safeParse({...transactions[0], candidateCfdiIds: Array(WORKSPACE_DOCUMENT_LIMIT + 1).fill('candidate')}).success, false);
});

test('export respects accumulated document/movement quotas and individual XML limit', () => {
  assert.throws(() => createWorkspaceBackup({...snapshot, transactions: Array(WORKSPACE_TRANSACTION_LIMIT + 1).fill(snapshot.transactions[0])}, {mode: 'demo'}));
  assert.throws(() => createWorkspaceBackup({...snapshot, cfdis: Array(WORKSPACE_DOCUMENT_LIMIT + 1).fill(snapshot.cfdis[0])}, {mode: 'demo'}));
  assert.throws(() => createWorkspaceBackup({...snapshot, cfdis: [{...snapshot.cfdis[0], rawXml: 'x'.repeat(2_000_001)}]}, {mode: 'demo'}));
  assert.throws(() => createWorkspaceBackup(snapshot, {mode: 'demo', exportedAt: '08/10/2026'}));
});

test('JSON aggregate download cap rejects many individually acceptable XML documents', () => {
  const rawXml = 'x'.repeat(2_000_000);
  const input = {...snapshot, cfdis: Array.from({length: 14}, (_, index) => ({...snapshot.cfdis[0], id: `export-limit-${index}`, rawXml}))};
  assert.throws(() => serializeWorkspaceBackup(input, {mode: 'workspace', exportedAt}), WorkspaceExportLimitError);
});

test('CSV has stable columns and preserves negative amounts as numeric cells, with matched UUID and lock status', () => {
  const input = structuredClone(snapshot);
  input.transactions[0].reconciliationLocked = true;
  input.transactions[0].matchedCfdiId = input.cfdis[0].id;
  input.transactions[0].amount = -123.45;
  input.transactions[0].currency = 'USD';
  const csv = serializeTransactionsCsv(input);
  assert.ok(csv.startsWith('\uFEFF"id","cuenta","fecha","descripcion","monto","moneda","estado","uuid_cfdi","conciliacion_pausada","motivo"\r\n'));
  assert.ok(csv.includes(',-123.45,"USD",'));
  assert.ok(csv.includes(`"${input.cfdis[0].uuidSat}","si"`));
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(!csv.includes("'-123.45"));
});

test('CSV quotes embedded delimiters, double quotes and multiline descriptions', () => {
  const input = structuredClone(snapshot);
  input.transactions[0].description = 'Proveedor, "Sucursal Norte"\nFactura nueva';
  const csv = serializeTransactionsCsv(input);
  assert.ok(csv.includes('"Proveedor, ""Sucursal Norte""\nFactura nueva"'));
  assert.ok(!csv.includes('Proveedor, "Sucursal Norte"'));
});

test('CSV neutralizes formulas in every textual field and handles disguised Unicode and whitespace prefixes', () => {
  for (const description of ['=HYPERLINK("https://example.test")', '+SUM(1,2)', '-1+2', '@SUM(A1)', '  =1+1', '\t=1+1', '\r\n=1+1', '\u0000=1+1', '\u007f=1+1', '＝1+1', '＋1+1', '－1+1', '＠SUM(A1)']) {
    const input = structuredClone(snapshot);
    input.transactions[0].description = description;
    input.transactions[0].accountId = '=account-formula';
    input.transactions[0].id = '@record-formula';
    input.transactions[0].alertReason = '+alert-formula';
    const csv = serializeTransactionsCsv(input);
    assert.ok(csv.includes(`"'${description.replace(/"/g, '""')}"`), description);
    assert.ok(csv.includes('"\'@record-formula","\'=account-formula"'));
    assert.ok(csv.includes('"\'+alert-formula"'));
    assert.ok(csv.includes(`,${input.transactions[0].amount.toFixed(2)},`));
  }
});

test('CSV reports missing document UUID as empty and supports a headers-only empty workspace', () => {
  const input = structuredClone(snapshot);
  input.transactions[0].matchedCfdiId = 'missing-document';
  const csv = serializeTransactionsCsv(input);
  assert.ok(csv.includes(`,"${input.transactions[0].status}","","no",`));
  const empty = serializeTransactionsCsv({profile: null, transactions: [], cfdis: []});
  assert.equal(empty.split('\r\n').length, 2);
});

const environmentKeys = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'] as const;
const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
for (const key of environmentKeys) delete process.env[key];
after(() => {
  for (const key of environmentKeys) {
    const value = previousEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('export route fails closed without authentication infrastructure and never caches the error', async () => {
  const response = await exportGet(new Request('http://localhost:3000/api/workspace/export?userId=other-account'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Content-Disposition'), null);
  assert.ok(!JSON.stringify(await response.json()).includes(snapshot.cfdis[0].rawXml!));
});
