import type { BankTransaction, CfdiRecord, ReconciliationStatus } from './types';
import { calendarDay } from './MatchingEngineService';

export const reconciliationLabels: Record<ReconciliationStatus, string> = {
  conciliado: 'Con documento vinculado',
  ambiguo: 'Revisar coincidencia',
  discrepancia: 'Sin documento vinculado',
};

/** Describe recorded state without implying a human review or a fiscal decision. */
export function reconciliationExplanation(transaction: BankTransaction): string {
  if (transaction.reconciliationLocked) return 'La búsqueda automática está pausada porque quitaste el vínculo. Usa Volver a buscar cuando quieras retomarla.';
  if (transaction.status === 'conciliado') return 'Hay un documento asociado a este movimiento. Puedes compararlo y quitar el vínculo si no corresponde.';
  if (transaction.status === 'ambiguo') {
    if (transaction.alertReason?.includes('coincide con varios movimientos')) return 'Un documento coincide con más de un movimiento. Revisa a cuál corresponde antes de vincularlo.';
    const count = new Set(transaction.candidateCfdiIds ?? []).size;
    if (count > 1) return `Hay ${count} documentos posibles. Compara las fechas, importes y quién emitió cada documento antes de elegir.`;
    return 'Hay una posible coincidencia que necesita tu revisión antes de vincular un documento.';
  }
  const reason = transaction.alertReason ?? '';
  if (reason.startsWith('Alerta EFOS en el comprobante candidato')) return 'Un documento posible tiene una alerta registrada sobre su emisor. Revisa el documento y el origen de la alerta antes de vincularlo.';
  if (reason === 'Falta el perfil, RFC o moneda para evaluar la conciliación') return 'Faltan datos de tu perfil, tu RFC o la moneda del movimiento para buscar un documento compatible.';
  if (reason === 'El movimiento tiene fecha, monto o dirección inválidos') return 'Revisa la fecha, el importe y si el movimiento es una entrada o una salida. Esos datos no permiten buscar una coincidencia.';
  // Older imports may contain obsolete tax claims. Missing links do not prove deductibility.
  return 'No encontramos un documento compatible entre los que cargaste. Puede faltar el documento o no coincidir su importe, fecha, moneda o RFC.';
}

export function documentCardLabel(record: CfdiRecord, profileRfc?: string): string {
  if (record.sourceType === 'manual') return 'Gasto anotado sin factura XML';
  if (record.sourceType === 'pdf' || record.sourceType === 'image') return 'Gasto anotado desde un PDF o una foto';
  if (record.tipoComprobante === 'I') {
    const rfc = profileRfc?.trim().toUpperCase();
    if (!rfc) return 'Factura';
    const issued = record.rfcEmisor.trim().toUpperCase() === rfc;
    const received = record.rfcReceptor.trim().toUpperCase() === rfc;
    if (issued && !received) return 'Factura emitida por ti';
    if (received && !issued) return 'Factura recibida';
    return 'Factura · relación con tu RFC sin identificar';
  }
  return {E: 'Nota de crédito', P: 'Documento de pagos', N: 'Recibo de nómina', T: 'Documento de traslado'}[record.tipoComprobante];
}

/** Compare displayed cents and written calendar dates; do not convert currencies. */
export function candidateComparison(transaction: BankTransaction, document: CfdiRecord): {amount: string; date: string} {
  const currency = document.currency || 'MXN';
  let amount = `Monedas diferentes: ${transaction.currency} y ${currency}. No se convirtió el importe.`;
  if (transaction.currency === currency) {
    const bankCents = Math.round(Math.abs(transaction.amount) * 100 + Number.EPSILON);
    const documentCents = Math.round(document.total * 100 + Number.EPSILON);
    if (!Number.isSafeInteger(bankCents) || !Number.isSafeInteger(documentCents)) amount = 'Compara el importe del documento y del movimiento.';
    else if (bankCents === documentCents) amount = 'Mismo importe a centavos que el movimiento.';
    else amount = `Diferencia de importe: ${new Intl.NumberFormat('es-MX', {style: 'currency', currency, currencyDisplay: 'code'}).format(Math.abs(documentCents - bankCents) / 100)}.`;
  }
  const bankDay = calendarDay(transaction.date);
  const documentDay = calendarDay(document.fechaEmision);
  let date = 'Compara la fecha del documento y del movimiento.';
  if (bankDay !== null && documentDay !== null) {
    const difference = documentDay - bankDay;
    const days = Math.abs(difference);
    date = difference === 0 ? 'Emitido el mismo día del movimiento.' : `Emitido ${days} ${days === 1 ? 'día' : 'días'} ${difference < 0 ? 'antes' : 'después'} del movimiento.`;
  }
  return {amount, date};
}
