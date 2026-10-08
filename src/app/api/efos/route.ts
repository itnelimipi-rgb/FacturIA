import { NextRequest, NextResponse } from 'next/server';
import { EfosService } from '../../../lib/efosService';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rfc = searchParams.get('rfc');

  if (!rfc) {
    return NextResponse.json({
      source: 'demo',
      verified: false,
      message: 'Lista de ejemplo. No consulta la publicación oficial del SAT.',
      blacklistCount: EfosService.getAll().length,
      allEntries: EfosService.getAll()
    });
  }

  const result = EfosService.checkRfc(rfc);
  return NextResponse.json({...result, source: 'demo', verified: false, message: 'Resultado simulado. Requiere consulta oficial del SAT.'});
}
