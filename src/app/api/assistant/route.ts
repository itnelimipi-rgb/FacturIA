import { z } from 'zod';
import { snapshotSchema } from '../../../lib/validation';
import { MatchingEngineService } from '../../../lib/MatchingEngineService';
import { assistantReply } from '../../../lib/assistantService';
import { requireUser } from '../../../server/auth';
import { getPool } from '../../../server/db';
import { WorkspaceRepository } from '../../../server/workspaceRepository';
import { errorResponse, HttpError, readJson } from '../../../server/http';

export async function POST(request: Request) {
  try {
    const input = z.object({message: z.string().trim().min(1).max(2000), mode: z.enum(['demo', 'workspace']), snapshot: snapshotSchema.optional()}).parse(await readJson(request));
    let snapshot;
    if (input.mode === 'workspace') {
      const user = await requireUser(request);
      snapshot = await new WorkspaceRepository(getPool()).get(user.id);
      if (!snapshot.profile) throw new HttpError(409, 'Configura primero tu perfil');
    } else {
      if (!input.snapshot) throw new HttpError(400, 'Faltan los datos de la demostración');
      snapshot = input.snapshot;
    }
    const transactions = MatchingEngineService.evaluateBatch(snapshot.transactions, snapshot.cfdis, snapshot.profile!);
    const metrics = MatchingEngineService.calculateCashFlowShieldMetrics(transactions, snapshot.cfdis);
    return Response.json({success: true, reply: assistantReply(input.message, metrics), mode: 'rules', generatedByAI: false});
  } catch (error) { return errorResponse(error); }
}
