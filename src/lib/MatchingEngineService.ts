import { MatchingResult, CashFlowMetrics, BankTransaction, CfdiRecord, Profile } from './types';

export interface BankTxInput {
  id: string;
  amount: number;
  date: Date | string;
  type: 'ingreso' | 'egreso';
  userId?: string;
  currency?: string;
  businessRfc?: string;
}

export interface CfdiInput {
  id: string;
  total: number;
  fecha: Date | string;
  rfc: string;
  isEfos: boolean;
  userId?: string;
  currency?: string;
  uuidSat?: string;
  rfcReceptor?: string;
  tipoComprobante?: CfdiRecord['tipoComprobante'];
  statusSat?: CfdiRecord['statusSat'];
}

export function canonicalUuid(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(normalized)
    ? normalized : null;
}

const normalize = (value?: string) => typeof value === 'string' ? value.trim().toUpperCase() : '';

// Compare the written calendar day, independent of elapsed hours, timezone and DST.
export function calendarDay(value: Date | string): number | null {
  let year: number;
  let month: number;
  let day: number;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    year = value.getUTCFullYear();
    month = value.getUTCMonth() + 1;
    day = value.getUTCDate();
  } else if (typeof value === 'string') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
    if (!parts || !Number.isFinite(Date.parse(value))) return null;
    year = Number(parts[1]); month = Number(parts[2]); day = Number(parts[3]);
  } else return null;
  const milliseconds = Date.UTC(year, month - 1, day);
  const validated = new Date(milliseconds);
  if (validated.getUTCFullYear() !== year || validated.getUTCMonth() + 1 !== month || validated.getUTCDate() !== day) return null;
  return milliseconds / 86_400_000;
}

function cents(value: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(Math.abs(value) * 100 + Number.EPSILON);
  return Number.isSafeInteger(rounded) ? rounded : null;
}

const noMatch = (reason = 'Movimiento bancario sin comprobante CFDI correspondiente'): MatchingResult => ({
  status: 'discrepancia', alertReason: reason
});

