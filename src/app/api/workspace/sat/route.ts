import { z } from 'zod';
import { requireUser } from '../../../../server/auth';
import { getPool } from '../../../../server/db';
import { assertSameOrigin, errorResponse, readJson } from '../../../../server/http';
import { acquireSatQuery, querySatStatus } from '../../../../server/satStatus';
import { WorkspaceRepository } from '../../../../server/workspaceRepository';
import { enforceAccountLimit } from '../../../../server/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const requestSchema = z.object({documentId: z.string().min(1).max(200)}).strict();
const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};

export async function POST(request: Request) {
  let release: (() => void) | undefined;
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const {documentId} = requestSchema.parse(await readJson(request, 1024));
    await enforceAccountLimit(user.id, 'sat', 6, 60);
    const repository = new WorkspaceRepository(getPool());
    const document = await repository.getDocumentForSat(user.id, documentId);
    // A separate durable document bucket also closes concurrent requests across replicas.
    await enforceAccountLimit(JSON.stringify([user.id, documentId]), 'sat-document', 1, 60);
    release = acquireSatQuery(user.id, documentId);
    const consultation = await querySatStatus(document);
    const snapshot = await repository.saveSatConsultation(user.id, document, consultation);
    return Response.json({snapshot, consultation}, {headers});
  } catch (error) {
    const response = errorResponse(error);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    if (response.status === 429) response.headers.set('Retry-After', '60');
    return response;
  } finally { release?.(); }
}
