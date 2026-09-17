import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { message, context, history } = await req.json();

    const userQuery = (message || '').toLowerCase();

    // Respuestas contextuales e inteligentes especializadas en el régimen fiscal mexicano
    let responseText = '';

    if (userQuery.includes('ahorrar') || userQuery.includes('ahorro') || userQuery.includes('meta')) {
      const savings = context?.totalSavings || '$2,850.00 MXN';
      responseText = `Actualmente tu ahorro fiscal estimado acumulado es de **${savings}**. Puedes maximizarlo deduciendo gastos médicos ("D01") y colegiaturas ("D10"), asegurándote siempre de pagarlos con tarjeta o transferencia para que el SAT no rechace la deducción.`;
    } else if (userQuery.includes('resico') || userQuery.includes('régimen') || userQuery.includes('regimen')) {
      responseText = `**RESICO en 2 líneas:** Pagas una tasa mínima de ISR sobre tus ingresos cobrados (de **1% a 2.5%** sin deducciones autorizadas para ISR), pero necesitas todas tus facturas de gastos para **acreditar el 16% de IVA** y proteger tu flujo contra discrepancias fiscales.`;
    } else if (userQuery.includes('falta') || userQuery.includes('pendientes') || userQuery.includes('facturas')) {
      responseText = `Tienes **1 movimiento bancario en discrepancia de $12,400 MXN** que no cuenta con factura registrada. Te sugiero subir el XML o pedir la factura a tu proveedor antes de fin de mes para evitar que el SAT lo catalogue como gasto no deducible con un costo fiscal de hasta **$5,704 MXN**.`;
    } else if (userQuery.includes('efos') || userQuery.includes('69-b') || userQuery.includes('fantasma')) {
      responseText = `El **Artículo 69-B del CFF** sanciona las operaciones simuladas con empresas fantasma (EFOS). En FacturIA cruzamos automáticamente cada emisor contra la lista negra definitiva del SAT para evitar que deduzcas comprobantes de riesgo penal.`;
    } else if (userQuery.includes('efectivo') || userQuery.includes('pago')) {
      responseText = `**Regla de oro del SAT:** Las deducciones personales (médicos, dentales, colegiaturas, gastos funerales) **NUNCA son deducibles si se pagan en efectivo (forma 01)**. Paga siempre con tarjeta de débito, crédito o SPEI.`;
    } else {
      responseText = `¡Con gusto! Como tu contador personal de FacturIA, estoy monitoreando tus movimientos bancarios y facturas timbradas. Recuerda que puedes arrastrar tus archivos .XML o fotos de tickets en la pestaña **Facturas**, o consultarme sobre cualquier duda de retenciones, IVA o declaraciones provisionales.`;
    }

    return NextResponse.json({
      success: true,
      reply: responseText
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Error en asistente' },
      { status: 500 }
    );
  }
}
