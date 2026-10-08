import { snapshotSchema } from '../../../lib/validation';
import { MatchingEngineService } from '../../../lib/MatchingEngineService';
import { errorResponse, readJson } from '../../../server/http';

export async function POST(request: Request) {
  try {
    const input = snapshotSchema.parse(await readJson(request));
    const transactions = MatchingEngineService.evaluateBatch(input.transactions, input.cfdis, input.profile);
    return Response.json({success: true, transactions, metrics: MatchingEngineService.calculateCashFlowShieldMetrics(transactions, input.cfdis)});
  } catch (error) { return errorResponse(error); }
}
