import { z } from 'zod';
import { XmlCfdiParser } from '../../../lib/xmlParser';
import { errorResponse, HttpError, readJson } from '../../../server/http';

export async function POST(request: Request) {
  try {
    const input = z.object({rawXml: z.string().min(1).max(2_000_000)}).parse(await readJson(request));
    const result = XmlCfdiParser.parse(input.rawXml);
    if (!result.success || !result.cfdi) throw new HttpError(400, result.error || 'CFDI inválido');
    return Response.json({success: true, source: 'xml', tokensConsumed: 0, cfdi: result.cfdi, deterministicValidation: result.deterministicMathValidation,
      checks: {sat: 'no_verificado', efos: 'no_verificado'}});
  } catch (error) { return errorResponse(error); }
}
