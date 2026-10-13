import type { CfdiRecord } from './types';

export const documentTypeLabel = (record: Pick<CfdiRecord, 'tipoComprobante' | 'sourceType'>): string => {
  if (record.sourceType === 'manual') return 'Gasto provisional';
  const labels = {
    I: 'CFDI de ingreso (I)',
    E: 'Nota de crédito / CFDI de egreso (E)',
    P: 'Complemento de pagos (P)',
    N: 'CFDI de nómina (N)',
    T: 'CFDI de traslado (T)',
  };
  return labels[record.tipoComprobante];
};

/** Preserve the declared decimal string, including precision; never convert currencies. */
export const formatDeclaredAmount = (amount: string, currency: string): string => {
  if (!/^\d{1,18}(?:\.\d{1,12})?$/.test(amount) || !/^[A-Z]{3}$/.test(currency)) return 'Importe no disponible';
  const [whole, fraction = ''] = amount.split('.');
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${grouped}.${fraction.padEnd(2, '0')}`;
};

export interface XmlDocumentSummary {
  invoiceTotals: Array<[string, number]>;
  creditNoteTotals: Array<[string, number]>;
  invoiceCount: number;
  creditNoteCount: number;
  paymentCount: number;
}

/** Documentary totals only: notes and payments do not net against invoices or bank balances. */
export const summarizeXmlDocuments = (records: CfdiRecord[]): XmlDocumentSummary => {
  const invoiceTotals = new Map<string, number>();
  const creditNoteTotals = new Map<string, number>();
  let invoiceCount = 0;
  let creditNoteCount = 0;
  let paymentCount = 0;
  for (const record of records) {
    if (record.sourceType !== 'xml' || !record.uuidSat || record.statusSat === 'cancelado') continue;
    if (record.tipoComprobante === 'P') { paymentCount += 1; continue; }
    if (record.tipoComprobante !== 'I' && record.tipoComprobante !== 'E') continue;
    const currency = record.currency || 'MXN';
    if (currency === 'XXX' || !Number.isFinite(record.total) || record.total < 0) continue;
    const target = record.tipoComprobante === 'I' ? invoiceTotals : creditNoteTotals;
    target.set(currency, (target.get(currency) || 0) + record.total);
    if (record.tipoComprobante === 'I') invoiceCount += 1;
    else creditNoteCount += 1;
  }
  const entries = (totals: Map<string, number>): Array<[string, number]> => [...totals].sort(([a], [b]) => a.localeCompare(b));
  return { invoiceTotals: entries(invoiceTotals), creditNoteTotals: entries(creditNoteTotals), invoiceCount, creditNoteCount, paymentCount };
};
