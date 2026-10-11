import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { CfdiRecord, SatVerification } from '../lib/types';
import { rfcSchema } from '../lib/validation';
import { HttpError } from './http';

// The service is fixed: neither a client URL nor redirects can change the destination.
export const SAT_SERVICE_URL = 'https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc';
export const SAT_RESPONSE_MAX_BYTES = 256 * 1024;
export const SAT_QUERY_TIMEOUT_MS = 12_000;
export const SAT_DOCUMENT_COOLDOWN_MS = 60_000;
const SOAP_NAMESPACE = 'http://schemas.xmlsoap.org/soap/envelope/';
const SERVICE_NAMESPACE = 'http://tempuri.org/';
const RESULT_NAMESPACE = 'http://schemas.datacontract.org/2004/07/Sat.Cfdi.Negocio.ConsultaCfdi.Servicio';
const uuidPattern = /^[\dA-F]{8}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{12}$/i;
type Node = Record<string, unknown>;
type Namespaces = Record<string, string>;
type Element = {node: Node; namespaces: Namespaces};
const parser = new XMLParser({ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, trimValues: true});

export class SatResponseError extends Error {
  constructor() { super('El SAT no devolvió una respuesta de consulta válida'); this.name = 'SatResponseError'; }
}

function object(value: unknown): Node {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SatResponseError();
  return value as Node;
}
function namespaces(node: Node, inherited: Namespaces): Namespaces {
  const result = {...inherited};
  for (const [key, value] of Object.entries(node)) {
    if (key === '@_xmlns' && typeof value === 'string') result[''] = value;
    else if (key.startsWith('@_xmlns:') && typeof value === 'string') result[key.slice(8)] = value;
  }
  return result;
}
function child(parent: Node, inherited: Namespaces, localName: string, namespace: string): Element {
  const matches: Element[] = [];
  for (const [name, value] of Object.entries(parent)) {
    if (name.startsWith('@_') || name.startsWith('#') || name.startsWith('?')) continue;
    const parts = name.split(':');
    if (parts.length > 2 || parts.at(-1) !== localName) continue;
    const node = object(value);
    const scope = namespaces(node, inherited);
    if (scope[parts.length === 2 ? parts[0] : ''] !== namespace) throw new SatResponseError();
    matches.push({node, namespaces: scope});
  }
  if (matches.length !== 1) throw new SatResponseError();
  return matches[0];
}
function field(parent: Element, name: string, required = false): string | undefined {
  let found = false;
  let result: string | undefined;
  for (const [key, value] of Object.entries(parent.node)) {
    if (key.startsWith('@_') || key.startsWith('#')) continue;
    const parts = key.split(':');
    if (parts.at(-1) !== name) continue;
    if (found || parts.length > 2 || Array.isArray(value)) throw new SatResponseError();
    found = true;
    const node = typeof value === 'string' ? null : object(value);
    const scope = node ? namespaces(node, parent.namespaces) : parent.namespaces;
    if (scope[parts.length === 2 ? parts[0] : ''] !== RESULT_NAMESPACE) throw new SatResponseError();
    if (node && Object.keys(node).some(key => !key.startsWith('@_') && key !== '#text')) throw new SatResponseError();
    const text = node ? node['#text'] : value;
    if (text === undefined || text === '') continue;
    if (typeof text !== 'string' || text.length > 100 || [...text].some(character => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)))) throw new SatResponseError();
    result = text.trim() || undefined;
  }
  if (required && !result) throw new SatResponseError();
  return result;
}

/** Read only a SOAP 1.1 ConsultaResult in the SAT namespaces; never infer success from arbitrary XML text. */
export function parseSatResponse(xml: string, checkedAt = new Date().toISOString()): SatVerification {
  if (Buffer.byteLength(xml, 'utf8') > SAT_RESPONSE_MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)
    || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\dA-Fa-f]+);)/.test(xml)
    || XMLValidator.validate(xml) !== true) throw new SatResponseError();
  const tree = object(parser.parse(xml));
  const envelope = child(tree, {}, 'Envelope', SOAP_NAMESPACE);
  const body = child(envelope.node, envelope.namespaces, 'Body', SOAP_NAMESPACE);
  if (Object.keys(body.node).some(name => name.split(':').at(-1) === 'Fault')) throw new SatResponseError();
  const response = child(body.node, body.namespaces, 'ConsultaResponse', SERVICE_NAMESPACE);
  const result = child(response.node, response.namespaces, 'ConsultaResult', SERVICE_NAMESPACE);
  const code = field(result, 'CodigoEstatus', true)!;
  const state = field(result, 'Estado');
  const rawEfos = field(result, 'ValidacionEFOS');
  const cancelability = field(result, 'EsCancelable');
  const cancellationStatus = field(result, 'EstatusCancelacion');
  const base = {source: 'sat' as const, checkedAt, status: 'no_verificado' as const, efos: 'unknown' as const};
  if (/^N\s*-?\s*601(?::|\s|$)/i.test(code)) return {...base, outcome: 'invalid_query', code: 'N601'};
  if (/^N\s*-?\s*602(?::|\s|$)/i.test(code)) return {...base, outcome: 'not_found', code: 'N602'};
  if (!/^S(?:\s*-?\s|$)/.test(code) || (state !== 'Vigente' && state !== 'Cancelado')) throw new SatResponseError();
  return {
    ...base, outcome: 'found', code: 'S', status: state === 'Vigente' ? 'vigente' : 'cancelado',
    efos: rawEfos === '100' ? 'listed' : rawEfos === '200' ? 'not_listed' : 'unknown',
    ...(cancelability ? {cancelability} : {}), ...(cancellationStatus ? {cancellationStatus} : {}),
  };
}

