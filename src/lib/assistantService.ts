import type { CashFlowMetrics } from './types';

const money = (amount: number) => new Intl.NumberFormat('es-MX', {style: 'currency', currency: 'MXN'}).format(amount);
export function assistantReply(message: string, metrics: CashFlowMetrics): string {
  if (/factura|pendiente|falta|discrepancia/i.test(message)) return `Hay ${metrics.discrepanciaCount} movimiento(s) en discrepancia y ${metrics.ambiguoCount} pendiente(s) de elegir comprobante. Los egresos en discrepancia suman ${money(metrics.nonDeductibleExpenseDiscrepancies)} MXN. Puedes importar XML y resolver los candidatos en Facturas y Tesorería. Una conciliación documental no verifica vigencia, deducibilidad ni estatus SAT.`;
  if (/saldo|banco|flujo|ingreso|gasto/i.test(message)) return `Movimientos registrados en MXN: ingresos ${money(metrics.totalIncome)}, egresos ${money(metrics.totalExpense)} y saldo neto ${money(metrics.totalBankBalance)}. Este saldo es la suma de los movimientos importados; no sustituye el saldo de tu cuenta bancaria.`;
  if (/retenci/i.test(message)) return `Las retenciones documentadas en comprobantes conciliados suman ${money(metrics.projectedRetentionsResico)} MXN. El impuesto a pagar necesita revisar el periodo y tu régimen fiscal.`;
  if (/ahorr|isr|iva|resico|deduc|efos|sat/i.test(message)) return 'Puedo resumir tus documentos y movimientos. En Mi espacio puedes solicitar la consulta oficial SAT desde el detalle de un XML; este mensaje no realiza una consulta. La demo usa estados de ejemplo. El cálculo fiscal por régimen y las deducciones necesitan revisión contable; no infiero ahorros con porcentajes simulados.';
  return `Tienes ${metrics.conciliadoCount} movimiento(s) conciliado(s), ${metrics.ambiguoCount} ambiguo(s) y ${metrics.discrepanciaCount} en discrepancia. Este resumen usa reglas y tus datos actuales. Puedes activar la IA local opcional en un navegador compatible.`;
}
