import {
  assertDocumentDimensions, collectDocumentText, DOCUMENT_EXTRACTION_TIMEOUT, DOCUMENT_OCR_PAGE_LIMIT,
  DOCUMENT_PDF_PAGE_LIMIT, DOCUMENT_PIXEL_LIMIT, DOCUMENT_TEXT_LIMIT,
  validateDocumentFile, validateDocumentSignature,
} from './documentExtraction';

export type ExtractionResult = {text: string; method: 'pdf-text' | 'ocr'; pages: number};
export type ExtractionProgress = {label: string; percent: number};

/** OCR runs in a supervisor so cancellation also works while its engine is loading. */
export function recognizeDocumentImage(bytes: Uint8Array, signal: AbortSignal, progress: (value: ExtractionProgress) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Lectura cancelada', 'AbortError')); return; }
    const worker = new Worker('/document-tools-runner.js');
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      worker.postMessage({action: 'cancel'});
      // The supervisor explicitly terminates its child, including during createWorker().
      // The fallback also releases a supervisor that failed to load.
      setTimeout(() => worker.terminate(), 250);
    };
    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) reject(error); else resolve(text || '');
    };
    const abort = () => finish(new DOMException('Lectura cancelada', 'AbortError'));
    signal.addEventListener('abort', abort, {once: true});
    worker.onmessage = event => {
      const message = event.data;
      if (message?.type === 'progress') progress({label: 'Reconociendo texto en español…', percent: Math.min(100, Math.max(0, Number(message.progress) * 100 || 0))});
      else if (message?.type === 'result' && typeof message.text === 'string') {
        if (message.text.length > DOCUMENT_TEXT_LIMIT) finish(new Error('El documento contiene demasiado texto para revisar.'));
        else finish(undefined, message.text);
      } else if (message?.type === 'error') finish(new Error('No se pudo reconocer la imagen. Prueba una foto más clara o captura el gasto manualmente.'));
    };
    worker.onerror = event => { event.preventDefault(); finish(new Error('No se pudo cargar el motor OCR. Actualiza la página e inténtalo otra vez.')); };
    const transfer = bytes.slice();
    worker.postMessage({action: 'recognize', image: transfer.buffer}, [transfer.buffer]);
  });
}

function canvasBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) { reject(new Error('No se pudo preparar la página para OCR.')); return; }
    blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject);
  }, 'image/png'));
}

export async function extractDocumentInBrowser(file: File, options: {signal: AbortSignal; onProgress: (progress: ExtractionProgress) => void}): Promise<ExtractionResult> {
  const source = validateDocumentFile(file);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener('abort', abort, {once: true});
  if (options.signal.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, DOCUMENT_EXTRACTION_TIMEOUT);
  const cancelled = () => { if (controller.signal.aborted) throw new DOMException('Lectura cancelada', 'AbortError'); };
  const pending: (() => void)[] = [];
  const onAbort = () => { for (const cleanup of pending) cleanup(); };
  controller.signal.addEventListener('abort', onAbort);
  try {
    cancelled(); options.onProgress({label: 'Validando archivo…', percent: 0});
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateDocumentSignature(bytes, source); cancelled();
    if (source === 'image') {
      // The header was bounded before decoding; check actual decoded dimensions too.
      const image = await createImageBitmap(file);
      try {
        assertDocumentDimensions(image.width, image.height); cancelled();
        const text = await recognizeDocumentImage(bytes, controller.signal, options.onProgress);
        return {text, method: 'ocr', pages: 1};
      } finally { image.close(); }
    }
    const pdfjs = await import('pdfjs-dist'); cancelled();
    pdfjs.GlobalWorkerOptions.workerSrc = '/document-tools/pdf/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({
      data: bytes, stopAtErrors: true, maxImageSize: DOCUMENT_PIXEL_LIMIT,
      canvasMaxAreaInBytes: DOCUMENT_PIXEL_LIMIT * 4, enableXfa: false,
      cMapUrl: '/document-tools/pdf/cmaps/', cMapPacked: true,
      standardFontDataUrl: '/document-tools/pdf/standard_fonts/', wasmUrl: '/document-tools/pdf/wasm/', iccUrl: '/document-tools/pdf/iccs/',
    });
    pending.push(() => { void task.destroy().catch(() => undefined); });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > DOCUMENT_PDF_PAGE_LIMIT) throw new Error('El PDF supera 10 páginas. Divide el archivo para revisarlo.');
      let text = '';
      let usedOcr = false;
      for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex++) {
        cancelled(); options.onProgress({label: `Leyendo página ${pageIndex} de ${pdf.numPages}…`, percent: (pageIndex - 1) / pdf.numPages * 100});
        const page = await pdf.getPage(pageIndex);
        try {
          let pageText = await collectDocumentText(page.streamTextContent(), DOCUMENT_TEXT_LIMIT - text.length);
          if (pageText.trim().length < 20) {
            if (pdf.numPages > DOCUMENT_OCR_PAGE_LIMIT) throw new Error('Los PDF escaneados admiten hasta 3 páginas. Divide el archivo para usar OCR.');
            usedOcr = true;
            const base = page.getViewport({scale: 1});
            const scale = Math.min(2, Math.sqrt(DOCUMENT_PIXEL_LIMIT / (base.width * base.height)));
            const viewport = page.getViewport({scale});
            const width = Math.floor(viewport.width), height = Math.floor(viewport.height);
            assertDocumentDimensions(width, height);
            const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
            try {
              const context = canvas.getContext('2d');
              if (!context) throw new Error('Tu navegador no permite preparar el PDF para OCR.');
              const render = page.render({canvasContext: context, canvas, viewport});
              const cancelRender = () => render.cancel(); pending.push(cancelRender);
              await render.promise; cancelled();
              pageText = await recognizeDocumentImage(await canvasBytes(canvas), controller.signal, options.onProgress);
              pending.splice(pending.indexOf(cancelRender), 1);
            } finally { canvas.width = 0; canvas.height = 0; }
          }
          text += `${pageText}\n`;
          if (text.length > DOCUMENT_TEXT_LIMIT) throw new Error('El documento contiene demasiado texto para revisar.');
        } finally { page.cleanup(); }
      }
      cancelled();
      if (!text.trim()) throw new Error('No se encontró texto legible. Prueba una foto más clara o captura el gasto manualmente.');
      return {text, method: usedOcr ? 'ocr' : 'pdf-text', pages: pdf.numPages};
    } finally { await task.destroy(); pending.length = 0; }
  } catch (error) {
    if (timedOut) throw new Error('La lectura superó 60 segundos y se detuvo. Prueba un archivo más pequeño o captura el gasto manualmente.', {cause: error});
    if (controller.signal.aborted) throw new DOMException('Lectura cancelada', 'AbortError');
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('El PDF tiene contraseña. Utiliza una copia sin contraseña.', {cause: error});
    throw error;
  } finally {
    clearTimeout(timer); options.signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort);
    for (const cleanup of pending) cleanup();
  }
}
