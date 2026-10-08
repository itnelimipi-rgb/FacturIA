import { z } from 'zod';
import type { BankTransaction, CfdiRecord, Profile } from './types';
import { cfdiSchema, profileSchema, transactionSchema, WORKSPACE_DOCUMENT_LIMIT, WORKSPACE_TRANSACTION_LIMIT } from './validation';

/** A backup contains fiscal data and original XML, never credentials or sessions. */
export interface WorkspaceExportSnapshot {
  profile: Profile | null;
  transactions: BankTransaction[];
  cfdis: CfdiRecord[];
}

export interface WorkspaceExportOptions {
  mode: 'demo' | 'workspace';
  exportedAt?: string;
}

/** Aggregate pilot download limit; each XML retains the existing 2,000,000-character limit. */
export const MAX_WORKSPACE_EXPORT_BYTES = 25 * 1024 * 1024;

export class WorkspaceExportLimitError extends Error {
  constructor() { super('El respaldo supera el límite de descarga de 25 MiB del piloto.'); }
}

const exportSnapshotSchema = z.object({
  profile: profileSchema.nullable(),
  transactions: z.array(transactionSchema).max(WORKSPACE_TRANSACTION_LIMIT),
  cfdis: z.array(cfdiSchema).max(WORKSPACE_DOCUMENT_LIMIT),
}).superRefine((snapshot, context) => {
  if (!snapshot.profile && (snapshot.transactions.length || snapshot.cfdis.length)) {
    context.addIssue({code: 'custom', message: 'Los registros necesitan un perfil propietario'});
  } else if (snapshot.profile && [...snapshot.transactions, ...snapshot.cfdis].some(record => record.userId !== snapshot.profile!.id)) {
    context.addIssue({code: 'custom', message: 'Los registros deben pertenecer al perfil exportado'});
  }
});

const exportOptionsSchema = z.object({
  mode: z.enum(['demo', 'workspace']),
  exportedAt: z.iso.datetime().optional(),
});

/**
 * JSON format v1: format, version, exportedAt (UTC), mode, profile, transactions, cfdis.
 * Known fields are copied through the shared schemas; extra keys are discarded at
 * every record level. rawXml is optional and preserved verbatim when available.
 * SAT/EFOS metadata is copied, never verified or upgraded by exporting. This format
 * currently supports downloading a backup only; importing/restoring it is not enabled.
 */
export function createWorkspaceBackup(snapshot: WorkspaceExportSnapshot, options: WorkspaceExportOptions) {
  const safe = exportSnapshotSchema.parse(snapshot);
  const metadata = exportOptionsSchema.parse(options);
  return {
    format: 'facturia-workspace-backup' as const,
    version: 1 as const,
    exportedAt: metadata.exportedAt ?? new Date().toISOString(),
    mode: metadata.mode,
    profile: safe.profile,
    transactions: safe.transactions,
    cfdis: safe.cfdis,
  };
}

function enforceDownloadLimit(value: string): string {
  if (new TextEncoder().encode(value).byteLength > MAX_WORKSPACE_EXPORT_BYTES) {
    throw new WorkspaceExportLimitError();
  }
  return value;
}

/** UTF-8 JSON download text; no server-only dependencies, usable for the local demo. */
export function serializeWorkspaceBackup(snapshot: WorkspaceExportSnapshot, options: WorkspaceExportOptions): string {
  return enforceDownloadLimit(JSON.stringify(createWorkspaceBackup(snapshot, options)));
}

/** Quote all textual cells and prefix risky spreadsheet text with a literal apostrophe. */
function csvText(value: string): string {
  // Leading whitespace/control characters can disguise formulas in spreadsheet readers.
  const firstCode = value.codePointAt(0);
  const startsWithControl = firstCode !== undefined && (firstCode < 0x20 || firstCode === 0x7f);
  const safe = startsWithControl || /^(?:\s|[=+\-@\uFEFF＝＋－＠])/u.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * UTF-8/BOM, comma-separated, CRLF rows. Includes reconciliation status and matched
 * UUID. Signed amounts remain numeric with two decimals. Text is neutralized for
 * Excel and escaped for commas, quotes and line breaks. This is a report, not the
 * normalized CSV accepted by the bank importer or a lossless backup of all fields.
 */
export function serializeTransactionsCsv(snapshot: WorkspaceExportSnapshot): string {
  const safe = exportSnapshotSchema.parse(snapshot);
  const documents = new Map(safe.cfdis.map(document => [document.id, document]));
  const headers = ['id', 'cuenta', 'fecha', 'descripcion', 'monto', 'moneda', 'estado', 'uuid_cfdi', 'conciliacion_pausada', 'motivo'];
  const lines = [headers.map(csvText).join(',')];
  for (const transaction of safe.transactions) {
    const uuid = transaction.matchedCfdiId ? documents.get(transaction.matchedCfdiId)?.uuidSat ?? '' : '';
    lines.push([
      csvText(transaction.id), csvText(transaction.accountId), csvText(transaction.date), csvText(transaction.description),
      transaction.amount.toFixed(2), csvText(transaction.currency), csvText(transaction.status), csvText(uuid),
      csvText(transaction.reconciliationLocked ? 'si' : 'no'), csvText(transaction.alertReason ?? ''),
    ].join(','));
  }
  return enforceDownloadLimit(`\uFEFF${lines.join('\r\n')}\r\n`);
}
