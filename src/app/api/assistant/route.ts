import { z } from 'zod';
import { snapshotSchema } from '../../../lib/validation';
import { MatchingEngineService } from '../../../lib/MatchingEngineService';
import { assistantReply } from '../../../lib/assistantService';
import { buildAssistantContext } from '../../../lib/assistantContext';
import { requireUser } from '../../../server/auth';
import { getPool } from '../../../server/db';
import { WorkspaceRepository } from '../../../server/workspaceRepository';
import { assertSameOrigin, errorResponse, HttpError, readJson } from '../../../server/http';
import { enforceAccountLimit } from '../../../server/rateLimit';
import { aiConfigured, answerWithAi, enforceDailyAiBudget } from '../../../server/ai';

const inputSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  mode: z.enum(['demo', 'workspace']),
  snapshot: snapshotSchema.optional(),
  history: z.array(z.object({role: z.enum(['user', 'assistant']), text: z.string().max(4000)})).max(12).optional(),
});

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await readJson(request));
    let snapshot;
    let userId: string | undefined;
    if (input.mode === 'workspace') {
      assertSameOrigin(request);
      const user = await requireUser(request);
      userId = user.id;
      snapshot = await new WorkspaceRepository(getPool()).get(user.id);
      if (!snapshot.profile) throw new HttpError(409, 'Configura primero tu perfil');
    } else {
      if (!input.snapshot) throw new HttpError(400, 'Faltan los datos de la demostración');
      snapshot = input.snapshot;
    }
    const profile = snapshot.profile!;
    // The public demo answers with rules only, so anonymous visitors cannot spend the AI budget.
    if (userId && aiConfigured()) {
      try {
        await enforceAccountLimit(userId, 'ai-assistant', 40, 3600);
        await enforceDailyAiBudget();
        const reply = await answerWithAi(input.message, input.history ?? [], buildAssistantContext({...snapshot, profile}));
        return Response.json({success: true, reply, mode: 'ai', generatedByAI: true});
      } catch (error) {
        if (!(error instanceof HttpError) || error.status < 429) throw error;
        // Quotas or an unavailable model fall back to the verified rules below.
      }
    }
    const transactions = MatchingEngineService.evaluateBatch(snapshot.transactions, snapshot.cfdis, profile);
    const metrics = MatchingEngineService.calculateCashFlowShieldMetrics(transactions, snapshot.cfdis);
    return Response.json({success: true, reply: assistantReply(input.message, metrics), mode: 'rules', generatedByAI: false});
  } catch (error) { return errorResponse(error); }
}
