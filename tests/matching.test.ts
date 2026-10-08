import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MatchingEngineService, BankTxInput, CfdiInput } from '../src/lib/MatchingEngineService';
import { SEED_PROFILE, SEED_CFDIS, SEED_TRANSACTIONS } from '../src/lib/seed';
import { BankTransaction, CfdiRecord } from '../src/lib/types';

const uuid = '550E8400-E29B-41D4-A716-446655441111';
const txInput = (overrides: Partial<BankTxInput> = {}): BankTxInput => ({
  id: 'bank-1', amount: -100, date: '2026-09-08', type: 'egreso',
  userId: SEED_PROFILE.id, businessRfc: SEED_PROFILE.rfc, currency: 'MXN', ...overrides
});
const cfdiInput = (overrides: Partial<CfdiInput> = {}): CfdiInput => ({
  id: 'invoice-1', total: 100, fecha: '2026-09-08T12:00:00-06:00', rfc: 'GWO1204018A2',
  isEfos: false, userId: SEED_PROFILE.id, currency: 'MXN', uuidSat: uuid,
  rfcReceptor: SEED_PROFILE.rfc, tipoComprobante: 'I', statusSat: 'vigente', ...overrides
});
const bank = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({
  id: 'bank-1', userId: SEED_PROFILE.id, accountId: 'account-1', amount: -100, currency: 'MXN',
  date: '2026-09-08', description: 'Pago proveedor', status: 'discrepancia', ...overrides
});
const invoice = (overrides: Partial<CfdiRecord> = {}): CfdiRecord => ({
  id: 'invoice-1', userId: SEED_PROFILE.id, uuidSat: uuid,
  rfcEmisor: 'GWO1204018A2', rfcReceptor: SEED_PROFILE.rfc, total: 100, subtotal: 100,
  iva: 0, retenciones: 0, fechaEmision: '2026-09-08T12:00:00-06:00',
  tipoComprobante: 'I', statusSat: 'vigente', isEfos: false, currency: 'MXN', ...overrides
});

 test('demo seed retains three matches, ambiguity and unrelated discrepancy despite an EFOS invoice', () => {
  const evaluated = MatchingEngineService.evaluateBatch(SEED_TRANSACTIONS, SEED_CFDIS, SEED_PROFILE);
  assert.deepEqual(evaluated.map(tx => tx.status), ['conciliado', 'conciliado', 'conciliado', 'ambiguo', 'discrepancia']);
  assert.deepEqual(evaluated[3].candidateCfdiIds, ['cfdi-004a', 'cfdi-004b']);
  assert.ok(!evaluated[4].alertReason?.includes('EFOS'));
});

test('EFOS only blocks a candidate with the same tenant, amount, calendar window and direction', () => {
  const unrelated = [
    cfdiInput({ id: 'efos-other-amount', isEfos: true, total: 200 }),
    cfdiInput({ id: 'efos-other-date', isEfos: true, fecha: '2026-09-12' }),
    cfdiInput({ id: 'efos-other-owner', isEfos: true, userId: 'somebody-else' }),
    cfdiInput({ id: 'efos-other-currency', isEfos: true, currency: 'USD' }),
    cfdiInput({ id: 'efos-other-direction', isEfos: true, rfc: SEED_PROFILE.rfc, rfcReceptor: 'GWO1204018A2' })
  ];
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput(), ...unrelated]).status, 'conciliado');
  const result = MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ isEfos: true })]);
  assert.equal(result.status, 'discrepancia');
  assert.match(result.alertReason!, /EFOS/);
});

test('tenant, currency and explicit profile context are required', () => {
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ userId: 'other-user' })]).status, 'discrepancia');
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ currency: 'USD' })]).status, 'discrepancia');
  assert.equal(MatchingEngineService.evaluateTransaction(txInput({ businessRfc: undefined }), [cfdiInput()]).status, 'discrepancia');
  assert.equal(MatchingEngineService.evaluateBatch([bank()], [invoice()])[0].status, 'discrepancia');
  assert.equal(MatchingEngineService.evaluateBatch([bank({ userId: 'other-user' })], [invoice({ userId: 'other-user' })], SEED_PROFILE)[0].status, 'discrepancia');
});

test('expense invoices are type I received by the business; credit notes never match as expenses', () => {
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput()]).status, 'conciliado');
  for (const tipoComprobante of ['E', 'N', 'T', 'P'] as const) {
    assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ tipoComprobante })]).status, 'discrepancia');
  }
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ rfcReceptor: 'OTHER123456AB' })]).status, 'discrepancia');
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ rfc: SEED_PROFILE.rfc })]).status, 'discrepancia');
  assert.equal(MatchingEngineService.evaluateTransaction(txInput({ amount: 100, type: 'ingreso' }), [cfdiInput({ rfc: SEED_PROFILE.rfc, rfcReceptor: 'GWO1204018A2' })]).status, 'conciliado');
  assert.equal(MatchingEngineService.evaluateTransaction(txInput({ amount: 100, type: 'ingreso' }), [cfdiInput({ rfc: SEED_PROFILE.rfc, rfcReceptor: undefined })]).status, 'discrepancia');
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ rfc: '' })]).status, 'discrepancia');
  assert.equal(MatchingEngineService.evaluateTransaction(txInput({ amount: 100, type: 'egreso' }), [cfdiInput()]).status, 'discrepancia');
});

test('cancelled and provisional invoices cannot match; unverified SAT state remains explicit', () => {
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ statusSat: 'cancelado' })]).status, 'discrepancia');
  for (const uuidSat of ['', 'EXT-12345', 'MAN-12345', 'TEST-12345']) {
    assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ uuidSat })]).status, 'discrepancia');
  }
  const result = MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ statusSat: 'no_verificado' })]);
  assert.equal(result.status, 'conciliado');
  assert.match(result.alertReason!, /documental.*SAT.*no está verificado/);
});

