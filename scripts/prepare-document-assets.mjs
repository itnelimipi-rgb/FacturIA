import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public/document-tools');
const copy = async (from, to) => { const target = resolve(output, to); await mkdir(dirname(target), {recursive: true}); await cp(resolve(root, 'node_modules', from), target, {recursive: true}); };
await copy('pdfjs-dist/build/pdf.worker.min.mjs', 'pdf/pdf.worker.min.mjs');
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) await copy(`pdfjs-dist/${folder}`, `pdf/${folder}`);
await copy('tesseract.js/dist/tesseract.min.js', 'ocr/tesseract.min.js');
await copy('tesseract.js/dist/worker.min.js', 'ocr/worker.min.js');
await copy('tesseract.js/dist/tesseract.min.js.LICENSE.txt', 'ocr/tesseract.min.js.LICENSE.txt');
await copy('tesseract.js/dist/worker.min.js.LICENSE.txt', 'ocr/worker.min.js.LICENSE.txt');
const coreFiles = await readdir(resolve(root, 'node_modules/tesseract.js-core'));
for (const filename of coreFiles.filter(name => /^tesseract-core.*\.(?:js|wasm)$/.test(name))) await copy(`tesseract.js-core/${filename}`, `ocr/core/${filename}`);
await copy('@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz', 'ocr/lang/spa.traineddata.gz');
for (const [from, to] of [['pdfjs-dist/LICENSE', 'pdf/LICENSE'], ['tesseract.js/LICENSE.md', 'ocr/LICENSE'], ['tesseract.js-core/LICENSE', 'ocr/core/LICENSE'], ['@tesseract.js-data/spa/package.json', 'ocr/lang/package.json'], ['@tesseract.js-data/spa/README.md', 'ocr/lang/README.md']]) await copy(from, to);
console.log('Activos PDF/OCR locales preparados.');
