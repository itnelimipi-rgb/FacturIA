import { NextRequest, NextResponse } from 'next/server';
import { EfosService } from '../../../lib/efosService';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rfc = searchParams.get('rfc');

  if (!rfc) {
    return NextResponse.json({
      blacklistCount: EfosService.getAll().length,
      allEntries: EfosService.getAll()
    });
  }

  const result = EfosService.checkRfc(rfc);
  return NextResponse.json(result);
}
