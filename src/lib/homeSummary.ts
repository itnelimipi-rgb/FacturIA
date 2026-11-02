import type {BankTransaction, CfdiRecord} from './types';
import {summarizeInvoiceOrientation, summarizeLoadedMovements} from './dashboardPresentation';

export type PendingAction = 'choose' | 'upload' | 'resume';
export interface PendingItem {transaction: BankTransaction; action: PendingAction}

const priority: Record<PendingAction, number> = {choose: 0, upload: 1, resume: 2};

export function pendingAction(transaction: BankTransaction): PendingAction | null {
  if (transaction.reconciliationLocked) return 'resume';
  if (transaction.status === 'ambiguo') return 'choose';
  if (transaction.status === 'discrepancia') return 'upload';
  return null;
}

/** What Inicio shows: the next step, the pending movements and the totals of the loaded files. */
export function buildHomeSummary(transactions: BankTransaction[], documents: CfdiRecord[], profileRfc?: string) {
  const movements = summarizeLoadedMovements(transactions);
  const pending: PendingItem[] = transactions
    .flatMap(transaction => {
      const action = pendingAction(transaction);
      return action ? [{transaction, action}] : [];
    })
    .sort((left, right) => priority[left.action] - priority[right.action] || right.transaction.date.localeCompare(left.transaction.date));
  const matchableInvoices = documents.filter(document => document.tipoComprobante === 'I' && document.sourceType === 'xml'
    && document.statusSat !== 'cancelado' && !!document.uuidSat).length;
  const stage = transactions.length === 0 && documents.length === 0 ? 'empty'
    : transactions.length === 0 ? 'documents-only'
    : documents.length === 0 ? 'movements-only'
    : 'ready';
  return {
    stage: stage as 'empty' | 'documents-only' | 'movements-only' | 'ready',
    pending,
    linked: movements.linkedCount,
    totalMovements: movements.totalCount,
    totals: movements.totals,
    dateRange: movements.dateRange,
    invoices: summarizeInvoiceOrientation(documents, profileRfc),
    matchableInvoices,
    creditNotes: documents.filter(document => document.tipoComprobante === 'E').length,
    payments: documents.filter(document => document.tipoComprobante === 'P').length,
    provisional: documents.filter(document => ['manual', 'pdf', 'image'].includes(document.sourceType ?? '')).length,
    documentCount: documents.length,
  };
}