export class MatchingEngineService {
  /** Documentary reconciliation only; it does not verify SAT validity or deductibility. */
  static evaluateTransaction(bankTx: BankTxInput, cfdis: CfdiInput[]): MatchingResult {
    const bankDay = calendarDay(bankTx.date);
    const bankAmount = cents(bankTx.amount);
    const businessRfc = normalize(bankTx.businessRfc);
    const currency = normalize(bankTx.currency);
    if (!bankTx.userId || !businessRfc || !currency) return noMatch('Falta el perfil, RFC o moneda para evaluar la conciliación');
    if (bankDay === null || bankAmount === null || bankAmount === 0 || (bankTx.type === 'ingreso') !== (bankTx.amount > 0)) {
      return noMatch('El movimiento tiene fecha, monto o dirección inválidos');
    }
    const candidates = cfdis.filter(c => {
      if (c.userId !== bankTx.userId || normalize(c.currency || 'MXN') !== currency) return false;
      if (!canonicalUuid(c.uuidSat) || c.tipoComprobante !== 'I') return false;
      if (c.statusSat !== 'vigente' && c.statusSat !== 'no_verificado') return false;
      const issuer = normalize(c.rfc);
      const receiver = normalize(c.rfcReceptor);
      if (!issuer || !receiver) return false;
      const correctDirection = bankTx.type === 'ingreso'
        ? issuer === businessRfc && receiver !== businessRfc
        : receiver === businessRfc && issuer !== businessRfc;
      if (!correctDirection) return false;
      const cfdiDay = calendarDay(c.fecha);
      const amount = cents(c.total);
      return c.total > 0 && amount !== null && cfdiDay !== null
        && Math.abs(amount - bankAmount) <= 1 && Math.abs(cfdiDay - bankDay) <= 3;
    });
    const efosHit = candidates.find(c => c.isEfos);
    if (efosHit) return noMatch(`Alerta EFOS en el comprobante candidato del RFC ${efosHit.rfc}; requiere revisión`);
    const identityCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const uuid = canonicalUuid(candidate.uuidSat)!;
      identityCounts.set(uuid, (identityCounts.get(uuid) ?? 0) + 1);
    }
    const matches = candidates.filter(c => identityCounts.get(canonicalUuid(c.uuidSat)!) === 1);
    if (matches.length === 1) return {
      status: 'conciliado', matchedCfdiId: matches[0].id,
      alertReason: matches[0].statusSat === 'no_verificado'
        ? 'Conciliación documental; el estado SAT de este CFDI no está verificado' : undefined
    };
    if (matches.length > 1) return { status: 'ambiguo', candidateCfdiIds: matches.map(c => c.id) };
    return noMatch();
  }

  /** No universal tax rate is inferred; the optional rate is only an explicit simulation. */
  static calculateCashFlowShieldMetrics(transactions: BankTransaction[], cfdis: CfdiRecord[], simulationRate = 0, reportingCurrency = 'MXN'): CashFlowMetrics {
    let balance = 0, income = 0, expense = 0, unreceipted = 0, retentions = 0;
    let conciliadoCount = 0, ambiguoCount = 0, discrepanciaCount = 0;
    const cfdiMap = new Map(cfdis.map(c => [c.id, c]));
    const countedDocuments = new Set<string>();
    for (const tx of transactions) {
      if (tx.status === 'conciliado') conciliadoCount++;
      else if (tx.status === 'ambiguo') ambiguoCount++;
      else discrepanciaCount++;
      if (normalize(tx.currency) !== normalize(reportingCurrency)) continue;
      const amount = cents(tx.amount);
      if (amount === null) continue;
      balance += tx.amount > 0 ? amount : -amount;
      if (tx.amount > 0) income += amount;
      else expense += amount;
      if (tx.status === 'conciliado') {
        const document = tx.matchedCfdiId ? cfdiMap.get(tx.matchedCfdiId) : undefined;
        const documentKey = document ? canonicalUuid(document.uuidSat) : null;
        if (document && document.userId === tx.userId && !document.isEfos && document.statusSat !== 'cancelado'
          && normalize(document.currency || 'MXN') === normalize(tx.currency) && documentKey && !countedDocuments.has(documentKey)) {
          retentions += cents(document.retenciones) ?? 0;
          countedDocuments.add(documentKey);
        }
      } else if (tx.status === 'discrepancia') {
        if (tx.amount < 0) unreceipted += amount;
      }
    }
    const rate = Number.isFinite(simulationRate) && simulationRate >= 0 && simulationRate <= 1 ? simulationRate : 0;
    return {
      totalBankBalance: balance / 100, totalIncome: income / 100, totalExpense: expense / 100,
      nonDeductibleExpenseDiscrepancies: unreceipted / 100,
      nonDeductibleImpactEstimated: Math.round(unreceipted * rate) / 100,
      projectedRetentionsResico: retentions / 100, conciliadoCount, ambiguoCount, discrepanciaCount,
      currency: normalize(reportingCurrency)
    };
  }

  static evaluateBatch(transactions: BankTransaction[], cfdis: CfdiRecord[], profile?: Pick<Profile, 'id' | 'rfc'>): BankTransaction[] {
    const toInput = (tx: BankTransaction): BankTxInput => ({
      id: tx.id, amount: tx.amount, date: tx.date, type: tx.amount > 0 ? 'ingreso' : 'egreso',
      userId: tx.userId === profile?.id ? tx.userId : undefined,
      businessRfc: profile?.rfc, currency: tx.currency
    });
    const inputs: CfdiInput[] = cfdis.map(c => ({
      id: c.id, total: c.total, fecha: c.fechaEmision, rfc: c.rfcEmisor,
      isEfos: c.isEfos, userId: c.userId, currency: c.currency, uuidSat: c.uuidSat,
      rfcReceptor: c.rfcReceptor, tipoComprobante: c.tipoComprobante, statusSat: c.statusSat
    }));
    // Exclude corrupted duplicate document records instead of guessing identity.
    const identityCounts = new Map<string, number>();
    const idCounts = new Map<string, number>();
    for (const cfdi of inputs) {
      const identity = `${cfdi.userId}:${canonicalUuid(cfdi.uuidSat)}`;
      identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
      idCounts.set(cfdi.id, (idCounts.get(cfdi.id) ?? 0) + 1);
    }
    const eligible = inputs.filter(c => identityCounts.get(`${c.userId}:${canonicalUuid(c.uuidSat)}`) === 1 && idCounts.get(c.id) === 1);
    const validLinks = new Map<number, MatchingResult>();
    const claims = new Map<string, number>();
    transactions.forEach((tx, index) => {
      if (tx.reconciliationLocked || tx.status !== 'conciliado' || !tx.matchedCfdiId) return;
      const result = this.evaluateTransaction(toInput(tx), eligible.filter(c => c.id === tx.matchedCfdiId));
      if (result.status === 'conciliado' && result.matchedCfdiId) {
        validLinks.set(index, result);
        claims.set(result.matchedCfdiId, (claims.get(result.matchedCfdiId) ?? 0) + 1);
      }
    });
    const reserved = new Set(Array.from(claims).filter(([, count]) => count === 1).map(([id]) => id));
    const results = transactions.map((tx, index): MatchingResult => {
      if (tx.reconciliationLocked) return noMatch('Movimiento desvinculado manualmente; reactiva la conciliación para vincularlo');
      const existing = validLinks.get(index);
      if (existing?.matchedCfdiId && reserved.has(existing.matchedCfdiId)) return existing;
      return this.evaluateTransaction(toInput(tx), eligible.filter(c => !reserved.has(c.id)));
    });
    const automaticClaims = new Map<string, number>();
    results.forEach((result, index) => {
      const existingId = validLinks.get(index)?.matchedCfdiId;
      if (existingId && reserved.has(existingId)) return;
      if (result.matchedCfdiId) automaticClaims.set(result.matchedCfdiId, (automaticClaims.get(result.matchedCfdiId) ?? 0) + 1);
    });
    return transactions.map((tx, index) => {
      let result = results[index];
      if (result.matchedCfdiId && (automaticClaims.get(result.matchedCfdiId) ?? 0) > 1) result = {
        status: 'ambiguo', candidateCfdiIds: [result.matchedCfdiId],
        alertReason: 'Este CFDI coincide con varios movimientos; selecciona una sola vinculación'
      };
      return {
        ...tx, status: result.status, matchedCfdiId: result.matchedCfdiId ?? null,
        candidateCfdiIds: result.candidateCfdiIds ?? [], alertReason: result.alertReason
      };
    });
  }
}
