import { getAuth } from '../../../../server/auth';
import { errorResponse, readJson } from '../../../../server/http';

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
    return await getAuth().handler(request);
  }
  catch (error) { return errorResponse(error); }
}
export const GET = handler;
export const POST = handler;
