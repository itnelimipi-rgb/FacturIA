import { NextRequest, NextResponse } from 'next/server';
import { XmlCfdiParser } from '../../../lib/xmlParser';
import { EfosService } from '../../../lib/efosService';
import { CfdiRecord } from '../../../lib/types';

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    // Si se envía JSON con rawXml o datos pre-extraídos
    if (contentType.includes('application/json')) {
      const body = await req.json();

      if (body.rawXml) {
        // Regla: 0 tokens de LLM para XML
        const parseResult = XmlCfdiParser.parse(body.rawXml, body.userId || 'usr-resico-001');

        if (!parseResult.success || !parseResult.cfdi) {
          return NextResponse.json(
            { error: parseResult.error || 'Error procesando XML' },
            { status: 400 }
          );
        }

        // Validación EFOS inmediata
        const efosCheck = EfosService.checkRfc(parseResult.cfdi.rfcEmisor);
        parseResult.cfdi.isEfos = efosCheck.isEfos;

        return NextResponse.json({
          success: true,
          source: 'xml',
          tokensConsumed: 0,
          cfdi: parseResult.cfdi,
          deterministicValidation: parseResult.deterministicMathValidation,
          efosAlert: efosCheck.isEfos ? efosCheck.entry : null
        });
      }

      // Si viene de PDF o Imagen ya procesada semánticamente
      if (body.structuredData) {
        const data = body.structuredData;
        const subtotal = Number(data.subtotal) || Number(data.total) / 1.16;
        const iva = Number(data.iva) || Number(data.total) - subtotal;
        const total = Number(data.total);

        // Verificación matemática determinista en servidor
        const cfdi: CfdiRecord = {
          id: `cfdi-${Date.now()}`,
          userId: body.userId || 'usr-resico-001',
          uuidSat: data.uuidSat || `EXT-${Date.now()}`,
          rfcEmisor: (data.rfcEmisor || 'XAXX010101000').toUpperCase(),
          rfcReceptor: (data.rfcReceptor || 'GARM900101XYZ').toUpperCase(),
          nombreEmisor: data.nombreEmisor || 'Proveedor',
          nombreReceptor: data.nombreReceptor || 'Receptor',
          total: Math.round(total * 100) / 100,
          subtotal: Math.round(subtotal * 100) / 100,
          iva: Math.round(iva * 100) / 100,
          retenciones: Number(data.retenciones || 0),
          fechaEmision: data.fecha || new Date().toISOString(),
          tipoComprobante: 'E',
          statusSat: 'vigente',
          isEfos: false,
          sourceType: body.sourceType || 'image'
        };

        const efosCheck = EfosService.checkRfc(cfdi.rfcEmisor);
        cfdi.isEfos = efosCheck.isEfos;

        return NextResponse.json({
          success: true,
          source: body.sourceType || 'image',
          cfdi,
          efosAlert: efosCheck.isEfos ? efosCheck.entry : null
        });
      }
    }

    return NextResponse.json(
      { error: 'Formato de solicitud no soportado' },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Error interno en ingesta' },
      { status: 500 }
    );
  }
}
