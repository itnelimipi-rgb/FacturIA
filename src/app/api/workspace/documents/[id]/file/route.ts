import {requireUser} from '../../../../../../server/auth';
import {getPool} from '../../../../../../server/db';
import {errorResponse} from '../../../../../../server/http';
import {DocumentFilesRepository} from '../../../../../../server/documentFiles';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params: Promise<{id: string}>}) {
  try {
    const user = await requireUser(request);
    const {id} = await context.params;
    const file = await new DocumentFilesRepository(getPool()).get(user.id, id);
    const extension = {'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}[file.content_type];
    return new Response(new Uint8Array(file.content), {headers: {'Content-Type': file.content_type, 'Content-Length': String(file.bytes),
      'Content-Disposition': `attachment; filename="facturia-original.${extension}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"}});
  } catch (error) {
    const response = errorResponse(error); response.headers.set('Cache-Control', 'no-store'); response.headers.set('X-Content-Type-Options', 'nosniff'); return response;
  }
}
