import { z } from 'zod';
import { MAX_WORKSPACE_EXPORT_BYTES } from '../../../../lib/workspaceExport';
import { requireUser } from '../../../../server/auth';
import { getPool } from '../../../../server/db';
import { assertSameOrigin, errorResponse, readJson } from '../../../../server/http';
import { WorkspaceRepository } from '../../../../server/workspaceRepository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const restoreRequestSchema = z.object({action: z.enum(['preview', 'restore']), backup: z.unknown()});
const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    // Allow the maximum exported backup plus its small request envelope. The
    // stream reader enforces real UTF-8 bytes even without Content-Length.
    const input = restoreRequestSchema.parse(await readJson(request, MAX_WORKSPACE_EXPORT_BYTES + 1024));
    const repository = new WorkspaceRepository(getPool());
    if (input.action === 'preview') {
      return Response.json({
        preview: await repository.previewRestore(user.id, input.backup),
        warning: 'Se restaurará sólo en un espacio vacío. Los XML se validan de nuevo y la conciliación se recalcula; esto no consulta SAT ni EFOS. Se conservan las pausas y alertas previas. Tu perfil actual se conserva.',
      }, {headers});
    }
    return Response.json(await repository.restore(user.id, input.backup), {headers});
  } catch (error) {
    const response = errorResponse(error);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
