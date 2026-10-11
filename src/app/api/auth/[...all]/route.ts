import { getAuth } from '../../../../server/auth';
import { errorResponse, readJson, HttpError, assertSameOrigin } from '../../../../server/http';
import {mailConfigured} from '../../../../server/mail';

export const runtime = 'nodejs';
async function handler(request: Request) {
  try {
    if (request.method === 'POST') {
      // This app uses JSON email/password auth. Bound the actual streamed body
      // before Better Auth's JSON parser buffers an unauthenticated request.
      const body = await readJson(request, 64_000);
      const headers = new Headers(request.headers);
      headers.delete('content-length');
      request = new Request(request.url, {method: 'POST', headers, body: JSON.stringify(body), signal: request.signal});
    }
    const auth = getAuth();
    if (request.method === 'POST') {
      assertSameOrigin(request);
      if (['request-password-reset', 'send-verification-email'].includes(new URL(request.url).pathname.split('/').pop()!) && !mailConfigured()) {
        throw new HttpError(503, 'El envío de correo todavía no está configurado.');
      }
    }
    return await auth.handler(request);
  }
  catch (error) { return errorResponse(error); }
}
export const GET = handler;
export const POST = handler;
