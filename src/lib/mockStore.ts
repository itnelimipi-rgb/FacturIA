import { Profile, BankTransaction, CfdiRecord, CashFlowMetrics } from './types';
import { SEED_PROFILE, SEED_CFDIS, SEED_TRANSACTIONS } from './seed';
import { MatchingEngineService, calendarDay, canonicalUuid } from './MatchingEngineService';
import { EfosService } from './efosService';

const STORAGE_KEY_TXS = 'facturia_bank_transactions_v1';
const STORAGE_KEY_CFDIS = 'facturia_cfdis_v1';
const STORAGE_KEY_PROFILE = 'facturia_profile_v1';

type StoreErrorCode = 'INVALID_DATA' | 'FOREIGN_USER' | 'DUPLICATE_CFDI' | 'DUPLICATE_TRANSACTION'
  | 'NOT_FOUND' | 'INVALID_CANDIDATE' | 'CFDI_ALREADY_LINKED' | 'STORAGE_UNAVAILABLE';

export class FacturiaStoreError extends Error {
  constructor(public readonly code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'FacturiaStoreError';
  }
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finiteAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100));
const currency = (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/i.test(value);

function validProfile(value: unknown): value is Profile {
  return object(value) && nonempty(value.id) && nonempty(value.rfc) && nonempty(value.businessName)
    && nonempty(value.regimeCode) && nonempty(value.createdAt);
}

function validTransaction(value: unknown): value is BankTransaction {
  if (!object(value)) return false;
  return nonempty(value.id) && nonempty(value.userId) && nonempty(value.accountId)
    && finiteAmount(value.amount) && value.amount !== 0 && currency(value.currency)
    && typeof value.date === 'string' && calendarDay(value.date) !== null && typeof value.description === 'string'
    && ['conciliado', 'ambiguo', 'discrepancia'].includes(String(value.status))
    && (value.matchedCfdiId === undefined || value.matchedCfdiId === null || nonempty(value.matchedCfdiId))
    && (value.candidateCfdiIds === undefined || (Array.isArray(value.candidateCfdiIds) && value.candidateCfdiIds.every(nonempty)))
    && (value.reconciliationLocked === undefined || typeof value.reconciliationLocked === 'boolean');
}

function validCfdi(value: unknown): value is CfdiRecord {
  if (!object(value)) return false;
  return nonempty(value.id) && nonempty(value.userId) && typeof value.uuidSat === 'string'
    && nonempty(value.rfcEmisor) && nonempty(value.rfcReceptor)
    && finiteAmount(value.total) && value.total > 0
    && finiteAmount(value.subtotal) && value.subtotal >= 0
    && finiteAmount(value.iva) && value.iva >= 0
    && finiteAmount(value.retenciones) && value.retenciones >= 0
    && typeof value.fechaEmision === 'string' && calendarDay(value.fechaEmision) !== null
    && ['I', 'E', 'T', 'N', 'P'].includes(String(value.tipoComprobante))
    && ['vigente', 'cancelado', 'no_verificado'].includes(String(value.statusSat))
    && typeof value.isEfos === 'boolean' && (value.currency === undefined || currency(value.currency));
}

function readStored(key: string): unknown {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? undefined : JSON.parse(stored);
  } catch {
    // Reading corrupted JSON or a blocked storage area falls back to the demo seed.
    return undefined;
  }
}

/** Write all related records together; restore previous values if storage fails. */
function writeStored(entries: Array<[string, unknown]>): void {
  if (typeof window === 'undefined') return;
  let storage: Storage | undefined;
  const previous: Array<[string, string | null]> = [];
  try {
    storage = window.localStorage;
    for (const [key] of entries) previous.push([key, storage.getItem(key)]);
    for (const [key, value] of entries) storage.setItem(key, JSON.stringify(value));
  } catch {
    if (storage) for (const [key, value] of previous) {
      try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch { /* Keep a predictable error even when storage rejects the rollback. */ }
    }
    throw new FacturiaStoreError('STORAGE_UNAVAILABLE', 'No se pudieron guardar los cambios; revisa el espacio o los permisos del almacenamiento del navegador.');
  }
}

function assertUser(records: Array<{ userId: string }>, profile: Profile): void {
  if (records.some(record => record.userId !== profile.id)) {
    throw new FacturiaStoreError('FOREIGN_USER', 'El registro pertenece a otro perfil.');
  }
}

