import {requireUser} from '../../../../../server/auth';
import {getPool} from '../../../../../server/db';
import {assertSameOrigin, errorResponse, HttpError} from '../../../../../server/http';
import {DocumentFilesRepository, MAX_DOCUMENT_FILE_BYTES} from '../../../../../server/documentFiles';
import {enforceAccountLimit} from '../../../../../server/rateLimit';
export const runtime = 'nodejs';
let activeUploads = 0;
async function readUploadBody(request: Request, maxBytes: number): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Solicitud vacía');
  let interruption: HttpError | undefined;
  let rejectInterrupted!: (error: HttpError) => void;
  const interrupted = new Promise<never>((_, reject) => {rejectInterrupted = reject;});
  const cancel = () => {void reader.cancel().catch(() => {});};
  const stop = (error: HttpError) => {
    if (interruption) return;
    interruption = error;
    rejectInterrupted(error);
    // An underlying source's cancel callback can remain pending indefinitely.
    // Closing the reader is requested immediately without awaiting that callback.
    cancel();
  };
  const body = (async () => {
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (interruption) throw interruption;
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {cancel(); throw new HttpError(413, 'Solicitud demasiado grande');}
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'No se pudo leer el archivo enviado.');
    } finally {reader.releaseLock();}
  })();
  const aborted = () => stop(new HttpError(408, 'La carga del archivo se canceló. Intenta nuevamente.'));
  const timer = setTimeout(() => stop(new HttpError(408, 'La carga superó 30 segundos. Intenta nuevamente.')), 30_000);
  request.signal.addEventListener('abort', aborted, {once: true});
  if (request.signal.aborted) aborted();
  try {return await Promise.race([body, interrupted]);}
  finally {clearTimeout(timer); request.signal.removeEventListener('abort', aborted);}
}
export async function POST(request: Request) {
  let ownsUploadSlot = false;
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    await enforceAccountLimit(user.id, 'provisional-file', 5, 60);
    if (activeUploads >= 2) throw new HttpError(429, 'Hay dos originales en proceso. Intenta de nuevo en unos segundos.');
    activeUploads++; ownsUploadSlot = true;
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new HttpError(415, 'Envía el archivo y los campos mediante FormData.');
    const maxBytes = MAX_DOCUMENT_FILE_BYTES + 100_000;
    if (Number(request.headers.get('content-length')) > maxBytes) throw new HttpError(413, 'Solicitud demasiado grande');
    const body = await readUploadBody(request, maxBytes);
    const form = await new Response(new Uint8Array(body), {headers: {'Content-Type': request.headers.get('content-type')!}}).formData().catch(() => {throw new HttpError(400, 'Formulario inválido');});
    const file = form.get('file'); const documentText = form.get('document');
    if (!(file instanceof File) || typeof documentText !== 'string' || documentText.length > 90_000 || form.getAll('file').length !== 1 || form.getAll('document').length !== 1) throw new HttpError(400, 'Selecciona un original y sus campos revisados.');
    let document: unknown;
    try {document = JSON.parse(documentText);} catch {throw new HttpError(400, 'Campos inválidos');}
    const snapshot = await new DocumentFilesRepository(getPool()).createProvisional(user.id, document, new Uint8Array(await file.arrayBuffer()), file.type, request.headers.get('Idempotency-Key') ?? undefined);
    return Response.json(snapshot, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    const response = errorResponse(error); response.headers.set('Cache-Control', 'no-store'); response.headers.set('X-Content-Type-Options', 'nosniff'); return response;
  } finally {if (ownsUploadSlot) activeUploads--;}
}
