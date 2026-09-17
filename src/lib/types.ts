export type ReconciliationStatus = 'conciliado' | 'ambiguo' | 'discrepancia';

export interface Profile {
  id: string;
  rfc: string;
  businessName: string;
  regimeCode: string; // e.g., '626' (RESICO), '612' (Personas Físicas)
  createdAt: string;
}

export interface BankTransaction {
  id: string;
  userId: string;
  accountId: string;
  amount: number; // Positivo = Ingreso (+), Negativo = Egreso (-)
  currency: string;
  date: string; // YYYY-MM-DD
  description: string;
  status: ReconciliationStatus;
  matchedCfdiId?: string | null;
  candidateCfdiIds?: string[];
  alertReason?: string;
}

export interface CfdiRecord {
  id: string;
  userId: string;
  uuidSat: string;
  rfcEmisor: string;
  rfcReceptor: string;
  nombreEmisor?: string;
  nombreReceptor?: string;
  total: number;
  subtotal: number;
  iva: number;
  retenciones: number;
  fechaEmision: string; // ISO 8601
  tipoComprobante: 'I' | 'E' | 'T' | 'N' | 'P'; // I: Ingreso, E: Egreso
  statusSat: 'vigente' | 'cancelado';
  isEfos: boolean;
  conceptos?: Array<{
    claveProdServ?: string;
    descripcion: string;
    importe: number;
  }>;
  sourceType?: 'xml' | 'pdf' | 'image';
}

export interface EfosEntry {
  rfc: string;
  nombreRazonSocial: string;
  situacion: 'Presunto' | 'Desvirtuado' | 'Definitivo' | 'Sentencia Favorable';
  fechaPublicacionDof?: string;
}

export interface MatchingResult {
  status: 'conciliado' | 'ambiguo' | 'discrepancia';
  matchedCfdiId?: string;
  candidateCfdiIds?: string[];
  alertReason?: string;
}

export interface CashFlowMetrics {
  totalBankBalance: number;
  totalIncome: number;
  totalExpense: number;
  nonDeductibleExpenseDiscrepancies: number;
  nonDeductibleImpactEstimated: number; // Impacto 30% ISR + 16% IVA no acreditable
  projectedRetentionsResico: number; // 10.5% retención estimada o retención IVA
  conciliadoCount: number;
  ambiguoCount: number;
  discrepanciaCount: number;
}
