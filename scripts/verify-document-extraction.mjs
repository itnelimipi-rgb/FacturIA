import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
import { createWorker } from 'tesseract.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { suggestDocumentFields } from '../src/lib/documentExtraction.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const lines = ['RFC Emisor: AAA010101AAA', 'Proveedor: PRUEBA LOCAL', 'Fecha: 2026-10-11', 'Subtotal: 100.00', 'IVA: 16.00', 'Retenciones: 0.00', 'Moneda: MXN', 'Total: 116.00'];
// A complete synthetic one-page PDF avoids external samples and personal data.
const stream = `BT /F1 14 Tf 50 740 Td 24 TL ${lines.map((line, index) => `${index ? 'T* ' : ''}(${line}) Tj`).join('\n')} ET`;
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
];
let pdf = '%PDF-1.7\n'; const offsets = [0];
for (let index = 0; index < objects.length; index++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const task = getDocument({data: new Uint8Array(Buffer.from(pdf)), standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts/') + '/', useSystemFonts: false});
try {
  const document = await task.promise;
  const page = await document.getPage(1);
  const text = (await page.getTextContent()).items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
  assert.equal(suggestDocumentFields(text).draft.subtotal, '100.00');
  assert.equal(suggestDocumentFields(text).detectedTotal, '116.00');
  console.log('PASS PDF.js real: texto de PDF sintético extraído.');
} finally { await task.destroy(); }

const canvas = createCanvas(1000, 520);
const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 1000, 520);
context.fillStyle = 'black'; context.font = '34px sans-serif';
lines.forEach((line, index) => context.fillText(line, 40, 55 + index * 55));
if (process.argv.includes('--write-fixtures')) {
  const directory = resolve(root, 'node_modules/.cache/document-fixtures');
  await mkdir(directory, {recursive: true});
  await writeFile(resolve(directory, 'prueba-sintetica.pdf'), pdf);
  await writeFile(resolve(directory, 'prueba-sintetica.png'), canvas.toBuffer('image/png'));
  console.log('Fixtures sintéticos PDF y PNG guardados en la caché local para pruebas del navegador.');
}
const timer = setTimeout(() => { console.error('La comprobación OCR superó 60 segundos.'); process.exit(1); }, 60_000);
let worker;
try {
  worker = await createWorker('spa', 1, {langPath: resolve(root, 'public/document-tools/ocr/lang'), cacheMethod: 'none', errorHandler: () => undefined});
  const result = await worker.recognize(canvas.toBuffer('image/png'));
  const suggestions = suggestDocumentFields(result.data.text);
  assert.equal(suggestions.draft.subtotal, '100.00'); assert.equal(suggestions.detectedTotal, '116.00');
  console.log('PASS Tesseract/WASM real: español local y totales del PNG sintético reconocidos.');
} finally { clearTimeout(timer); if (worker) await worker.terminate(); }
