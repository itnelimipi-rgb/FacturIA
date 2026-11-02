import type { CashFlowMetrics } from './types';
import {isFiscalDecisionQuestion, isRecordedDataQuestion} from './localAssistant';
import {searchable, stripAccents} from './text';

const money = (amount: number) => new Intl.NumberFormat('es-MX', {style: 'currency', currency: 'MXN'}).format(amount);
const satLimit = 'Vincular una factura no confirma su estado en el SAT ni que puedas deducir ese gasto.';
const guideLimit = 'FacturIA no emite ni timbra facturas y no mueve dinero.';

function workflowGuide(message: string): string {
  if (/pdf|imagen|foto|ticket/i.test(message)) return `Usa «Subir archivos» y elige el PDF o la foto del ticket. La app lee el proveedor, el RFC, la fecha y los importes; revísalos y corrige lo que haga falta antes de guardar. No inventes impuestos que no aparezcan en el comprobante. Se guarda como gasto sin factura XML: no se emite una factura. Cuando tengas el XML, súbelo también. ${guideLimit}`;
  if (/csv|estado de cuenta|banco/i.test(message)) return `Descarga de tu banca en línea el estado de cuenta en CSV y súbelo con «Subir archivos». La app detecta las columnas de fecha, descripción e importe y te muestra una vista previa; si una fila tiene un error, la corriges ahí mismo antes de guardar. Subir el archivo no conecta tu banco ni mueve dinero.`;
  if (/ambigu|coincidencia|elige|elegir/i.test(message)) return `«Elige la factura» significa que debes decidir: puede haber varias facturas posibles o una factura que coincide con varios movimientos. Pulsa «Elegir factura», compara proveedor, fecha e importe y elige la que corresponde. Si ninguna corresponde, no elijas: sube la factura correcta. ${satLimit}`;
  if (/discrepancia|sin factura|sin documento/i.test(message)) return `«Sin factura» significa que ese movimiento aún no tiene una factura vinculada. Pulsa «Subir factura» en el movimiento y elige su XML; la app lo vincula si coinciden el importe y la fecha. Un ticket o PDF se guarda como gasto, pero no sustituye la factura XML. ${satLimit}`;
  if (/pausad|volver a buscar/i.test(message)) return '«Búsqueda pausada» aparece cuando quitaste la factura de un movimiento: así la app respeta tu decisión. Pulsa «Volver a buscar» en ese movimiento para que busque otra vez; si no encuentra una que coincida, quedará «Sin factura».';
  if (/conciliad|conciliacion|con factura|con documento|vinculad/i.test(message)) return `«Con factura» significa que ese movimiento ya tiene una factura vinculada con el mismo importe y una fecha cercana. Puedes abrirla con «Ver factura» o quitarla si no corresponde. ${satLimit}`;
  if (/xml|factura|documento/i.test(message)) return `Usa «Subir archivos» y elige una o varias facturas XML. La app las guarda y busca el movimiento que corresponde a cada una; verás el resultado en Inicio y en Movimientos. Guardar un XML no confirma su estado en el SAT: puedes consultarlo desde el detalle de la factura en tu cuenta. ${guideLimit}`;
  return 'En Inicio verás lo pendiente con un botón para resolver cada movimiento: «Elegir factura» cuando hay varias posibles, «Subir factura» cuando falta y «Volver a buscar» si la búsqueda está pausada. Para agregar archivos usa «Subir archivos».';
}

const howToQuestion = (message: string) => {
  const normalized = stripAccents(message).trim();
  return /^¿?\s*(?:como|donde|que hago|que significa|que quiere decir|para que)\b/i.test(normalized)
    && !/\p{N}|\bcuant\w*|\bsaldo\w*|\btotal\w*|\bresum\w*|\btengo\b|\bhay\b/iu.test(normalized);
};

export function assistantReply(message: string, metrics: CashFlowMetrics): string {
  if (isFiscalDecisionQuestion(message) || /ahorr/i.test(message)) return 'Puedo resumir tus documentos y movimientos, pero no calculo impuestos, deducciones ni ahorros: eso necesita revisión contable, y no infiero ahorros con porcentajes simulados. La consulta al SAT se hace desde el detalle de cada factura XML en tu cuenta; este mensaje no realiza una consulta. En la demo los estados son de ejemplo.';
  const simpleAction = /^¿?\s*c[oó]mo\s+(anoto un gasto sin factura|agrego mis documentos|subo mis archivos|quito un v[ií]nculo|quito una factura|vuelvo a buscar)\s*[?.!]*$/i.exec(message);
  if (simpleAction) {
    const action = searchable(simpleAction[1]);
    if (action === 'anoto un gasto sin factura') return 'Si tienes el ticket en PDF o foto, súbelo con «Subir archivos» y la app llenará los datos. Si no, en Documentos usa «Anotar gasto sin factura» y escribe el proveedor, su RFC, la fecha y los importes de tu comprobante. No inventes impuestos. Es una anotación provisional: no emite una factura ni se vincula sola con el banco.';
    if (action === 'agrego mis documentos' || action === 'subo mis archivos') return 'Usa «Subir archivos» y elige tus facturas XML, PDF, fotos o el estado de cuenta en CSV; puedes subir varios a la vez. La app los guarda y busca a qué movimiento corresponde cada factura. Revisa el resultado en Inicio.';
    if (action === 'quito un vinculo' || action === 'quito una factura') return 'En Movimientos, busca el movimiento y pulsa «Quitar». No borra el movimiento ni la factura. La búsqueda automática queda pausada para respetar tu decisión; usa «Volver a buscar» cuando quieras.';
    return 'En Movimientos, busca el movimiento con «Búsqueda pausada» y pulsa «Volver a buscar». La app vuelve a comparar tus facturas y muestra el resultado; no garantiza que encuentre una que coincida.';
  }
  if (howToQuestion(message) || !isRecordedDataQuestion(message)) return workflowGuide(message);
  if (/factura|pendiente|falta|discrepancia|atenci[oó]n/i.test(message)) return `Tienes ${metrics.discrepanciaCount} movimiento(s) sin factura y ${metrics.ambiguoCount} donde debes elegir la factura. Los pagos sin factura suman ${money(metrics.nonDeductibleExpenseDiscrepancies)} en pesos mexicanos; los que esperan tu elección se cuentan aparte. Resuélvelos desde Inicio o Movimientos. ${satLimit}`;
  if (/saldo|banco|flujo|ingreso|egreso|gasto|entr[oó]|sali[oó]/i.test(message)) return `En los movimientos que cargaste en pesos mexicanos entraron ${money(metrics.totalIncome)} y salieron ${money(metrics.totalExpense)}. La diferencia es ${money(metrics.totalBankBalance)}. Sólo incluye tus archivos cargados; no es el saldo disponible de tu cuenta bancaria.`;
  if (/retenci/i.test(message)) return `Tus facturas vinculadas indican ${money(metrics.projectedRetentionsResico)} de impuestos retenidos en pesos mexicanos. Esto no determina el impuesto que debes pagar; esa decisión requiere revisar tu periodo y régimen con un contador.`;
  return `Tienes ${metrics.conciliadoCount} movimiento(s) con factura, ${metrics.ambiguoCount} donde debes elegir la factura y ${metrics.discrepanciaCount} sin factura. Este resumen se calcula con tus registros.`;
}
