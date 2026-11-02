import type { BankTransaction, CfdiRecord, ReconciliationStatus } from './types';
import { calendarDay } from './MatchingEngineService';

export const reconciliationLabels: Record<ReconciliationStatus, string> = {
  conciliado: 'Con factura',
  ambiguo: 'Elige la factura',
  discrepancia: 'Sin factura',
};

export type MovementTone = 'done' | 'choose' | 'missing' | 'paused';

/** Short label, tone and next action for one movement; never claims a SAT or fiscal result. */
export function movementState(transaction: BankTransaction): {label: string; tone: MovementTone} {
  if (transaction.reconciliationLocked) return {label: 'Búsqueda pausada', tone: 'paused'};
  if (transaction.status === 'conciliado') return {label: reconciliationLabels.conciliado, tone: 'done'};
  if (transaction.status === 'ambiguo') return {label: reconciliationLabels.ambiguo, tone: 'choose'};
  return {label: reconciliationLabels.discrepancia, tone: 'missing'};
}

/** Describe the recorded state in one sentence, without implying a human review or a fiscal decision. */
export function reconciliationExplanation(transaction: BankTransaction): string {
  if (transaction.reconciliationLocked) return 'Quitaste la factura de este movimiento, así que la búsqueda automática está pausada. Usa «Volver a buscar» cuando quieras.';
  if (transaction.status === 'conciliado') return 'Tiene una factura vinculada. Si no corresponde, puedes quitarla.';
  if (transaction.status === 'ambiguo') {
    if (transaction.alertReason?.includes('coincide con varios movimientos')) return 'Esta factura coincide con más de un movimiento. Elige a cuál corresponde.';
    const count = new Set(transaction.candidateCfdiIds ?? []).size;
    if (count > 1) return `${count} facturas coinciden con este movimiento. Elige la que corresponde.`;
    return 'Hay una factura posible. Revísala antes de vincularla.';
  }
  const reason = transaction.alertReason ?? '';
  if (reason.startsWith('Alerta EFOS en el comprobante candidato')) return 'La factura posible es de un proveedor con una alerta registrada. Revísala antes de usarla.';
  if (reason === 'Falta el perfil, RFC o moneda para evaluar la conciliación') return 'Faltan tu RFC o la moneda del movimiento para buscar su factura.';
  if (reason === 'El movimiento tiene fecha, monto o dirección inválidos') return 'Revisa la fecha y el importe del movimiento: con esos datos no se puede buscar su factura.';
  // Older imports may contain obsolete tax claims. Missing links do not prove deductibility.
  return 'No hay una factura cargada con el mismo importe y una fecha cercana.';
}

/**
 * A movement without a link may have a compatible invoice that is already linked to another movement.
 * Saying so explains why one invoice cannot document two payments.
 */
export function pendingExplanation(transaction: BankTransaction, transactions: BankTransaction[], documents: CfdiRecord[]): string {
  if (transaction.status !== 'discrepancia' || transaction.reconciliationLocked) return reconciliationExplanation(transaction);
  const bankDay = calendarDay(transaction.date);
  const bankCents = Math.round(Math.abs(transaction.amount) * 100);
  const byId = new Map(documents.map(document => [document.id, document]));
  const other = transactions.find(record => {
    if (record.id === transaction.id || record.status !== 'conciliado' || !record.matchedCfdiId || record.amount * transaction.amount <= 0) return false;
    const document = byId.get(record.matchedCfdiId);
    const documentDay = document ? calendarDay(document.fechaEmision) : null;
    return !!document && (document.currency || 'MXN') === transaction.currency && Math.round(document.total * 100) === bankCents
      && bankDay !== null && documentDay !== null && Math.abs(documentDay - bankDay) <= 3;
  });
  return other ? `La factura con este importe ya está vinculada a «${other.description}». Una factura sólo explica un movimiento.` : reconciliationExplanation(transaction);
}

export function documentCardLabel(record: CfdiRecord, profileRfc?: string): string {
  if (record.sourceType === 'pdf' || record.sourceType === 'image' || (record.sourceType === 'manual' && record.attachment)) return 'Gasto de un ticket o foto';
  if (record.sourceType === 'manual') return 'Gasto anotado sin factura';
  if (record.tipoComprobante === 'I') {
    const orientation = invoiceOrientation(record, profileRfc);
    return orientation === 'received' ? 'Factura recibida' : orientation === 'issued' ? 'Factura emitida' : 'Factura';
  }
  return {E: 'Nota de crédito', P: 'Comprobante de pago', N: 'Recibo de nómina', T: 'Comprobante de traslado'}[record.tipoComprobante];
}

export function invoiceOrientation(record: Pick<CfdiRecord, 'rfcEmisor' | 'rfcReceptor'>, profileRfc?: string): 'issued' | 'received' | 'unknown' {
  const rfc = profileRfc?.trim().toUpperCase();
  if (!rfc) return 'unknown';
  const issued = record.rfcEmisor.trim().toUpperCase() === rfc;
  const received = record.rfcReceptor.trim().toUpperCase() === rfc;
  return issued && !received ? 'issued' : received && !issued ? 'received' : 'unknown';
}

/** The other party: who sold to you, or whom you invoiced. */
export function counterpartName(record: CfdiRecord, profileRfc?: string): string {
  return invoiceOrientation(record, profileRfc) === 'issued'
    ? record.nombreReceptor || record.rfcReceptor
    : record.nombreEmisor || record.rfcEmisor;
}

/** Compare displayed cents and written calendar dates; do not convert currencies. */
export function candidateComparison(transaction: BankTransaction, document: CfdiRecord): {amount: string; date: string} {
  const currency = document.currency || 'MXN';
  let amount = `Monedas distintas (${transaction.currency} y ${currency}); no se convierten.`;
  if (transaction.currency === currency) {
    const bankCents = Math.round(Math.abs(transaction.amount) * 100 + Number.EPSILON);
    const documentCents = Math.round(document.total * 100 + Number.EPSILON);
    if (!Number.isSafeInteger(bankCents) || !Number.isSafeInteger(documentCents)) amount = 'Compara el importe de la factura y del movimiento.';
    else if (bankCents === documentCents) amount = 'Mismo importe que el movimiento.';
    else amount = `El importe difiere por ${new Intl.NumberFormat('es-MX', {style: 'currency', currency}).format(Math.abs(documentCents - bankCents) / 100)}.`;
  }
  const bankDay = calendarDay(transaction.date);
  const documentDay = calendarDay(document.fechaEmision);
  let date = 'Compara la fecha de la factura y del movimiento.';
  if (bankDay !== null && documentDay !== null) {
    const difference = documentDay - bankDay;
    const days = Math.abs(difference);
    date = difference === 0 ? 'Emitida el mismo día del movimiento.' : `Emitida ${days} ${days === 1 ? 'día' : 'días'} ${difference < 0 ? 'antes' : 'después'} del movimiento.`;
  }
  return {amount, date};
}
