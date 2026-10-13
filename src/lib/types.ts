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
  reconciliationLocked?: boolean;
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
  statusSat: 'vigente' | 'cancelado' | 'no_verificado';
  isEfos: boolean;
  conceptos?: Array<{
    claveProdServ?: string;
    descripcion: string;
    importe: number;
  }>;
  sourceType?: 'xml' | 'pdf' | 'image' | 'manual';
  currency?: string;
  descuento?: number;
  usoCfdi?: string;
  formaPago?: string;
  metodoPago?: 'PUE' | 'PPD';
  relatedCfdis?: CfdiRelation[];
  paymentComplement?: CfdiPaymentComplement;
  rawXml?: string;
  satVerification?: SatVerification;
  attachment?: {
    contentType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';
    bytes: number;
    sha256: string;
    source: 'pdf' | 'image';
  };
}

/** Declared documentary references; they never create bank movements or fiscal validity. */
export interface CfdiRelation { type: string; uuids: string[]; }
export interface CfdiPaymentRelatedDocument {
  uuid: string; currency: string; equivalence?: string; installment: number;
  previousBalance: string; paidAmount: string; remainingBalance: string; taxObject: string;
}
export interface CfdiPayment {
  date: string; currency: string; amount: string; form: string; exchangeRate?: string;
  relatedDocuments: CfdiPaymentRelatedDocument[];
}
export interface CfdiPaymentComplement {
  version: '2.0'; totalPaymentsMxn: string; payments: CfdiPayment[];
}

/** A dated response from the fixed SAT consultation service, not a seal/XSD validation. */
export interface SatVerification {
  source: 'sat';
  checkedAt: string;
  outcome: 'found' | 'not_found' | 'invalid_query' | 'unavailable';
  status: 'vigente' | 'cancelado' | 'no_verificado';
  code?: 'S' | 'N601' | 'N602';
  efos: 'listed' | 'not_listed' | 'unknown';
  cancelability?: string;
  cancellationStatus?: string;
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
  currency?: string;
  totalBankBalance: number;
  totalIncome: number;
  totalExpense: number;
  nonDeductibleExpenseDiscrepancies: number;
  nonDeductibleImpactEstimated: number; // Legacy field: zero until reviewed tax rules exist.
  projectedRetentionsResico: number; // Recorded withholding on reconciled documents; no assumed rate.
  conciliadoCount: number;
  ambiguoCount: number;
  discrepanciaCount: number;
}
