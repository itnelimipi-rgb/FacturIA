import assert from 'node:assert/strict';
import { beforeEach, after, test } from 'node:test';
import { FacturiaStore, FacturiaStoreError } from '../src/lib/mockStore';
import { MatchingEngineService } from '../src/lib/MatchingEngineService';
import { SEED_PROFILE, SEED_CFDIS, SEED_TRANSACTIONS } from '../src/lib/seed';
import { BankTransaction, CfdiRecord } from '../src/lib/types';

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  failOnceOnKey?: string;
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return Array.from(this.data.keys())[index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) {
    if (this.failOnceOnKey === key) {
      this.failOnceOnKey = undefined;
      throw new Error('quota');
    }
    this.data.set(key, value);
  }
}

const keys = { tx: 'facturia_bank_transactions_v1', cfdi: 'facturia_cfdis_v1', profile: 'facturia_profile_v1' };
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
});
after(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});
const errorCode = (code: FacturiaStoreError['code']) => (error: unknown) => error instanceof FacturiaStoreError && error.code === code;
const freshCfdi = (overrides: Partial<CfdiRecord> = {}): CfdiRecord => ({
  ...SEED_CFDIS[0], id: 'invoice-new', uuidSat: '550E8400-E29B-41D4-A716-446655442222', ...overrides
});
const freshBank = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({
  ...SEED_TRANSACTIONS[0], id: 'bank-new', status: 'discrepancia', matchedCfdiId: null, ...overrides
});

test('malformed JSON, incorrect shapes and blocked reads safely recover the demo', () => {
  for (const value of ['{broken', 'null', '{"not":"an array"}', '[{}]']) {
    storage.setItem(keys.tx, value);
    storage.setItem(keys.cfdi, value);
    storage.setItem(keys.profile, value);
    assert.deepEqual(FacturiaStore.getTransactions(), SEED_TRANSACTIONS);
    assert.deepEqual(FacturiaStore.getCfdis(), SEED_CFDIS);
    assert.deepEqual(FacturiaStore.getProfile(), SEED_PROFILE);
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { get localStorage() { throw new Error('disabled'); } } });
  assert.deepEqual(FacturiaStore.getCfdis(), SEED_CFDIS);
});

test('duplicated movement identifiers in corrupted browser state cannot create duplicate resolutions', () => {
  storage.setItem(keys.tx, JSON.stringify([SEED_TRANSACTIONS[0], SEED_TRANSACTIONS[0]]));
  assert.deepEqual(FacturiaStore.getTransactions(), SEED_TRANSACTIONS);
});

test('returned seed and stored records are independent copies', () => {
  const records = FacturiaStore.getCfdis();
  records[0].total = 1;
  records[0].conceptos![0].descripcion = 'changed';
  const txs = FacturiaStore.getTransactions();
  txs[0].amount = -1;
  const profile = FacturiaStore.getProfile();
  profile.rfc = 'changed';
  assert.equal(FacturiaStore.getCfdis()[0].total, 1160);
  assert.notEqual(FacturiaStore.getCfdis()[0].conceptos![0].descripcion, 'changed');
  assert.equal(FacturiaStore.getTransactions()[0].amount, -1160);
  assert.equal(FacturiaStore.getProfile().rfc, SEED_PROFILE.rfc);
});

test('only the active tenant records are exposed and foreign mutations are rejected', () => {
  storage.setItem(keys.tx, JSON.stringify([SEED_TRANSACTIONS[0], freshBank({ userId: 'other-user' })]));
  storage.setItem(keys.cfdi, JSON.stringify([SEED_CFDIS[0], freshCfdi({ userId: 'other-user' })]));
  assert.equal(FacturiaStore.getTransactions().length, 1);
  assert.equal(FacturiaStore.getCfdis().length, 1);
  assert.throws(() => FacturiaStore.addCfdi(freshCfdi({ userId: 'other-user' })), errorCode('FOREIGN_USER'));
  assert.throws(() => FacturiaStore.addTransactions([freshBank({ userId: 'other-user' })]), errorCode('FOREIGN_USER'));
  assert.throws(() => FacturiaStore.saveTransactions([freshBank({ userId: 'other-user' })]), errorCode('FOREIGN_USER'));
});

test('canonical UUID duplicate import is refused before any changes are saved', () => {
  const original = FacturiaStore.getCfdis();
  assert.throws(() => FacturiaStore.addCfdi(freshCfdi({ uuidSat: ` ${original[0].uuidSat.toLowerCase()} ` })), errorCode('DUPLICATE_CFDI'));
  assert.deepEqual(FacturiaStore.getCfdis(), original);
  assert.equal(storage.getItem(keys.cfdi), null);
  assert.throws(() => FacturiaStore.saveCfdis([freshCfdi(), freshCfdi({ id: 'second-id' })]), errorCode('DUPLICATE_CFDI'));
});

test('invalid amounts, invalid dates and unrelated profile RFC cannot be imported', () => {
  assert.throws(() => FacturiaStore.addCfdi(freshCfdi({ total: NaN })), errorCode('INVALID_DATA'));
  assert.throws(() => FacturiaStore.addCfdi(freshCfdi({ fechaEmision: '2026-02-31' })), errorCode('INVALID_DATA'));
  assert.throws(() => FacturiaStore.addCfdi(freshCfdi({ rfcReceptor: 'OTHER123456AB' })), errorCode('INVALID_DATA'));
  assert.throws(() => FacturiaStore.addTransactions([freshBank({ amount: Infinity })]), errorCode('INVALID_DATA'));
});

