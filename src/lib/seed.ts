import { Profile, BankTransaction, CfdiRecord } from './types';

export const SEED_PROFILE: Profile = {
  id: 'usr-resico-001',
  rfc: 'GARM900101XYZ',
  businessName: 'GARCÍA MARTÍNEZ TECH & CONSULTING',
  regimeCode: '626 - Régimen Simplificado de Confianza (RESICO)',
  createdAt: '2026-01-15T08:00:00Z'
};

export const SEED_CFDIS: CfdiRecord[] = [
  // 1. CFDI de gasto proveedor cloud (Match con tx-001)
  {
    id: 'cfdi-001',
    userId: 'usr-resico-001',
    uuidSat: '550E8400-E29B-41D4-A716-446655440001',
    rfcEmisor: 'GWO1204018A2',
    nombreEmisor: 'Google Cloud México S. de R.L. de C.V.',
    rfcReceptor: 'GARM900101XYZ',
    nombreReceptor: 'GARCÍA MARTÍNEZ TECH & CONSULTING',
    total: 1160.00,
    subtotal: 1000.00,
    iva: 160.00,
    retenciones: 0.00,
    fechaEmision: '2026-09-08T10:15:00Z',
    tipoComprobante: 'I',
    statusSat: 'vigente',
    isEfos: false,
    conceptos: [
      {
        claveProdServ: '43231500',
        descripcion: 'Suscripción Cloud Workspace Business Standard (5 usuarios)',
        importe: 1000.00
      }
    ],
    sourceType: 'xml'
  },
  // 2. CFDI de ingreso por servicio de consultoría (Match con tx-002)
  {
    id: 'cfdi-002',
    userId: 'usr-resico-001',
    uuidSat: '550E8400-E29B-41D4-A716-446655440002',
    rfcEmisor: 'GARM900101XYZ',
    nombreEmisor: 'GARCÍA MARTÍNEZ TECH & CONSULTING',
    rfcReceptor: 'CLI1806059X1',
    nombreReceptor: 'Cliente Corporativo Finanzas S.A. de C.V.',
    total: 29000.00,
    subtotal: 25000.00,
    iva: 4000.00,
    retenciones: 312.50, // Retención 1.25% ISR en RESICO Personas Físicas a Morales
    fechaEmision: '2026-09-07T16:00:00Z',
    tipoComprobante: 'I',
    statusSat: 'vigente',
    isEfos: false,
    conceptos: [
      {
        claveProdServ: '80101500',
        descripcion: 'Servicios de arquitectura de software y optimización cloud - Hito 1',
        importe: 25000.00
      }
    ],
    sourceType: 'xml'
  },
  // 3. CFDI de gasto coworking (Match con tx-003)
  {
    id: 'cfdi-003',
    userId: 'usr-resico-001',
    uuidSat: '550E8400-E29B-41D4-A716-446655440003',
    rfcEmisor: 'WEW1503126T8',
    nombreEmisor: 'Espacios Coworking Reforma S.A.P.I. de C.V.',
    rfcReceptor: 'GARM900101XYZ',
    nombreReceptor: 'GARCÍA MARTÍNEZ TECH & CONSULTING',
    total: 450.00,
    subtotal: 387.93,
    iva: 62.07,
    retenciones: 0.00,
    fechaEmision: '2026-09-09T09:30:00Z',
    tipoComprobante: 'I',
    statusSat: 'vigente',
    isEfos: false,
    conceptos: [
      {
        claveProdServ: '80131502',
        descripcion: 'Pase diario coworking sala ejecutiva y fibra óptica',
        importe: 387.93
      }
    ],
    sourceType: 'pdf'
  },
  // 4. Candidato A para Ambigua: Publicidad Meta Ads ($500.00)
  {
    id: 'cfdi-004a',
    userId: 'usr-resico-001',
    uuidSat: '550E8400-E29B-41D4-A716-446655440004',
    rfcEmisor: 'MET190415AA1',
    nombreEmisor: 'Meta Platforms Advertising México S. de R.L.',
    rfcReceptor: 'GARM900101XYZ',
    nombreReceptor: 'GARCÍA MARTÍNEZ TECH & CONSULTING',
    total: 500.00,
    subtotal: 431.03,
    iva: 68.97,
    retenciones: 0.00,
    fechaEmision: '2026-09-08T18:20:00Z',
    tipoComprobante: 'I',
    statusSat: 'vigente',
    isEfos: false,
    conceptos: [
      {
        claveProdServ: '82101603',
        descripcion: 'Publicidad en medios digitales de redes sociales',
        importe: 431.03
      }
    ],
    sourceType: 'xml'
  },
  // 5. Candidato B para Ambigua: Publicidad Google Ads ($500.00)
  {
    id: 'cfdi-004b',
    userId: 'usr-resico-001',
    uuidSat: '550E8400-E29B-41D4-A716-446655440005',
    rfcEmisor: 'GAD1501019X2',
    nombreEmisor: 'Google Ads México S. de R.L. de C.V.',
    rfcReceptor: 'GARM900101XYZ',
    nombreReceptor: 'GARCÍA MARTÍNEZ TECH & CONSULTING',
    total: 500.00,
    subtotal: 431.03,
    iva: 68.97,
    retenciones: 0.00,
    fechaEmision: '2026-09-09T11:10:00Z',
    tipoComprobante: 'I',
    statusSat: 'vigente',
    isEfos: false,
    conceptos: [
      {
        claveProdServ: '82101601',
        descripcion: 'Campaña de búsqueda publicitaria Google Ads',
        importe: 431.03
      }
    ],
    sourceType: 'xml'
  },
  // 6. CFDI de Facturera Fantasma (Simula cruce de seguridad EFOS)
  {
    id: 'cfdi-006-efos',
    userId: 'usr-resico-001',
    uuidSat: '550E8400-E29B-41D4-A716-446655440006',
    rfcEmisor: 'FAL8501019A1',
    nombreEmisor: 'FACTURAS FANTASMA Y ASOCIADOS S.A. DE C.V.',
    rfcReceptor: 'GARM900101XYZ',
    nombreReceptor: 'GARCÍA MARTÍNEZ TECH & CONSULTING',
    total: 8500.00,
    subtotal: 7327.59,
    iva: 1172.41,
    retenciones: 0.00,
    fechaEmision: '2026-09-06T12:00:00Z',
    tipoComprobante: 'I',
    statusSat: 'vigente',
    isEfos: true,
    conceptos: [
      {
        claveProdServ: '80101500',
        descripcion: 'Asesoría corporativa abstracta e intangible',
        importe: 7327.59
      }
    ],
    sourceType: 'xml'
  }
];
export const SEED_TRANSACTIONS: BankTransaction[] = [
  // 1. Concilia automáticamente con cfdi-001
  {
    id: 'tx-001',
    userId: 'usr-resico-001',
    accountId: 'acc-bbva-mxn-4421',
    amount: -1160.00,
    currency: 'MXN',
    date: '2026-09-08',
    description: 'PAGO DOMICILIADO GOOGLE WORKSPACE CLOUD MX',
    status: 'conciliado',
    matchedCfdiId: 'cfdi-001'
  },
  // 2. Concilia automáticamente con cfdi-002
  {
    id: 'tx-002',
    userId: 'usr-resico-001',
    accountId: 'acc-bbva-mxn-4421',
    amount: 29000.00,
    currency: 'MXN',
    date: '2026-09-07',
    description: 'SPEI RECIBIDO BBVA CLI180605 PAGO FACTURA SERVICIOS DE SOFTWARE',
    status: 'conciliado',
    matchedCfdiId: 'cfdi-002'
  },
  // 3. Concilia automáticamente con cfdi-003
  {
    id: 'tx-003',
    userId: 'usr-resico-001',
    accountId: 'acc-bbva-mxn-4421',
    amount: -450.00,
    currency: 'MXN',
    date: '2026-09-09',
    description: 'COMPRA TDD WEWORK MEXICO DF PASE DIARIO',
    status: 'conciliado',
    matchedCfdiId: 'cfdi-003'
  },
  // 4. Ambigua: Monto de $500.00 con dos facturas candidatas válidas en ventana +/- 3 días
  {
    id: 'tx-004',
    userId: 'usr-resico-001',
    accountId: 'acc-bbva-mxn-4421',
    amount: -500.00,
    currency: 'MXN',
    date: '2026-09-08',
    description: 'CARGO TDC PUBLICIDAD DIGITAL CAMPAÑA SEP - META O GOOGLE',
    status: 'ambiguo',
    matchedCfdiId: null,
    candidateCfdiIds: ['cfdi-004a', 'cfdi-004b']
  },
  // 5. Discrepancia: Retiro o transferencia de $12,400 sin comprobante fiscal vinculado
  {
    id: 'tx-005',
    userId: 'usr-resico-001',
    accountId: 'acc-bbva-mxn-4421',
    amount: -12400.00,
    currency: 'MXN',
    date: '2026-09-05',
    description: 'RETIRO EN VENTANILLA SUC 0412 SIN CFDI ASOCIADO',
    status: 'discrepancia',
    matchedCfdiId: null,
    alertReason: 'Movimiento bancario sin comprobante fiscal correspondiente vinculado. Alto riesgo de no deducibilidad.'
  }
];