function assertUniqueCfdis(records: CfdiRecord[]): void {
  const ids = new Set<string>();
  const uuids = new Set<string>();
  for (const cfdi of records) {
    const uuid = canonicalUuid(cfdi.uuidSat);
    if (ids.has(cfdi.id) || (uuid !== null && uuids.has(uuid))) {
      throw new FacturiaStoreError('DUPLICATE_CFDI', 'Este CFDI ya está registrado (UUID o identificador duplicado).');
    }
    ids.add(cfdi.id);
    if (uuid) uuids.add(uuid);
  }
}

export class FacturiaStore {
  static getProfile(): Profile {
    const stored = readStored(STORAGE_KEY_PROFILE);
    return clone(validProfile(stored) ? stored : SEED_PROFILE);
  }

  static saveProfile(profile: Profile): void {
    if (!validProfile(profile)) throw new FacturiaStoreError('INVALID_DATA', 'El perfil está incompleto.');
    writeStored([[STORAGE_KEY_PROFILE, profile]]);
  }

  static getTransactions(): BankTransaction[] {
    const stored = readStored(STORAGE_KEY_TXS);
    const records = Array.isArray(stored) && stored.every(validTransaction)
      && new Set(stored.map(tx => tx.id)).size === stored.length ? stored : SEED_TRANSACTIONS;
    const userId = this.getProfile().id;
    return clone(records.filter(tx => tx.userId === userId));
  }

  static saveTransactions(txs: BankTransaction[]): void {
    if (!Array.isArray(txs) || !txs.every(validTransaction)) throw new FacturiaStoreError('INVALID_DATA', 'Los movimientos contienen datos inválidos.');
    assertUser(txs, this.getProfile());
    if (new Set(txs.map(tx => tx.id)).size !== txs.length) throw new FacturiaStoreError('DUPLICATE_TRANSACTION', 'Hay identificadores de movimiento duplicados.');
    writeStored([[STORAGE_KEY_TXS, txs]]);
  }

  static getCfdis(): CfdiRecord[] {
    const stored = readStored(STORAGE_KEY_CFDIS);
    const records = Array.isArray(stored) && stored.every(validCfdi) ? stored : SEED_CFDIS;
    const userId = this.getProfile().id;
    return clone(records.filter(cfdi => cfdi.userId === userId));
  }

  static saveCfdis(cfdis: CfdiRecord[]): void {
    if (!Array.isArray(cfdis) || !cfdis.every(validCfdi)) throw new FacturiaStoreError('INVALID_DATA', 'Los comprobantes contienen datos inválidos.');
    assertUser(cfdis, this.getProfile());
    assertUniqueCfdis(cfdis);
    writeStored([[STORAGE_KEY_CFDIS, cfdis]]);
  }

  static resetToSeed(): { transactions: BankTransaction[]; cfdis: CfdiRecord[] } {
    const transactions = clone(SEED_TRANSACTIONS);
    const cfdis = clone(SEED_CFDIS);
    writeStored([[STORAGE_KEY_PROFILE, SEED_PROFILE], [STORAGE_KEY_TXS, transactions], [STORAGE_KEY_CFDIS, cfdis]]);
    return { transactions, cfdis };
  }

  static addCfdi(cfdi: CfdiRecord): { updatedTransactions: BankTransaction[]; updatedCfdis: CfdiRecord[] } {
    if (!validCfdi(cfdi)) throw new FacturiaStoreError('INVALID_DATA', 'El comprobante contiene datos inválidos.');
    const profile = this.getProfile();
    assertUser([cfdi], profile);
    const normalized = {
      ...clone(cfdi), uuidSat: canonicalUuid(cfdi.uuidSat) ?? cfdi.uuidSat,
      rfcEmisor: cfdi.rfcEmisor.trim().toUpperCase(), rfcReceptor: cfdi.rfcReceptor.trim().toUpperCase(),
      currency: (cfdi.currency || 'MXN').toUpperCase()
    };
    if (![normalized.rfcEmisor, normalized.rfcReceptor].includes(profile.rfc.trim().toUpperCase())) {
      throw new FacturiaStoreError('INVALID_DATA', 'El RFC del perfil debe ser emisor o receptor del comprobante.');
    }
    normalized.isEfos = normalized.isEfos || EfosService.checkRfc(normalized.rfcEmisor).isEfos;
    const updatedCfdis = [normalized, ...this.getCfdis()];
    assertUniqueCfdis(updatedCfdis);
    const updatedTransactions = MatchingEngineService.evaluateBatch(this.getTransactions(), updatedCfdis, profile);
    writeStored([[STORAGE_KEY_CFDIS, updatedCfdis], [STORAGE_KEY_TXS, updatedTransactions]]);
    return { updatedTransactions, updatedCfdis };
  }

