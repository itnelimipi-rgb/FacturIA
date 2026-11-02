import Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {z} from 'zod';
import {getPool} from './db';
import {databaseRateLimit} from './rateLimit';
import {HttpError} from './http';
import {parseDocumentAmount, type DocumentDraft} from '../lib/documentExtraction';
import {rfcSchema} from '../lib/validation';

const DEFAULT_MODEL = 'claude-haiku-5-5';
const DEFAULT_DAILY_LIMIT = 300;

/** AI features exist only when the server holds an Anthropic key; the browser never sees it. */
export function aiConfigured(): boolean {
  return (process.env.ANTHROPIC_API_KEY?.trim().length ?? 0) > 0;
}

/** Haiku by default; FACTURIA_AI_MODEL may select another Haiku or Sonnet model. */
export function aiModel(): string {
  const model = process.env.FACTURIA_AI_MODEL?.trim();
  return model && /^claude-(?:haiku|sonnet)-[a-z0-9.-]+$/.test(model) ? model : DEFAULT_MODEL;
}

/** The SDK surface used here, so tests can provide a recorded response instead of a network call. */
export type MessagesClient = Pick<Anthropic, 'messages'>;

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  client ??= new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1});
  return client;
}

/** A global daily ceiling protects the token budget across every account and replica. */
export async function enforceDailyAiBudget() {
  const configured = Number(process.env.FACTURIA_AI_DAILY_LIMIT);
  const max = Number.isInteger(configured) && configured >= 1 && configured <= 10000 ? configured : DEFAULT_DAILY_LIMIT;
  const result = await databaseRateLimit(getPool(), 'ai-daily').consume('all-accounts', {window: 86400, max});
  if (!result.allowed) throw new HttpError(429, 'La ayuda con IA alcanzó su límite de hoy. Puedes seguir capturando los datos a mano.');
}

function aiFailure(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof Anthropic.RateLimitError) return new HttpError(429, 'La IA está ocupada. Intenta de nuevo en un minuto.');
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    console.error('FacturIA AI credentials rejected');
    return new HttpError(503, 'La ayuda con IA no está disponible en este momento.');
  }
  if (error instanceof Anthropic.APIConnectionError) return new HttpError(503, 'No pudimos conectar con la IA. Intenta de nuevo.');
  if (error instanceof Anthropic.APIError) {
    console.error('FacturIA AI request failed', error.status);
    return new HttpError(502, 'La IA no pudo responder. Intenta de nuevo.');
  }
  console.error('FacturIA AI request failed', error instanceof Error ? error.name : 'UnknownError');
  return new HttpError(502, 'La IA no pudo responder. Intenta de nuevo.');
}

const receiptSchema = z.object({
  esComprobante: z.boolean(),
  proveedor: z.string(),
  rfcProveedor: z.string(),
  fecha: z.string(),
  moneda: z.string(),
  subtotal: z.string(),
  iva: z.string(),
  retenciones: z.string(),
  total: z.string(),
  concepto: z.string(),
});

export type ReceiptExtraction = {
  isReceipt: boolean;
  draft: DocumentDraft;
  total: string;
  concept: string;
  foreignCurrency: string;
};

const validDay = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return '';
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && year <= 2099 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? match[0] : '';
};

