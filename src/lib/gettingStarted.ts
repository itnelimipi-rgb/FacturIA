import type {BankTransaction, CfdiRecord} from './types';

export function getGettingStartedState(transactions: BankTransaction[], documents: CfdiRecord[]) {
  const matched = transactions.filter(item => item.status === 'conciliado').length;
  const review = transactions.filter(item => item.status === 'ambiguo').length;
  const unlinked = transactions.filter(item => item.status === 'discrepancia').length;
  const invoices = documents.filter(item => item.tipoComprobante === 'I' && item.statusSat !== 'cancelado' && item.sourceType !== 'manual' && item.sourceType !== 'pdf' && item.sourceType !== 'image' && !!item.uuidSat).length;
  const title = transactions.length === 0 && documents.length === 0 ? 'Empieza con tus documentos o movimientos'
    : transactions.length === 0 ? 'Ya tienes documentos. Puedes agregar los movimientos del banco'
    : documents.length === 0 ? 'Ya tienes movimientos. Agrega sus documentos'
    : review + unlinked > 0 ? 'Estos movimientos necesitan tu atención'
    : 'Tus movimientos tienen un documento vinculado';
  return {title, matched, review, unlinked, invoices, documentCount: documents.length, transactionCount: transactions.length};
}
