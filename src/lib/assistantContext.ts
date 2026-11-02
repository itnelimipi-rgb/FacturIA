import {MatchingEngineService} from './MatchingEngineService';
import {buildHomeSummary} from './homeSummary';
import {counterpartName, documentCardLabel, movementState, pendingExplanation} from './reconciliationPresentation';
import type {BankTransaction, CfdiRecord, Profile} from './types';

const MAX_PENDING = 25;
const MAX_DOCUMENTS = 20;

/** Facts the assistant may cite: computed by the app from the account records, never by the model. */
export function buildAssistantContext(snapshot: {profile: Profile; transactions: BankTransaction[]; cfdis: CfdiRecord[]}) {
  const {profile} = snapshot;
  const cfdis = snapshot.cfdis.filter(record => record.userId === profile.id).map(record => ({...record, rawXml: undefined}));
  const transactions = MatchingEngineService.evaluateBatch(snapshot.transactions.filter(record => record.userId === profile.id), cfdis, profile);
  const summary = buildHomeSummary(transactions, cfdis, profile.rfc);
  const linkedDocuments = new Set(transactions.flatMap(record => record.status === 'conciliado' && record.matchedCfdiId ? [record.matchedCfdiId] : []));
  return {
    negocio: profile.businessName,
    nota: 'Cifras calculadas por FacturIA con los archivos cargados. La diferencia entre entradas y salidas no es el saldo del banco. Las monedas no se convierten.',
    movimientos: {
      cargados: summary.totalMovements,
      conFactura: summary.linked,
      pendientes: summary.pending.length,
      fechas: summary.dateRange,
      porMoneda: summary.totals.map(total => ({moneda: total.currency, entro: total.incoming, salio: total.outgoing, diferencia: total.difference})),
    },
    pendientes: summary.pending.slice(0, MAX_PENDING).map(({transaction}) => ({
      fecha: transaction.date, descripcion: transaction.description.slice(0, 160), importe: transaction.amount,
      moneda: transaction.currency, estado: movementState(transaction).label, motivo: pendingExplanation(transaction, transactions, cfdis),
    })),
    pendientesOmitidos: Math.max(0, summary.pending.length - MAX_PENDING),
    documentos: {
      cargados: summary.documentCount,
      facturasRecibidas: {cantidad: summary.invoices.counts.received, totales: Object.fromEntries(summary.invoices.received)},
      facturasEmitidas: {cantidad: summary.invoices.counts.issued, totales: Object.fromEntries(summary.invoices.issued)},
      notasDeCredito: summary.creditNotes,
      comprobantesDePago: summary.payments,
      gastosSinFacturaXml: summary.provisional,
    },
    documentosRecientes: cfdis.toSorted((left, right) => right.fechaEmision.localeCompare(left.fechaEmision)).slice(0, MAX_DOCUMENTS).map(record => ({
      tipo: documentCardLabel(record, profile.rfc), contraparte: counterpartName(record, profile.rfc).slice(0, 120),
      fecha: record.fechaEmision.slice(0, 10), importe: record.tipoComprobante === 'P' ? record.paymentComplement?.totalPaymentsMxn ?? null : record.total,
      moneda: record.tipoComprobante === 'P' ? 'MXN' : record.currency || 'MXN',
      vinculadaAMovimiento: linkedDocuments.has(record.id),
      estadoSat: record.satVerification ? `${record.satVerification.status} (consultado ${record.satVerification.checkedAt.slice(0, 10)})` : 'sin consultar',
    })),
  };
}
