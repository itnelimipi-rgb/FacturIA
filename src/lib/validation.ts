import { z } from 'zod';

export const WORKSPACE_TRANSACTION_LIMIT = 5000;
export const WORKSPACE_DOCUMENT_LIMIT = 2000;

export const rfcSchema = z.string().trim().toUpperCase().regex(/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/, 'RFC inválido');
const money = z.number().finite().min(0).max(1e10);
const isCentAmount = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
const roundToCents = (value: number) => Math.round(value * 100) / 100;
const centMoney = money.refine(isCentAmount, 'El importe admite como máximo dos decimales').transform(roundToCents);
function validCalendarDate(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = parts.slice(1, 4).map(Number);
  if (year < 1 || month < 1 || month > 12 || (parts[4] && Number(parts[4]) > 23)) return false;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
}
const date = z.string().refine(validCalendarDate, 'Fecha inválida');
const conceptSchema = z.object({claveProdServ: z.string().max(20).optional(), descripcion: z.string().max(1000), importe: money});
export const profileSchema = z.object({
  id: z.string().min(1).max(200), rfc: rfcSchema,
  businessName: z.string().trim().min(2).max(200), regimeCode: z.string().min(3).max(100),
  createdAt: date,
});
export const profileInputSchema = profileSchema.omit({ id: true, createdAt: true });
export const transactionSchema = z.object({
  id: z.string().min(1).max(200), userId: z.string().min(1).max(200),
  accountId: z.string().min(1).max(200), amount: z.number().finite().min(-1e10).max(1e10).refine(isCentAmount, 'El movimiento admite como máximo dos decimales').transform(roundToCents),
  currency: z.string().regex(/^[A-Z]{3}$/), date,
  description: z.string().min(1).max(1000),
  status: z.enum(['conciliado', 'ambiguo', 'discrepancia']),
  matchedCfdiId: z.string().max(200).nullable().optional(),
  candidateCfdiIds: z.array(z.string().max(200)).max(WORKSPACE_DOCUMENT_LIMIT).optional(),
  alertReason: z.string().max(1000).optional(), reconciliationLocked: z.boolean().optional(),
});
export const satVerificationSchema = z.object({
  source: z.literal('sat'), checkedAt: z.iso.datetime(),
  outcome: z.enum(['found', 'not_found', 'invalid_query', 'unavailable']),
  status: z.enum(['vigente', 'cancelado', 'no_verificado']),
  code: z.enum(['S', 'N601', 'N602']).optional(),
  efos: z.enum(['listed', 'not_listed', 'unknown']),
  cancelability: z.string().max(100).optional(), cancellationStatus: z.string().max(100).optional(),
});
const uuid = z.string().regex(/^[\dA-F]{8}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{12}$/);
const decimalAmount = z.string().max(17).regex(/^\d{1,10}(?:\.\d{1,6})?$/);
const positiveDecimal = decimalAmount.refine(value => Number(value) > 0, 'El importe debe ser positivo');
const paymentCurrency = z.string().regex(/^[A-Z]{3}$/).refine(value => value !== 'XXX', 'El pago requiere una moneda');
const equivalence = z.string().max(21).regex(/^\d{1,10}(?:\.\d{1,10})?$/).refine(value => Number(value) > 0, 'La equivalencia debe ser positiva');
const scaledDecimal = (value: string, digits: number) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0'));
};
const relatedPaymentDocumentSchema = z.object({
  uuid, currency: paymentCurrency, equivalence: equivalence.optional(), installment: z.number().int().min(1).max(999),
  previousBalance: decimalAmount, paidAmount: positiveDecimal, remainingBalance: decimalAmount,
  taxObject: z.string().regex(/^\d{2}$/),
}).superRefine((record, ctx) => {
  if ([record.previousBalance, record.paidAmount, record.remainingBalance].some(value => !/^\d{1,10}(?:\.\d{1,6})?$/.test(value))) return;
  if (scaledDecimal(record.previousBalance, 6) - scaledDecimal(record.paidAmount, 6) !== scaledDecimal(record.remainingBalance, 6)) {
    ctx.addIssue({code: 'custom', message: 'Saldo anterior menos importe pagado debe coincidir con saldo insoluto'});
  }
});
const paymentSchema = z.object({
  date, currency: paymentCurrency, amount: positiveDecimal, form: z.string().regex(/^\d{2}$/),
  exchangeRate: positiveDecimal.optional(), relatedDocuments: z.array(relatedPaymentDocumentSchema).min(1).max(1000),
}).superRefine((payment, ctx) => {
  if (payment.currency !== 'MXN' && !payment.exchangeRate) ctx.addIssue({code:'custom', message:'Falta el tipo de cambio declarado del pago'});
  if (payment.currency === 'MXN' && payment.exchangeRate && Number(payment.exchangeRate) !== 1) ctx.addIssue({code:'custom', message:'El tipo de cambio MXN debe ser uno'});
  const seen = new Set<string>();
  for (const document of payment.relatedDocuments) {
    if (seen.has(document.uuid)) ctx.addIssue({code:'custom', message:'UUID repetido dentro del mismo pago'});
    seen.add(document.uuid);
    if (document.currency !== payment.currency && !document.equivalence) ctx.addIssue({code:'custom', message:'Falta equivalencia entre monedas declaradas'});
    if (document.currency === payment.currency && document.equivalence && Number(document.equivalence) !== 1) ctx.addIssue({code:'custom', message:'La equivalencia de la misma moneda debe ser uno'});
  }
  if (/^\d{1,10}(?:\.\d{1,6})?$/.test(payment.amount) && payment.relatedDocuments.every(record => /^\d{1,10}(?:\.\d{1,6})?$/.test(record.paidAmount))) {
    const sameCurrencyPaid = payment.relatedDocuments.filter(record => record.currency === payment.currency).reduce((sum, record) => sum + scaledDecimal(record.paidAmount, 6), 0n);
    if (sameCurrencyPaid > scaledDecimal(payment.amount, 6)) ctx.addIssue({code:'custom', message:'Los documentos en la moneda del pago superan el monto declarado'});
  }
});
const paymentComplementSchema = z.object({
  version: z.literal('2.0'), totalPaymentsMxn: z.string().max(13).regex(/^\d{1,10}(?:\.\d{1,2})?$/),
  payments: z.array(paymentSchema).min(1).max(100),
}).superRefine((complement, ctx) => {
  if (complement.payments.reduce((count, payment) => count + payment.relatedDocuments.length, 0) > 1000) ctx.addIssue({code:'custom', message:'El complemento supera el límite de documentos relacionados'});
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(complement.totalPaymentsMxn) || complement.payments.some(payment => !/^\d{1,10}(?:\.\d{1,6})?$/.test(payment.amount) || (payment.exchangeRate !== undefined && !/^\d{1,10}(?:\.\d{1,6})?$/.test(payment.exchangeRate)))) return;
  const sum = complement.payments.reduce((total, payment) => total + scaledDecimal(payment.amount, 6) * scaledDecimal(payment.exchangeRate ?? '1', 6), 0n);
  const roundedCents = (sum + 5_000_000_000n) / 10_000_000_000n;
  if (roundedCents !== scaledDecimal(complement.totalPaymentsMxn, 2)) ctx.addIssue({code:'custom', message:'El total de pagos MXN no coincide con los montos y tipos de cambio declarados'});
});
export const cfdiSchema = z.object({
  id: z.string().min(1).max(200), userId: z.string().min(1).max(200),
  uuidSat: z.string().max(200), rfcEmisor: rfcSchema, rfcReceptor: rfcSchema,
  nombreEmisor: z.string().max(200).optional(), nombreReceptor: z.string().max(200).optional(),
  total: money, subtotal: money, iva: money, retenciones: money, fechaEmision: date,
  tipoComprobante: z.enum(['I', 'E', 'T', 'N', 'P']),
  statusSat: z.enum(['vigente', 'cancelado', 'no_verificado']), isEfos: z.boolean(),
  sourceType: z.enum(['xml', 'pdf', 'image', 'manual']).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(), descuento: money.optional(),
  usoCfdi: z.string().max(5).optional(), formaPago: z.string().max(2).optional(),
  metodoPago: z.enum(['PUE', 'PPD']).optional(),
  relatedCfdis: z.array(z.object({type:z.string().regex(/^0[1-9]$/), uuids:z.array(uuid).min(1).max(1000)})).max(20).optional(),
  paymentComplement: paymentComplementSchema.optional(),
  conceptos: z.array(conceptSchema).max(1000).optional(),
  rawXml: z.string().max(2_000_000).optional(),
  satVerification: satVerificationSchema.optional(),
  attachment: z.object({
    contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
    bytes: z.number().int().min(1).max(5 * 1024 * 1024),
    sha256: z.string().regex(/^[\da-f]{64}$/), source: z.enum(['pdf', 'image']),
  }).optional(),
}).superRefine((document, ctx) => {
  if (document.relatedCfdis) {
    if (document.relatedCfdis.reduce((count, relation) => count + relation.uuids.length, 0) > 1000) ctx.addIssue({code:'custom', message:'Demasiadas referencias documentales'});
    for (const relation of document.relatedCfdis) if (new Set(relation.uuids).size !== relation.uuids.length || relation.uuids.includes(document.uuidSat.toUpperCase())) ctx.addIssue({code:'custom', message:'Referencias duplicadas o al mismo comprobante'});
  }
  if (document.tipoComprobante === 'P' && !document.paymentComplement) ctx.addIssue({code:'custom', message:'El CFDI de pago necesita su complemento Pagos 2.0'});
  if (document.paymentComplement && (document.tipoComprobante !== 'P' || document.currency !== 'XXX' || document.total !== 0 || document.subtotal !== 0 || document.iva !== 0 || document.retenciones !== 0)) ctx.addIssue({code:'custom', message:'El complemento de pagos requiere CFDI P con total cero y moneda XXX'});
  if (document.paymentComplement?.payments.some(payment => payment.relatedDocuments.some(record => record.uuid === document.uuidSat.toUpperCase()))) ctx.addIssue({code:'custom', message:'El pago no puede referirse a su propio UUID'});
});
export const snapshotSchema = z.object({
  profile: profileSchema, transactions: z.array(transactionSchema).max(WORKSPACE_TRANSACTION_LIMIT), cfdis: z.array(cfdiSchema).max(WORKSPACE_DOCUMENT_LIMIT),
}).superRefine((snapshot, context) => {
  if ([...snapshot.transactions, ...snapshot.cfdis].some(record => record.userId !== snapshot.profile.id)) {
    context.addIssue({code: 'custom', message: 'Los registros deben pertenecer al perfil activo'});
  }
});
export const manualDocumentSchema = z.object({
  rfcEmisor: rfcSchema, nombreEmisor: z.string().trim().min(2).max(200),
  subtotal: centMoney, iva: centMoney, retenciones: centMoney, fechaEmision: date,
  currency: z.literal('MXN').default('MXN'), usoCfdi: z.string().max(5).optional(),
  formaPago: z.string().max(2).optional(), conceptos: z.array(conceptSchema.extend({importe: centMoney})).max(1000).optional(),
}).refine(value => value.subtotal + value.iva >= value.retenciones, 'Las retenciones superan el total')
  .refine(value => roundToCents(value.subtotal + value.iva - value.retenciones) > 0, 'El documento manual debe tener un total positivo');
