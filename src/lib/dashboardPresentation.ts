import type {BankTransaction, CfdiRecord} from './types';

export type MovementReviewFilter = 'all' | 'ambiguo' | 'discrepancia';
export type CurrencyAmount = [currency: string, amount: number];
export type LoadedDateRange = {from: string; to: string};

function writtenDay(value: string): string | null {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

/** Written document/bank dates describe the loaded data, never a selected fiscal period. */
export function loadedDateRange(values: string[]): LoadedDateRange | null {
  const days = values.map(writtenDay).filter((day): day is string => day !== null).sort();
  return days.length ? {from: days[0], to: days[days.length - 1]} : null;
}

export function describeLoadedDates(range: LoadedDateRange | null): string {
  if (!range) return 'Sin fechas de movimientos disponibles';
  const format = (day: string) => new Intl.DateTimeFormat('es-MX', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}).format(new Date(`${day}T12:00:00Z`));
  return range.from === range.to ? `Fecha cargada: ${format(range.from)}` : `Fechas cargadas: del ${format(range.from)} al ${format(range.to)}`;
}

export function summarizeLoadedMovements(transactions: BankTransaction[]) {
  const currencies = new Map<string, {incoming: number; outgoing: number; unlinkedOutgoing: number; unlinkedOutgoingCount: number}>();
  for (const transaction of transactions) {
    const currency = transaction.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(transaction.amount)) continue;
    const cents = Math.round(Math.abs(transaction.amount) * 100 + Number.EPSILON);
    if (!Number.isSafeInteger(cents)) continue;
    const total = currencies.get(currency) ?? {incoming: 0, outgoing: 0, unlinkedOutgoing: 0, unlinkedOutgoingCount: 0};
    if (transaction.amount > 0) total.incoming += cents;
    else if (transaction.amount < 0) {
      total.outgoing += cents;
      if (transaction.status !== 'conciliado') {total.unlinkedOutgoing += cents; total.unlinkedOutgoingCount++;}
    }
    currencies.set(currency, total);
  }
  return {
    totalCount: transactions.length,
    linkedCount: transactions.filter(transaction => transaction.status === 'conciliado').length,
    ambiguousCount: transactions.filter(transaction => transaction.status === 'ambiguo' && !transaction.reconciliationLocked).length,
    withoutDocumentCount: transactions.filter(transaction => transaction.status === 'discrepancia' && !transaction.reconciliationLocked).length,
    pausedCount: transactions.filter(transaction => transaction.reconciliationLocked).length,
    dateRange: loadedDateRange(transactions.map(transaction => transaction.date)),
    totals: [...currencies].sort(([left], [right]) => left.localeCompare(right)).map(([currency, total]) => ({
      currency, incoming: total.incoming / 100, outgoing: total.outgoing / 100,
      difference: (total.incoming - total.outgoing) / 100,
      unlinkedOutgoing: total.unlinkedOutgoing / 100, unlinkedOutgoingCount: total.unlinkedOutgoingCount,
    })),
  };
}

/** CFDI I is the issuer's invoice type; classify its role using the account RFC. */
export function summarizeInvoiceOrientation(records: CfdiRecord[], profileRfc?: string) {
  const rfc = profileRfc?.trim().toUpperCase();
  const groups = {issued: new Map<string, number>(), received: new Map<string, number>(), unclassified: new Map<string, number>()};
  const counts = {issued: 0, received: 0, unclassified: 0};
  for (const record of records) {
    if (record.sourceType !== 'xml' || record.tipoComprobante !== 'I' || !record.uuidSat || record.statusSat === 'cancelado') continue;
    const currency = (record.currency || 'MXN').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || currency === 'XXX' || !Number.isFinite(record.total) || record.total < 0) continue;
    const issuerIsAccount = Boolean(rfc && record.rfcEmisor.trim().toUpperCase() === rfc);
    const receiverIsAccount = Boolean(rfc && record.rfcReceptor.trim().toUpperCase() === rfc);
    const orientation = issuerIsAccount && !receiverIsAccount ? 'issued' : receiverIsAccount && !issuerIsAccount ? 'received' : 'unclassified';
    groups[orientation].set(currency, (groups[orientation].get(currency) || 0) + record.total);
    counts[orientation]++;
  }
  const entries = (group: Map<string, number>): CurrencyAmount[] => [...group].sort(([left], [right]) => left.localeCompare(right));
  return {issued: entries(groups.issued), received: entries(groups.received), unclassified: entries(groups.unclassified), counts};
}
