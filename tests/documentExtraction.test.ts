import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  collectDocumentText, createProvisionalDocument, DOCUMENT_FILE_LIMIT, DOCUMENT_TEXT_LIMIT,
  parseDocumentAmount, readImageDimensions, suggestDocumentFields,
  validateDocumentFile, validateDocumentSignature,
} from '../src/lib/documentExtraction';

const invoice = 'RFC Emisor: AAA010101AAA\nProveedor: PROVEEDOR DE PRUEBA\nFecha de emisión: 11/10/2026\nSubtotal: 1,000.00\nIVA: 160.00\nRetenciones: 0.00\nMoneda: MXN\nTotal: 1,160.00\nRFC Receptor: XAXX010101000';

test('PDF text is bounded while streaming and releases a reader before oversized content is accumulated', async () => {
  let cancelled = false;
  const stream = new ReadableStream({start(controller) {
    controller.enqueue({items: [{str: 'Subtotal: 100.00', hasEOL: true}, {type: 'beginMarkedContent'}]});
    controller.enqueue({items: [{str: 'x'.repeat(100)}]});
  }, cancel() { cancelled = true; }});
  await assert.rejects(() => collectDocumentText(stream, 50), /demasiado texto/);
  assert.equal(cancelled, true); assert.equal(stream.locked, false);
  const small = new ReadableStream({start(controller) { controller.enqueue({items: [{str: 'Total: 116.00', hasEOL: true}]}); controller.close(); }});
  assert.equal(await collectDocumentText(small), 'Total: 116.00\n');
});

test('local suggestions read labeled amounts and issuer without inventing fiscal identity', () => {
  const result = suggestDocumentFields(invoice);
  assert.deepEqual(result.draft, {rfcEmisor: 'AAA010101AAA', nombreEmisor: 'PROVEEDOR DE PRUEBA', fechaEmision: '2026-10-11', subtotal: '1000.00', iva: '160.00', retenciones: '0.00', currency: 'MXN'});
  assert.equal(result.detectedTotal, '1160.00');
  assert.deepEqual(result.detectedRfcs, ['AAA010101AAA', 'XAXX010101000']);
  assert.ok(!JSON.stringify(result).includes('uuidSat'));
});

test('missing issuer, taxes and currency remain blank even when total and RFC candidates exist', () => {
  const result = suggestDocumentFields('Total: $116.00\nRFC Receptor: XAXX010101000\nAAAA1234567\nFecha: 2026-10-11');
  assert.equal(result.draft.rfcEmisor, ''); assert.equal(result.draft.subtotal, '');
  assert.equal(result.draft.iva, ''); assert.equal(result.draft.retenciones, ''); assert.equal(result.draft.currency, '');
  assert.equal(result.detectedTotal, '116.00');
  assert.throws(() => createProvisionalDocument(result.draft, {userId: 'owner', rfcReceptor: 'XAXX010101000'}, 'document'), /subtotal/);
});

test('percentages, repeated labels and malformed dates cannot become confident suggestions', () => {
  const result = suggestDocumentFields('IVA 16% 160.00\nSubtotal: 100.00\nSubtotal: 200.00\nFecha: 31/02/2026\nRFC Emisor: AAA010101AAA\nRFC Emisor: BBB010101BBB');
  assert.equal(result.draft.iva, ''); assert.equal(result.draft.subtotal, '');
  assert.equal(result.draft.fechaEmision, ''); assert.equal(result.draft.rfcEmisor, '');
  assert.throws(() => suggestDocumentFields('a'.repeat(DOCUMENT_TEXT_LIMIT + 1)), /demasiado texto/);
});

test('money parsing preserves cents and fails closed on OCR garbage or ambiguous decimal grouping', () => {
  for (const [input, expected] of [['1,234.50', '1234.50'], ['1.234,50', '1234.50'], ['12,5', '12.50'], ['$ 0.00', '0.00'], ['10 MXN', '10.00']]) assert.equal(parseDocumentAmount(input), expected);
  for (const input of ['', '16%', '1.234', '1 234.00', '-20', '1e3', '100.001', 'O00.00', '1,23,4', 'NaN', 'Infinity']) assert.equal(parseDocumentAmount(input), null, input);
});

test('confirmed provisional records keep no UUID or official verification and require complete tax fields', () => {
  const draft = suggestDocumentFields(invoice).draft;
  const document = createProvisionalDocument(draft, {userId: 'session-owner', rfcReceptor: 'XAXX010101000'}, 'generated-id');
  assert.equal(document.total, 1160); assert.equal(document.userId, 'session-owner');
  assert.equal(document.uuidSat, ''); assert.equal(document.statusSat, 'no_verificado');
  assert.equal(document.isEfos, false); assert.equal(document.sourceType, 'manual');
  assert.ok(!('rawXml' in document));
  for (const modification of [{iva: ''}, {retenciones: ''}, {currency: 'USD'}, {fechaEmision: '2026-02-31'}, {rfcEmisor: 'bad'}, {retenciones: '9999'}]) {
    assert.throws(() => createProvisionalDocument({...draft, ...modification}, {userId: 'owner', rfcReceptor: 'XAXX010101000'}, 'id'));
  }
});

