import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function readJson(request: Request, maxBytes = 3_000_000): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'Envía application/json');
  if (Number(request.headers.get('content-length')) > maxBytes) throw new HttpError(413, 'Solicitud demasiado grande');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Solicitud vacía');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) { await reader.cancel(); throw new HttpError(413, 'Solicitud demasiado grande'); }
    chunks.push(value);
  }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); }
  catch { throw new HttpError(400, 'JSON inválido'); }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expected = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
  if (!origin || origin !== new URL(expected).origin) throw new HttpError(403, 'Origen no permitido');
}

export function errorResponse(error: unknown) {
  if (error instanceof ZodError) return Response.json({error: 'Datos inválidos', details: error.issues.map(issue => issue.message)}, {status: 400});
  if (error instanceof HttpError) return Response.json({error: error.message}, {status: error.status});
  const dbCode = (error as {code?: string})?.code;
  if (dbCode === '23505') return Response.json({error: 'Este registro ya existe'}, {status: 409});
  console.error('FacturIA request failed', error instanceof Error ? error.name : 'UnknownError');
  return Response.json({error: 'No se pudo completar la operación'}, {status: 500});
}
