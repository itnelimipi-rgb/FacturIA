/* Tesseract.js supervisor. Only engine assets are fetched; document pixels stay here. */
const childWorkers = new Set();
const NativeWorker = self.Worker;
self.Worker = class extends NativeWorker {
  constructor(...args) { super(...args); childWorkers.add(this); }
  terminate() { childWorkers.delete(this); super.terminate(); }
};
let cancelled = false;
let started = false;
const stop = () => {
  cancelled = true;
  for (const worker of childWorkers) worker.terminate();
  childWorkers.clear();
};
self.onmessage = async event => {
  if (event.data?.action === 'cancel') { stop(); self.close(); return; }
  if (started || event.data?.action !== 'recognize' || !(event.data.image instanceof ArrayBuffer)) return;
  started = true;
  try {
    // Classic bundle supports dedicated workers; paths are absolute and same origin.
    self.importScripts('/document-tools/ocr/tesseract.min.js');
    const worker = await self.Tesseract.createWorker('spa', 1, {
      workerPath: `${self.location.origin}/document-tools/ocr/worker.min.js`,
      corePath: `${self.location.origin}/document-tools/ocr/core`,
      langPath: `${self.location.origin}/document-tools/ocr/lang`,
      cacheMethod: 'none', workerBlobURL: false,
      logger: message => { if (!cancelled) self.postMessage({type: 'progress', progress: message.progress || 0}); },
      errorHandler: () => { if (!cancelled) self.postMessage({type: 'error'}); stop(); },
    });
    if (cancelled) { await worker.terminate(); return; }
    const result = await worker.recognize(new Uint8Array(event.data.image));
    if (!cancelled) self.postMessage({type: 'result', text: result.data.text});
    await worker.terminate();
  } catch { if (!cancelled) self.postMessage({type: 'error'}); }
  finally { stop(); }
};