test('file validation bounds MIME, byte size and format before extraction', () => {
  assert.equal(validateDocumentFile({name: 'invoice.PDF', type: 'application/pdf', size: DOCUMENT_FILE_LIMIT}), 'pdf');
  assert.equal(validateDocumentFile({name: 'photo.jpeg', type: '', size: 100}), 'image');
  for (const file of [{name: 'bad.svg', type: 'image/svg+xml', size: 100}, {name: 'bad.pdf', type: 'text/html', size: 100}, {name: 'large.pdf', type: 'application/pdf', size: DOCUMENT_FILE_LIMIT + 1}, {name: 'zero.png', type: '', size: 0}]) assert.throws(() => validateDocumentFile(file));
  assert.doesNotThrow(() => validateDocumentSignature(new TextEncoder().encode('%PDF-1.7'), 'pdf'));
  assert.throws(() => validateDocumentSignature(new TextEncoder().encode('<html>'), 'pdf'), /PDF válido/);
});

function png(width: number, height: number) {
  const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set(new TextEncoder().encode('IHDR'), 12);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height); return bytes;
}
test('raster header validation rejects decompression bomb dimensions before browser decoding', () => {
  assert.deepEqual(readImageDimensions(png(2000, 2000)), {width: 2000, height: 2000});
  assert.throws(() => readImageDimensions(png(5000, 5000)), /5 millones/);
  assert.throws(() => readImageDimensions(png(0, 100)), /dimensiones/);
  assert.throws(() => readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17])), /dimensiones/);
  const webp = new Uint8Array(30); webp.set(new TextEncoder().encode('RIFF'), 0); webp.set(new TextEncoder().encode('WEBPVP8X'), 8); webp[20] = 2;
  assert.throws(() => readImageDimensions(webp), /estática/);
});

test('OCR supervisor cancels its child while engine initialization is still pending', async () => {
  const source = await readFile(new URL('../public/document-tools-runner.js', import.meta.url), 'utf8');
  let terminated = 0, closed = 0, messages = 0;
  class FakeWorker { terminate() { terminated++; } }
  const scope: Record<string, unknown> = {Worker: FakeWorker, location: {origin: 'https://facturia.example'}, postMessage: () => { messages++; }, close: () => { closed++; }};
  scope.importScripts = () => {
    scope.Tesseract = {createWorker: () => { new (scope.Worker as typeof FakeWorker)(); return new Promise(() => undefined); }};
  };
  const context = vm.createContext({self: scope, ArrayBuffer, Uint8Array, Set});
  vm.runInContext(source, context);
  const handler = scope.onmessage as (event: {data: unknown}) => Promise<void>;
  void handler({data: {action: 'recognize', image: new ArrayBuffer(10)}});
  await handler({data: {action: 'cancel'}});
  assert.equal(terminated, 1); assert.equal(closed, 1); assert.equal(messages, 0);
});

test('OCR supervisor releases engine child and reports only text after successful recognition', async () => {
  const source = await readFile(new URL('../public/document-tools-runner.js', import.meta.url), 'utf8');
  let terminated = 0;
  const messages: {type: string; text?: string}[] = [];
  class FakeWorker { terminate() { terminated++; } }
  const scope: Record<string, unknown> = {Worker: FakeWorker, location: {origin: 'https://facturia.example'}, postMessage: (message: {type: string}) => messages.push(message), close: () => undefined};
  scope.importScripts = () => {
    scope.Tesseract = {createWorker: async (_language: string, _engine: number, options: Record<string, unknown>) => {
      assert.equal(options.langPath, 'https://facturia.example/document-tools/ocr/lang'); assert.equal(options.cacheMethod, 'none');
      const raw = new (scope.Worker as typeof FakeWorker)();
      return {recognize: async () => ({data: {text: 'Total: 116.00'}}), terminate: () => raw.terminate()};
    }};
  };
  const context = vm.createContext({self: scope, ArrayBuffer, Uint8Array, Set});
  vm.runInContext(source, context);
  await (scope.onmessage as (event: {data: unknown}) => Promise<void>)({data: {action: 'recognize', image: new ArrayBuffer(10)}});
  assert.equal(terminated, 1); assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{type: 'result', text: 'Total: 116.00'}]);
});
