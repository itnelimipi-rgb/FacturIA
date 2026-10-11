import { manualDocumentSchema, rfcSchema } from './validation';
import type { CfdiRecord } from './types';

export const DOCUMENT_FILE_LIMIT = 5 * 1024 * 1024;
export const DOCUMENT_PIXEL_LIMIT = 5_000_000;
export const DOCUMENT_TEXT_LIMIT = 100_000;
export const DOCUMENT_PDF_PAGE_LIMIT = 10;
export const DOCUMENT_OCR_PAGE_LIMIT = 3;
export const DOCUMENT_EXTRACTION_TIMEOUT = 60_000;

export type DocumentSource = 'pdf' | 'image';
export type DocumentDraft = {
  rfcEmisor: string; nombreEmisor: string; fechaEmision: string;
  subtotal: string; iva: string; retenciones: string; currency: string;
};
export type DocumentSuggestions = {draft: DocumentDraft; detectedRfcs: string[]; detectedTotal: string; warnings: string[]};

export async function collectDocumentText(stream: ReadableStream<{items: ({str: string; hasEOL?: boolean} | {type: string})[]}>, remaining = DOCUMENT_TEXT_LIMIT): Promise<string> {
  const reader = stream.getReader();
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text;
      for (const item of chunk.value.items) {
        if (!('str' in item)) continue;
        if (text.length + item.str.length + 1 > remaining) throw new Error('El documento contiene demasiado texto para revisar.');
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export function validateDocumentFile(file: Pick<File, 'name' | 'type' | 'size'>): DocumentSource {
  if (!file.size || file.size > DOCUMENT_FILE_LIMIT) throw new Error('Selecciona un archivo de hasta 5 MiB.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  const expected = extension === 'pdf' ? 'application/pdf' : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : ['jpg', 'jpeg'].includes(extension || '') ? 'image/jpeg' : '';
  if (!expected || (file.type && file.type !== expected)) throw new Error('Selecciona un PDF, PNG, JPEG o WebP válido.');
  return extension === 'pdf' ? 'pdf' : 'image';
}

export function validateDocumentSignature(bytes: Uint8Array, source: DocumentSource): void {
  if (source === 'pdf') {
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('El archivo no contiene un PDF válido.');
    return;
  }
  readImageDimensions(bytes);
}

export function assertDocumentDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > DOCUMENT_PIXEL_LIMIT) {
    throw new Error('La imagen supera 5 millones de píxeles. Reduce su resolución e inténtalo otra vez.');
  }
}

/** Check raster headers before asking the browser to allocate decoded pixels. */
export function readImageDimensions(bytes: Uint8Array): {width: number; height: number} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) => new TextDecoder().decode(bytes.subarray(start, start + length));
  let width = 0, height = 0;
  if (bytes.length >= 24 && bytes.subarray(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]) && ascii(12, 4) === 'IHDR') {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if ([0xd8, 0x01, ...Array.from({length: 8}, (_, index) => index + 0xd0)].includes(marker)) continue;
      if ([0xda, 0xd9].includes(marker) || offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  } else if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') {
      if (bytes[20] & 0x02) throw new Error('Usa una imagen WebP estática.');
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    }
  }
  if (!width || !height) throw new Error('No se pudieron validar las dimensiones de la imagen. Usa PNG, JPEG o WebP estático.');
  assertDocumentDimensions(width, height);
  return {width, height};
}

/** Locale-aware decimal parsing with exact cents; percentages and uncertain grouping are rejected. */
export function parseDocumentAmount(value: string): string | null {
  const raw = value.trim().replace(/^(?:MXN\s*|\$\s*)/i, '').replace(/\s*MXN$/i, '').trim();
  if (!raw || !/^[\d.,]+$/.test(raw)) return null;
  let normalized: string;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(raw)) normalized = raw.replaceAll(',', '');
  else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(raw)) normalized = raw.replaceAll('.', '').replace(',', '.');
  else if (/^\d+(?:[.,]\d{1,2})?$/.test(raw)) normalized = raw.replace(',', '.');
  else return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 && amount <= 1e10 ? amount.toFixed(2) : null;
}

function calendarDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && year <= 2099 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

export function suggestDocumentFields(input: string): DocumentSuggestions {
  if (input.length > DOCUMENT_TEXT_LIMIT) throw new Error('El documento contiene demasiado texto para revisar.');
  const text = input.replaceAll('\r', '').replaceAll('\u00a0', ' ');
  const detectedRfcs = [...new Set(text.toUpperCase().match(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z\d]{3}\b/g) || [])].filter(value => rfcSchema.safeParse(value).success).slice(0, 20);
  const field = (label: string) => {
    const matches = [...text.matchAll(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*[:=]?\\s*([^\\n]+)`, 'gim'))];
    return matches.length === 1 ? matches[0][1].trim() : '';
  };
  const amount = (label: string) => {
    const value = field(label);
    // A line such as "IVA 16% 160.00" is uncertain and must be entered by the user.
    return value ? parseDocumentAmount(value) || '' : '';
  };
  const issuer = field('RFC\\s*(?:del\\s*)?Emisor|Emisor\\s*RFC|RFC\\s*(?:del\\s*)?Proveedor').toUpperCase();
  const rawDate = field('Fecha(?:\\s+de)?\\s+(?:emisi[oó]n|expedici[oó]n)|Fecha');
  const rawLatinDate = /^(\d{2})[/.-](\d{2})[/.-](\d{4})(?:\s|$)/.exec(rawDate);
  const iso = /^\d{4}-\d{2}-\d{2}(?=T|\s|$)/.exec(rawDate)?.[0];
  const date = iso || (rawLatinDate ? `${rawLatinDate[3]}-${rawLatinDate[2]}-${rawLatinDate[1]}` : '');
  const currency = field('Moneda').toUpperCase();
  const draft: DocumentDraft = {
    rfcEmisor: rfcSchema.safeParse(issuer).success ? issuer : '',
    nombreEmisor: field('Nombre\\s*(?:del\\s*)?Emisor|Raz[oó]n\\s+social(?:\\s*(?:del\\s*)?Emisor)?|Proveedor').slice(0, 200),
    fechaEmision: calendarDate(date) || '', subtotal: amount('Sub\\s*total'),
    iva: amount('IVA(?:\\s+trasladado)?'), retenciones: amount('Retenciones(?:\\s+totales)?'),
    currency: currency === 'MXN' ? 'MXN' : '',
  };
  const warnings = ['Revisa cada dato. La extracción puede omitir o confundir información.', 'El registro será provisional, sin UUID ni verificación SAT.'];
  if (!draft.iva || !draft.retenciones) warnings.push('Captura los impuestos que aparecen en el documento; indica 0 sólo si confirmas que no existen.');
  return {draft, detectedRfcs, detectedTotal: amount('Total(?:\\s+a\\s+pagar)?'), warnings};
}

export function createProvisionalDocument(draft: DocumentDraft, owner: {userId: string; rfcReceptor: string}, id: string): CfdiRecord {
  const values = [draft.subtotal, draft.iva, draft.retenciones].map(parseDocumentAmount);
  if (values.some(value => value === null)) throw new Error('Captura subtotal, IVA y retenciones con un máximo de dos decimales.');
  const document = manualDocumentSchema.safeParse({
    rfcEmisor: draft.rfcEmisor, nombreEmisor: draft.nombreEmisor,
    fechaEmision: draft.fechaEmision, subtotal: Number(values[0]), iva: Number(values[1]), retenciones: Number(values[2]), currency: draft.currency,
  });
  if (!document.success || !rfcSchema.safeParse(owner.rfcReceptor).success) throw new Error('Revisa RFC, proveedor, fecha e importes. Por ahora el registro provisional admite MXN.');
  return {...document.data, id, userId: owner.userId, rfcReceptor: owner.rfcReceptor,
    total: Math.round((document.data.subtotal + document.data.iva - document.data.retenciones) * 100) / 100,
    uuidSat: '', tipoComprobante: 'I', statusSat: 'no_verificado', isEfos: false, sourceType: 'manual',
  };
}