test('three calendar days includes the whole final day, while a fourth day does not match', () => {
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ fecha: '2026-09-11T23:59:59-06:00' })]).status, 'conciliado');
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ fecha: '2026-09-12T00:00:00-06:00' })]).status, 'discrepancia');
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ fecha: '2026-09-05T00:01:00-06:00' })]).status, 'conciliado');
});

test('cent tolerance avoids binary floating point errors', () => {
  assert.equal(MatchingEngineService.evaluateTransaction(txInput({ amount: -1 }), [cfdiInput({ total: 1.01 })]).status, 'conciliado');
  assert.equal(MatchingEngineService.evaluateTransaction(txInput({ amount: -1 }), [cfdiInput({ total: 1.02 })]).status, 'discrepancia');
  for (const amount of [NaN, Infinity, -Infinity, 0]) {
    assert.equal(MatchingEngineService.evaluateTransaction(txInput({ amount }), [cfdiInput()]).status, 'discrepancia');
  }
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput({ total: NaN })]).status, 'discrepancia');
  for (const date of ['2026-02-31', 'nonsense', new Date(NaN)]) {
    assert.equal(MatchingEngineService.evaluateTransaction(txInput({ date }), [cfdiInput()]).status, 'discrepancia');
  }
});

test('a CFDI matching multiple bank movements requires a single manual assignment', () => {
  const evaluated = MatchingEngineService.evaluateBatch([bank(), bank({ id: 'bank-2' })], [invoice()], SEED_PROFILE);
  assert.deepEqual(evaluated.map(tx => tx.status), ['ambiguo', 'ambiguo']);
  assert.ok(evaluated.every(tx => tx.matchedCfdiId === null));
  assert.deepEqual(evaluated[0].candidateCfdiIds, ['invoice-1']);
  const assigned = MatchingEngineService.evaluateBatch([
    bank({ status: 'conciliado', matchedCfdiId: 'invoice-1' }), bank({ id: 'bank-2' })
  ], [invoice()], SEED_PROFILE);
  assert.deepEqual(assigned.map(tx => tx.status), ['conciliado', 'discrepancia']);
});

test('existing links are revalidated, including cancellation, changed amount and duplicate claims', () => {
  const linked = bank({ status: 'conciliado', matchedCfdiId: 'invoice-1' });
  assert.equal(MatchingEngineService.evaluateBatch([linked], [invoice({ statusSat: 'cancelado' })], SEED_PROFILE)[0].status, 'discrepancia');
  assert.equal(MatchingEngineService.evaluateBatch([linked], [invoice({ total: 200 })], SEED_PROFILE)[0].status, 'discrepancia');
  assert.deepEqual(MatchingEngineService.evaluateBatch([linked, { ...linked, id: 'bank-2' }], [invoice()], SEED_PROFILE).map(tx => tx.status), ['ambiguo', 'ambiguo']);
});

test('duplicate UUIDs cannot become independent candidates or preserved links', () => {
  const duplicated = [invoice(), invoice({ id: 'invoice-2', uuidSat: ` ${uuid.toLowerCase()} ` })];
  assert.equal(MatchingEngineService.evaluateBatch([bank()], duplicated, SEED_PROFILE)[0].status, 'discrepancia');
  assert.equal(MatchingEngineService.evaluateTransaction(txInput(), [cfdiInput(), cfdiInput({ id: 'invoice-2' })]).status, 'discrepancia');
});

test('manual unmatch remains locked across all automatic reevaluations', () => {
  const result = MatchingEngineService.evaluateBatch([bank({ reconciliationLocked: true })], [invoice()], SEED_PROFILE)[0];
  assert.equal(result.status, 'discrepancia');
  assert.equal(result.matchedCfdiId, null);
  assert.equal(result.reconciliationLocked, true);
});

test('cash flow sums cents in the reporting currency and never assumes a universal tax rate', () => {
  const evaluated = MatchingEngineService.evaluateBatch(SEED_TRANSACTIONS, SEED_CFDIS, SEED_PROFILE);
  const metrics = MatchingEngineService.calculateCashFlowShieldMetrics([...evaluated, bank({ id: 'usd-1', amount: 5000, currency: 'USD' })], SEED_CFDIS);
  assert.equal(metrics.totalBankBalance, 14490);
  assert.equal(metrics.totalIncome, 29000);
  assert.equal(metrics.totalExpense, 14510);
  assert.equal(metrics.projectedRetentionsResico, 312.5);
  assert.equal(metrics.nonDeductibleExpenseDiscrepancies, 12400);
  assert.equal(metrics.nonDeductibleImpactEstimated, 0);
  assert.equal(metrics.discrepanciaCount, 2);
  assert.equal(metrics.currency, 'MXN');
  const centsMetrics = MatchingEngineService.calculateCashFlowShieldMetrics([bank({ amount: 0.1 }), bank({ id: 'b2', amount: 0.2 })], []);
  assert.equal(centsMetrics.totalBankBalance, 0.3);
});

test('document retentions are never counted twice or across tenants', () => {
  const linked = bank({ status: 'conciliado', matchedCfdiId: 'invoice-1' });
  assert.equal(MatchingEngineService.calculateCashFlowShieldMetrics([linked, { ...linked, id: 'b2' }], [invoice({ retenciones: 12.34 })]).projectedRetentionsResico, 12.34);
  assert.equal(MatchingEngineService.calculateCashFlowShieldMetrics([linked], [invoice({ retenciones: 12.34, userId: 'other-user' })]).projectedRetentionsResico, 0);
});
