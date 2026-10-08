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
  candidateCfdiIds: z.array(z.string().max(200)).max(100).optional(),
  alertReason: z.string().max(1000).optional(), reconciliationLocked: z.boolean().optional(),
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
  conceptos: z.array(conceptSchema).max(1000).optional(),
  rawXml: z.string().max(2_000_000).optional(),
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