test('addCfdi copies its input and does not globally poison unrelated transactions with EFOS', () => {
  const cfdi = freshCfdi({ rfcEmisor: 'FAL8501019A1', total: 8500, isEfos: false });
  const result = FacturiaStore.addCfdi(cfdi);
  assert.equal(cfdi.isEfos, false);
  assert.equal(result.updatedCfdis[0].isEfos, true);
  assert.deepEqual(result.updatedTransactions.map(tx => tx.status), ['conciliado', 'conciliado', 'conciliado', 'ambiguo', 'discrepancia']);
});

test('manual resolver accepts a revalidated candidate and rejects an unrelated or cancelled invoice', () => {
  assert.throws(() => FacturiaStore.resolveAmbiguous('tx-004', 'cfdi-001'), errorCode('CFDI_ALREADY_LINKED'));
  assert.throws(() => FacturiaStore.resolveAmbiguous('tx-004', 'cfdi-006-efos'), errorCode('INVALID_CANDIDATE'));
  const updated = FacturiaStore.resolveAmbiguous('tx-004', 'cfdi-004a');
  assert.equal(updated.find(tx => tx.id === 'tx-004')!.matchedCfdiId, 'cfdi-004a');
  assert.equal(FacturiaStore.getTransactions().find(tx => tx.id === 'tx-004')!.status, 'conciliado');
  FacturiaStore.resetToSeed();
  FacturiaStore.saveCfdis(FacturiaStore.getCfdis().map(cfdi => cfdi.id === 'cfdi-004a' ? { ...cfdi, statusSat: 'cancelado' } : cfdi));
  assert.throws(() => FacturiaStore.resolveAmbiguous('tx-004', 'cfdi-004a'), errorCode('INVALID_CANDIDATE'));
});

test('manual resolution never attaches one CFDI to two bank movements', () => {
  FacturiaStore.saveTransactions([freshBank({ id: 'first' }), freshBank({ id: 'second' })]);
  FacturiaStore.saveCfdis([SEED_CFDIS[0]]);
  const first = FacturiaStore.resolveAmbiguous('first', SEED_CFDIS[0].id);
  assert.deepEqual(first.map(tx => tx.status), ['conciliado', 'discrepancia']);
  assert.throws(() => FacturiaStore.resolveAmbiguous('second', SEED_CFDIS[0].id), errorCode('CFDI_ALREADY_LINKED'));
  assert.equal(FacturiaStore.getTransactions().filter(tx => tx.matchedCfdiId === SEED_CFDIS[0].id).length, 1);
});

test('manual unmatch persists through adding a CFDI and reload, until explicitly resumed', () => {
  const unlinked = FacturiaStore.unmatchTransaction('tx-001').find(tx => tx.id === 'tx-001')!;
  assert.equal(unlinked.status, 'discrepancia');
  assert.equal(unlinked.matchedCfdiId, null);
  assert.equal(unlinked.reconciliationLocked, true);
  assert.equal(FacturiaStore.getTransactions().find(tx => tx.id === 'tx-001')!.reconciliationLocked, true);
  FacturiaStore.addCfdi(freshCfdi({ total: 10 }));
  const reevaluated = MatchingEngineService.evaluateBatch(FacturiaStore.getTransactions(), FacturiaStore.getCfdis(), FacturiaStore.getProfile());
  assert.equal(reevaluated.find(tx => tx.id === 'tx-001')!.status, 'discrepancia');
  assert.equal(FacturiaStore.resumeReconciliation('tx-001').find(tx => tx.id === 'tx-001')!.matchedCfdiId, 'cfdi-001');
  assert.throws(() => FacturiaStore.unmatchTransaction('missing'), errorCode('NOT_FOUND'));
});

test('CSV transaction import is idempotent, refuses conflicting IDs and ignores forged reconciliation claims', () => {
  const input = freshBank({ amount: -987, matchedCfdiId: 'cfdi-001', status: 'conciliado' });
  const first = FacturiaStore.addTransactions([input]);
  assert.equal(first.updatedTransactions.length, SEED_TRANSACTIONS.length + 1);
  assert.equal(first.updatedTransactions.find(tx => tx.id === input.id)!.status, 'discrepancia');
  assert.equal(first.updatedTransactions.find(tx => tx.id === input.id)!.matchedCfdiId, null);
  assert.equal(FacturiaStore.addTransactions([input]).updatedTransactions.length, first.updatedTransactions.length);
  assert.throws(() => FacturiaStore.addTransactions([{ ...input, amount: -988 }]), errorCode('DUPLICATE_TRANSACTION'));
});

test('storage errors are predictable and restore both CFDI and transaction state', () => {
  FacturiaStore.resetToSeed();
  const beforeCfdis = storage.getItem(keys.cfdi);
  const beforeTxs = storage.getItem(keys.tx);
  storage.failOnceOnKey = keys.tx;
  assert.throws(() => FacturiaStore.addCfdi(freshCfdi({ total: 10 })), errorCode('STORAGE_UNAVAILABLE'));
  assert.equal(storage.getItem(keys.cfdi), beforeCfdis);
  assert.equal(storage.getItem(keys.tx), beforeTxs);
});

test('reset restores the active seed profile and removes manual locks', () => {
  FacturiaStore.unmatchTransaction('tx-001');
  FacturiaStore.saveProfile({ ...SEED_PROFILE, id: 'different-user' });
  assert.equal(FacturiaStore.getTransactions().length, 0);
  FacturiaStore.resetToSeed();
  assert.deepEqual(FacturiaStore.getProfile(), SEED_PROFILE);
  assert.deepEqual(FacturiaStore.getTransactions(), SEED_TRANSACTIONS);
});
