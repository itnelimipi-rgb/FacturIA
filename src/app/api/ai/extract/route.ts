import {requireUser} from '../../../../server/auth';
import {getPool} from '../../../../server/db';
import {assertSameOrigin, errorResponse, HttpError} from '../../../../server/http';
import {enforceAccountLimit} from '../../../../server/rateLimit';
import {aiConfigured, enforceDailyAiBudget, extractReceipt} from '../../../../server/ai';
import {DOCUMENT_FILE_LIMIT, validateDocumentFile, validateDocumentSignature} from '../../../../lib/documentExtraction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readBounded(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new HttpError(413, 'El archivo supera 5 MiB.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Solicitud vacía');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) { await reader.cancel(); throw new HttpError(413, 'El archivo supera 5 MiB.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Suggest the fields of a ticket or invoice PDF/photo. Nothing is saved here. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!aiConfigured()) throw new HttpError(404, 'La lectura con IA no está activada.');
    const user = await requireUser(request);
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new HttpError(415, 'Envía el archivo mediante FormData.');
    const profile = (await getPool().query<{rfc: string; business_name: string}>('SELECT rfc,business_name FROM app_profiles WHERE user_id=$1', [user.id])).rows[0];
    if (!profile) throw new HttpError(409, 'Configura primero tu perfil fiscal');
    await enforceAccountLimit(user.id, 'ai-extract', 30, 3600);
    const body = await readBounded(request, DOCUMENT_FILE_LIMIT + 100_000);
    const form = await new Response(new Uint8Array(body), {headers: {'Content-Type': request.headers.get('content-type')!}}).formData().catch(() => {throw new HttpError(400, 'Formulario inválido');});
    const file = form.get('file');
    if (!(file instanceof File) || form.getAll('file').length !== 1) throw new HttpError(400, 'Selecciona un PDF o una foto.');
    let source: 'pdf' | 'image';
    let bytes: Uint8Array;
    try {
      source = validateDocumentFile(file);
      bytes = new Uint8Array(await file.arrayBuffer());
      validateDocumentSignature(bytes, source);
    } catch (reason) { throw new HttpError(400, reason instanceof Error ? reason.message : 'Selecciona un PDF o una foto válida.'); }
    const extension = file.name.toLowerCase().split('.').pop();
    const mediaType = source === 'pdf' ? 'application/pdf' : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
    await enforceDailyAiBudget();
    const extraction = await extractReceipt({bytes, mediaType}, {rfc: profile.rfc, name: profile.business_name});
    return Response.json(extraction, {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {
    const response = errorResponse(error); response.headers.set('Cache-Control', 'no-store'); return response;
  }
}