  static addTransactions(newTransactions: BankTransaction[]): { updatedTransactions: BankTransaction[]; updatedCfdis: CfdiRecord[] } {
    if (!Array.isArray(newTransactions) || !newTransactions.every(validTransaction)) throw new FacturiaStoreError('INVALID_DATA', 'Los movimientos importados contienen datos inválidos.');
    const profile = this.getProfile();
    assertUser(newTransactions, profile);
    const transactions = this.getTransactions();
    const byId = new Map(transactions.map(tx => [tx.id, tx]));
    for (const tx of newTransactions) {
      const previous = byId.get(tx.id);
      if (previous) {
        const fields: Array<keyof BankTransaction> = ['userId', 'accountId', 'amount', 'currency', 'date', 'description'];
        if (fields.some(field => previous[field] !== tx[field])) throw new FacturiaStoreError('DUPLICATE_TRANSACTION', 'Un movimiento ya existente tiene el mismo identificador y datos diferentes.');
      } else {
        const fresh: BankTransaction = {
          ...clone(tx), status: 'discrepancia', matchedCfdiId: null, candidateCfdiIds: [],
          reconciliationLocked: false, alertReason: undefined
        };
        transactions.push(fresh);
        byId.set(fresh.id, fresh);
      }
    }
    const updatedCfdis = this.getCfdis();
    const updatedTransactions = MatchingEngineService.evaluateBatch(transactions, updatedCfdis, profile);
    writeStored([[STORAGE_KEY_TXS, updatedTransactions]]);
    return { updatedTransactions, updatedCfdis };
  }

  static resolveAmbiguous(transactionId: string, selectedCfdiId: string): BankTransaction[] {
    const profile = this.getProfile();
    const cfdis = this.getCfdis();
    const current = MatchingEngineService.evaluateBatch(this.getTransactions(), cfdis, profile);
    const tx = current.find(record => record.id === transactionId);
    if (!tx) throw new FacturiaStoreError('NOT_FOUND', 'No se encontró el movimiento.');
    if (current.some(record => record.id !== transactionId && record.status === 'conciliado' && record.matchedCfdiId === selectedCfdiId)) {
      throw new FacturiaStoreError('CFDI_ALREADY_LINKED', 'El CFDI ya está vinculado a otro movimiento.');
    }
    if (tx.status === 'conciliado' && tx.matchedCfdiId === selectedCfdiId) return current;
    if (tx.reconciliationLocked || tx.status !== 'ambiguo' || !tx.candidateCfdiIds?.includes(selectedCfdiId)) {
      throw new FacturiaStoreError('INVALID_CANDIDATE', 'El comprobante seleccionado no es un candidato válido para este movimiento.');
    }
    const updated = current.map(record => record.id === transactionId ? {
      ...record, status: 'conciliado' as const, matchedCfdiId: selectedCfdiId,
      candidateCfdiIds: [], reconciliationLocked: false, alertReason: undefined
    } : record);
    const evaluated = MatchingEngineService.evaluateBatch(updated, cfdis, profile);
    writeStored([[STORAGE_KEY_TXS, evaluated]]);
    return evaluated;
  }

  static unmatchTransaction(transactionId: string): BankTransaction[] {
    const current = this.getTransactions();
    if (!current.some(tx => tx.id === transactionId)) throw new FacturiaStoreError('NOT_FOUND', 'No se encontró el movimiento.');
    const updated = current.map(tx => tx.id === transactionId ? {
      ...tx, status: 'discrepancia' as const, matchedCfdiId: null, candidateCfdiIds: [],
      reconciliationLocked: true, alertReason: 'Movimiento desvinculado manualmente por el usuario'
    } : tx);
    this.saveTransactions(updated);
    return updated;
  }

  static resumeReconciliation(transactionId: string): BankTransaction[] {
    const current = this.getTransactions();
    if (!current.some(tx => tx.id === transactionId)) throw new FacturiaStoreError('NOT_FOUND', 'No se encontró el movimiento.');
    const updated = MatchingEngineService.evaluateBatch(current.map(tx => tx.id === transactionId
      ? { ...tx, reconciliationLocked: false } : tx), this.getCfdis(), this.getProfile());
    this.saveTransactions(updated);
    return updated;
  }

  static getMetrics(): CashFlowMetrics {
    const cfdis = this.getCfdis();
    const txs = MatchingEngineService.evaluateBatch(this.getTransactions(), cfdis, this.getProfile());
    return MatchingEngineService.calculateCashFlowShieldMetrics(txs, cfdis);
  }
}