/** Read a ticket or invoice PDF/photo. Every field is a suggestion the person reviews before saving. */
export async function extractReceipt(file: {bytes: Uint8Array; mediaType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp'}, owner: {rfc: string; name: string}, api: MessagesClient = anthropic()): Promise<ReceiptExtraction> {
  const data = Buffer.from(file.bytes).toString('base64');
  const source = file.mediaType === 'application/pdf'
    ? {type: 'document' as const, source: {type: 'base64' as const, media_type: 'application/pdf' as const, data}}
    : {type: 'image' as const, source: {type: 'base64' as const, media_type: file.mediaType, data}};
  let parsed: z.infer<typeof receiptSchema> | null;
  try {
    const response = await api.messages.parse({
      model: aiModel(),
      max_tokens: 4000,
      system: 'Lees comprobantes de gasto de México (tickets, notas de venta o facturas en PDF o foto) y devuelves sus datos tal como aparecen escritos, sin calcular ni suponer valores.',
      messages: [{role: 'user', content: [source, {type: 'text', text: [
        `Extrae los datos de este comprobante para registrar un gasto de ${owner.name} (RFC ${owner.rfc}).`,
        '- Copia sólo lo que esté escrito. Si un dato no aparece o no se lee con claridad, deja el texto vacío.',
        '- proveedor: nombre o razón social de quien vende o emite el comprobante.',
        `- rfcProveedor: RFC de quien emite (12 o 13 caracteres). Nunca uses el RFC del cliente ${owner.rfc}.`,
        '- fecha: fecha de emisión en formato AAAA-MM-DD.',
        '- moneda: código de tres letras; MXN si dice pesos o M.N.',
        '- subtotal, iva, retenciones y total: números con punto decimal, sin símbolos ni separadores de miles (por ejemplo 1234.50). Escribe iva o retenciones sólo si el documento muestra ese importe; si dice que no tiene retenciones o no aparecen, deja retenciones vacío.',
        '- concepto: descripción breve de lo que se compró, máximo 80 caracteres.',
        '- esComprobante: false si el archivo no es un comprobante de compra o gasto.',
      ].join('\n')}]}],
      output_config: {effort: 'low', format: zodOutputFormat(receiptSchema)},
    });
    if (response.stop_reason === 'refusal') throw new HttpError(422, 'No pudimos leer este archivo con IA. Captura los datos a mano.');
    parsed = response.parsed_output;
  } catch (error) {
    throw aiFailure(error);
  }
  if (!parsed) throw new HttpError(502, 'La IA no devolvió datos legibles. Captura los datos a mano.');
  const rfc = parsed.rfcProveedor.toUpperCase().replace(/[\s-]/g, '');
  const amount = (value: string) => value.trim() ? parseDocumentAmount(value) ?? '' : '';
  const currency = parsed.moneda.trim().toUpperCase();
  return {
    isReceipt: parsed.esComprobante,
    draft: {
      rfcEmisor: rfcSchema.safeParse(rfc).success && rfc !== owner.rfc.toUpperCase() ? rfc : '',
      nombreEmisor: parsed.proveedor.trim().slice(0, 200),
      fechaEmision: validDay(parsed.fecha),
      subtotal: amount(parsed.subtotal), iva: amount(parsed.iva), retenciones: amount(parsed.retenciones),
      currency: !currency || currency === 'MXN' ? 'MXN' : '',
    },
    total: amount(parsed.total),
    concept: parsed.concepto.trim().slice(0, 120),
    foreignCurrency: currency && currency !== 'MXN' && /^[A-Z]{3}$/.test(currency) ? currency : '',
  };
}

const ASSISTANT_SYSTEM = [
  'Eres el asistente de FacturIA, una app mexicana que junta los movimientos del banco con sus facturas (CFDI).',
  'Responde en español de México, con frases cortas y amables, en máximo 120 palabras. Usa pasos numerados sólo cuando expliques cómo hacer algo.',
  'La app tiene cuatro secciones: Inicio (lo pendiente y el resumen), Movimientos (lo que entró y salió del banco), Documentos (facturas, pagos, notas y gastos) y Asistente.',
  'El botón «Subir archivos» acepta varias facturas XML, PDF, fotos de tickets y el estado de cuenta en CSV a la vez; la app detecta cada tipo y junta cada factura con su movimiento automáticamente.',
  'Estados de un movimiento: «Con factura» (ya tiene factura vinculada), «Elige la factura» (hay varias posibles; se resuelve con el botón Elegir factura), «Sin factura» (se resuelve con Subir factura) y «Búsqueda pausada» (se reactiva con Volver a buscar).',
  'Para cifras usa únicamente los datos JSON que acompañan la pregunta; si un dato no está, dilo. No inventes movimientos, facturas ni importes.',
  'La app no emite ni timbra facturas, no mueve dinero y no se conecta al banco. Una factura vinculada no es una confirmación del SAT; la consulta al SAT se hace desde el detalle de cada XML.',
  'No determines deducciones, impuestos a pagar ni obligaciones fiscales: explica lo que muestran los datos y sugiere confirmarlo con su contador.',
].join('\n');

export type AssistantTurn = {role: 'user' | 'assistant'; text: string};

/** A short answer grounded in the account facts computed by the app. */
export async function answerWithAi(question: string, history: AssistantTurn[], context: unknown, api: MessagesClient = anthropic()): Promise<string> {
  const turns = history.filter(turn => turn.text.trim()).slice(-6);
  while (turns[0]?.role === 'assistant') turns.shift();
  const messages: Anthropic.MessageParam[] = [
    ...turns.map(turn => ({role: turn.role, content: turn.text.slice(0, 2000)})),
    {role: 'user', content: `Datos actuales de la cuenta (JSON):\n${JSON.stringify(context)}\n\nPregunta: ${question}`},
  ];
  try {
    const response = await api.messages.create({
      model: aiModel(), max_tokens: 2000, system: ASSISTANT_SYSTEM, messages,
      output_config: {effort: 'low'},
    });
    if (response.stop_reason === 'refusal') return 'No puedo ayudarte con esa pregunta. Puedo explicarte tus pendientes, tus movimientos o cómo usar FacturIA.';
    const text = response.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim();
    if (!text) throw new HttpError(502, 'La IA devolvió una respuesta vacía.');
    return text.slice(0, 4000);
  } catch (error) {
    throw aiFailure(error);
  }
}
