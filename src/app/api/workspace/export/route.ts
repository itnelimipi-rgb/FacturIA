import { requireUser } from '../../../../server/auth';
import { getPool } from '../../../../server/db';
import { errorResponse, HttpError } from '../../../../server/http';
import { WorkspaceRepository } from '../../../../server/workspaceRepository';
import { serializeWorkspaceBackup, WorkspaceExportLimitError } from '../../../../lib/workspaceExport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};

/** Account identity comes exclusively from the authenticated session, never request parameters. */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const snapshot = await new WorkspaceRepository(getPool()).getExport(user.id);
    const backup = serializeWorkspaceBackup(snapshot, {mode: 'workspace'});
    return new Response(backup, {headers: {
      ...privateHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="facturia-respaldo-v1.json"',
    }});
  } catch (error) {
    const response = errorResponse(error instanceof WorkspaceExportLimitError ? new HttpError(413, error.message) : error);
    for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
    return response;
  }
}
