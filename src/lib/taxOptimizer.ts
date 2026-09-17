export interface CfdiUseCode {
  code: string;
  label: string;
  personal: boolean;
  business: boolean;
}

export const CFDI_USE_CODES: CfdiUseCode[] = [
  { code: 'D01', label: 'D01 — Honorarios médicos, dentales y hospitalarios', personal: true, business: false },
  { code: 'D02', label: 'D02 — Gastos médicos por incapacidad o discapacidad', personal: true, business: false },
  { code: 'D03', label: 'D03 — Gastos funerales', personal: true, business: false },
  { code: 'D04', label: 'D04 — Donativos', personal: true, business: false },
  { code: 'D05', label: 'D05 — Intereses reales por créditos hipotecarios', personal: true, business: false },
  { code: 'D06', label: 'D06 — Aportaciones voluntarias al SAR', personal: true, business: false },
  { code: 'D07', label: 'D07 — Primas por seguros de gastos médicos', personal: true, business: false },
  { code: 'D08', label: 'D08 — Transportación escolar obligatoria', personal: true, business: false },
  { code: 'D09', label: 'D09 — Depósitos en cuentas de ahorro / pensiones', personal: true, business: false },
  { code: 'D10', label: 'D10 — Pagos por servicios educativos (colegiaturas)', personal: true, business: false },
  { code: 'G01', label: 'G01 — Adquisición de mercancías', personal: false, business: true },
  { code: 'G02', label: 'G02 — Devoluciones, descuentos o bonificaciones', personal: false, business: true },
  { code: 'G03', label: 'G03 — Gastos en general', personal: false, business: true },
  { code: 'I01', label: 'I01 — Construcciones (inversión)', personal: false, business: true },
  { code: 'I08', label: 'I08 — Otra maquinaria y equipo (inversión)', personal: false, business: true },
  { code: 'P01', label: 'P01 — Por definir', personal: false, business: false },
];

export const PERSONAL_CODES = new Set(CFDI_USE_CODES.filter(c => c.personal).map(c => c.code));
export const BUSINESS_CODES = new Set(CFDI_USE_CODES.filter(c => c.business).map(c => c.code));
export const DEDUCTIBLE_PAYMENT_FORMS = new Set(['02', '03', '04', '28']);

export interface TaxSavingsResult {
  eligible: boolean;
  category: 'personal' | 'business' | null;
  rate: number;
  estimated_savings: number;
  reason: string;
}

export function simulatedIsrRate(subtotal: number): number {
  if (subtotal <= 3000) return 0.20;
  if (subtotal <= 10000) return 0.23;
  if (subtotal <= 25000) return 0.27;
  return 0.30;
}

export function calculateTaxSavings({
  cfdi_use,
  payment_form,
  subtotal
}: {
  cfdi_use: string;
  payment_form: string;
  subtotal: number;
}): TaxSavingsResult {
  subtotal = Number(subtotal || 0);
  const use = (cfdi_use || '').toUpperCase();

  if (!use || subtotal <= 0) {
    return {
      eligible: false,
      category: null,
      rate: 0,
      estimated_savings: 0,
      reason: 'Falta el Uso de CFDI o el subtotal para calcular el ahorro fiscal.'
    };
  }

  const isPersonal = PERSONAL_CODES.has(use);
  const isBusiness = BUSINESS_CODES.has(use);

  if (!isPersonal && !isBusiness) {
    return {
      eligible: false,
      category: null,
      rate: 0,
      estimated_savings: 0,
      reason: 'Este Uso de CFDI no corresponde a una deducción personal ni a un gasto de negocio deducible.'
    };
  }

  if (isPersonal && (!payment_form || !DEDUCTIBLE_PAYMENT_FORMS.has(payment_form))) {
    return {
      eligible: false,
      category: 'personal',
      rate: 0,
      estimated_savings: 0,
      reason: 'Las deducciones personales solo son válidas si se pagaron con transferencia, tarjeta o cheque nominativo — nunca en efectivo (forma de pago 01).'
    };
  }

  const rate = simulatedIsrRate(subtotal);
  const estimated_savings = Math.round(subtotal * rate * 100) / 100;

  return {
    eligible: true,
    category: isPersonal ? 'personal' : 'business',
    rate,
    estimated_savings,
    reason: isPersonal
      ? `Calificada como Deducción Personal Autorizada (Art. 151 LISR). Ahorro estimado con tasa ISR marginal del ${(rate * 100).toFixed(0)}%.`
      : `Gasto deducible para tu actividad económica. Ahorro estimado con tasa ISR marginal del ${(rate * 100).toFixed(0)}%.`
  };
}

export function buildAiSuggestions(recent: Array<{ cfdi_use?: string; payment_form?: string; subtotal?: number }>): string[] {
  const tips: string[] = [];
  const cashMissed = recent.filter(r => r.payment_form === '01' && PERSONAL_CODES.has((r.cfdi_use || '').toUpperCase()));

  if (cashMissed.length > 0) {
    const lost = cashMissed.reduce((a, r) => a + Number(r.subtotal || 0) * 0.25, 0);
    tips.push(`Detectamos ${cashMissed.length} gasto(s) pagado(s) en efectivo que calificarían como deducción personal. Si la próxima vez pagas con transferencia o tarjeta, podrías ahorrar hasta $${lost.toFixed(2)} adicionales de ISR.`);
  }

  if (!recent.some(r => (r.cfdi_use || '').toUpperCase() === 'D10')) {
    tips.push('Si pagas colegiaturas, solicita tu comprobante con Uso de CFDI "D10" para deducirla en tu declaración anual.');
  }

  if (!recent.some(r => (r.cfdi_use || '').toUpperCase() === 'G03')) {
    tips.push('Facturar servicios de internet, telefonía o coworking con "G03 — Gastos en general" reduce directamente tu base gravable mensual.');
  }

  if (!recent.some(r => ['D01', 'D02'].includes((r.cfdi_use || '').toUpperCase()))) {
    tips.push('Conserva y factura siempre tus recibos médicos y dentales ("D01") pagados con tarjeta; son de las deducciones personales con mayor retorno fiscal.');
  }

  if (tips.length === 0) {
    tips.push('Vas excelente: tu índice de deducibilidad supera el 85%. Sigue registrando cada factura para maximizar tu Escudo Fiscal.');
  }

  return tips.slice(0, 4);
}