export function satExpression(document: Pick<CfdiRecord, 'uuidSat' | 'rfcEmisor' | 'rfcReceptor' | 'total'>): string {
  if (!uuidPattern.test(document.uuidSat) || !rfcSchema.safeParse(document.rfcEmisor).success
    || !rfcSchema.safeParse(document.rfcReceptor).success || !Number.isFinite(document.total)
    || document.total < 0 || document.total > 1e10
    || Math.abs(document.total * 100 - Math.round(document.total * 100)) > 1e-6) {
    throw new HttpError(409, 'Este documento no tiene identidad e importe de CFDI válidos para consultar SAT');
  }
  // CFDI 3.3/4.0: omit insignificant zeroes but retain one decimal position.
  const total = document.total.toFixed(2).replace(/0$/, '');
  return `?re=${encodeURIComponent(document.rfcEmisor.toUpperCase())}&rr=${encodeURIComponent(document.rfcReceptor.toUpperCase())}&tt=${total}&id=${document.uuidSat.toUpperCase()}`;
}
function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** A transport failure is dated as unavailable and can never become a fiscal success. */
export async function querySatStatus(document: Pick<CfdiRecord, 'uuidSat' | 'rfcEmisor' | 'rfcReceptor' | 'total'>, fetcher: typeof fetch = fetch): Promise<SatVerification> {
  const expression = satExpression(document);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SAT_QUERY_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetcher(SAT_SERVICE_URL, {
      method: 'POST', redirect: 'error', signal: controller.signal, cache: 'no-store',
      headers: {'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"http://tempuri.org/IConsultaCFDIService/Consulta"', Accept: 'text/xml'},
      body: `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="${SOAP_NAMESPACE}"><s:Body><Consulta xmlns="${SERVICE_NAMESPACE}"><expresionImpresa>${escapeXml(expression)}</expresionImpresa></Consulta></s:Body></s:Envelope>`,
    });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/xml')
      || Number(response.headers.get('content-length')) > SAT_RESPONSE_MAX_BYTES) throw new SatResponseError();
    reader = response.body?.getReader();
    if (!reader) throw new SatResponseError();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > SAT_RESPONSE_MAX_BYTES) throw new SatResponseError();
      chunks.push(next.value);
    }
    return parseSatResponse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
  } catch {
    // No exception body, fiscal query, credential or raw SAT reply is returned/logged.
    return {source: 'sat', checkedAt: new Date().toISOString(), outcome: 'unavailable', status: 'no_verificado', efos: 'unknown'};
  } finally {
    clearTimeout(timeout);
    if (reader) await reader.cancel().catch(() => undefined);
  }
}

const recentQueries = new Map<string, number>();
let activeQueries = 0;
/** Bounded process guard; persisted document timestamps additionally survive service restarts. */
export function acquireSatQuery(userId: string, documentId: string, now = Date.now()): () => void {
  for (const [key, at] of recentQueries) if (now - at >= SAT_DOCUMENT_COOLDOWN_MS) recentQueries.delete(key);
  const key = JSON.stringify([userId, documentId]);
  if (recentQueries.has(key)) throw new HttpError(429, 'Espera un minuto antes de consultar otra vez este comprobante');
  const accountCount = [...recentQueries.keys()].filter(key => (JSON.parse(key) as string[])[0] === userId).length;
  if (accountCount >= 6 || activeQueries >= 4 || recentQueries.size >= 500) {
    throw new HttpError(429, 'El límite de consultas SAT está ocupado. Intenta de nuevo en un minuto');
  }
  recentQueries.set(key, now);
  activeQueries++;
  let released = false;
  return () => { if (!released) { released = true; activeQueries--; } };
}
