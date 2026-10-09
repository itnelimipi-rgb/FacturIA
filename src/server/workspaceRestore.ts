import { createHash } from 'node:crypto';
import { z } from 'zod';
import { bankCsvTransactionId } from '../lib/bankCsvParser';
import { MatchingEngineService } from '../lib/MatchingEngineService';
import type { BankTransaction, CfdiRecord, Profile } from '../lib/types';
import { cfdiSchema, manualDocumentSchema, profileSchema, transactionSchema, WORKSPACE_DOCUMENT_LIMIT, WORKSPACE_TRANSACTION_LIMIT } from '../lib/validation';
import { XmlCfdiParser } from '../lib/xmlParser';
import { HttpError } from './http';
import { namespacedTransactionId } from './recordIds';

export interface PreparedWorkspaceRestore {
  profile: Profile;
  transactions: BankTransaction[];
  cfdis: CfdiRecord[];
}

const backupSchema = z.object({
  format: z.literal('facturia-workspace-backup'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  mode: z.literal('workspace'),
  profile: profileSchema,
  transactions: z.array(transactionSchema).max(WORKSPACE_TRANSACTION_LIMIT),
  cfdis: z.array(cfdiSchema).max(WORKSPACE_DOCUMENT_LIMIT),
});

const invalidBackup = (message: string) => new HttpError(400, message);

function restoredId(kind: 'doc' | 'bank', destinationId: string, sourceOwnerId: string, sourceId: string): string {
  if (destinationId === sourceOwnerId) return sourceId;
  const digest = createHash('sha256').update(JSON.stringify([destinationId, sourceOwnerId, sourceId])).digest('hex');
  return `restore-${kind}-${digest}`;
}

function csvRestoreIds(transactions: BankTransaction[], sourceOwnerId: string, destinationId: string): Map<string, string> {
  const groups = new Map<string, BankTransaction[]>();
  for (const transaction of transactions) {
    const key = JSON.stringify([transaction.accountId, transaction.date, transaction.description, transaction.amount, transaction.currency]);
    const group = groups.get(key);
    if (group) group.push(transaction);
    else groups.set(key, [transaction]);
  }
  const ids = new Map<string, string>();
  for (const group of groups.values()) {
    const fields = group[0];
    // A backup can be ordered differently from its CSV. Recognize identities by
    // their original ordinal, without collapsing legitimate repeated bank rows.
    for (let occurrence = 0; occurrence < group.length; occurrence++) {
      const sourceCsvId = bankCsvTransactionId({userId: sourceOwnerId, accountId: fields.accountId}, fields, occurrence);
      const destinationCsvId = bankCsvTransactionId({userId: destinationId, accountId: fields.accountId}, fields, occurrence);
      ids.set(namespacedTransactionId(sourceOwnerId, sourceCsvId), namespacedTransactionId(destinationId, destinationCsvId));
    }
  }
  return ids;
}

/**
 * Validate a v1 account backup without touching storage. The authenticated target
 * profile stays unchanged; cross-account source IDs become stable account IDs.
 * Restoring to the original account retains IDs for CSV reimport idempotency.
 * Recognized canonical bank CSV IDs migrate to the destination CSV namespace;
 * other imported IDs use a restore namespace and cannot promise CSV idempotency.
 * Fiscal XML is parsed again and never takes fiscal amounts/identity from JSON.
 * This does not consult SAT or EFOS, and preserves prior cancellation/risk flags.
 */
export function prepareWorkspaceRestore(backup: unknown, destinationProfile: Profile): PreparedWorkspaceRestore {
  const destination = profileSchema.safeParse(destinationProfile);
  if (!destination.success) throw new HttpError(409, 'Configura primero tu perfil fiscal');
  const result = backupSchema.safeParse(backup);
  if (!result.success) throw invalidBackup('Respaldo inválido: usa un respaldo JSON v1 de una cuenta de FacturIA.');
  const source = result.data;
  const profile = destination.data;
  if (source.profile.rfc !== profile.rfc) throw invalidBackup('El RFC del respaldo debe coincidir con el de tu perfil.');
  if ([...source.transactions, ...source.cfdis].some(record => record.userId !== source.profile.id)) {
    throw invalidBackup('El respaldo contiene registros que no pertenecen a su perfil.');
  }

  const documentIds = new Map<string, string>();
  for (const document of source.cfdis) {
    if (documentIds.has(document.id)) throw invalidBackup('El respaldo contiene identificadores de documento duplicados.');
    documentIds.set(document.id, restoredId('doc', profile.id, source.profile.id, document.id));
  }
  const bankIds = new Set<string>();
  for (const transaction of source.transactions) {
    if (bankIds.has(transaction.id)) throw invalidBackup('El respaldo contiene identificadores de movimiento duplicados.');
    bankIds.add(transaction.id);
    const references = [...(transaction.candidateCfdiIds ?? [])];
    if (transaction.matchedCfdiId !== null && transaction.matchedCfdiId !== undefined) references.push(transaction.matchedCfdiId);
    if (references.some(id => !documentIds.has(id))) throw invalidBackup('El respaldo contiene vínculos a documentos ausentes.');
  }

  const uuids = new Set<string>();
  const cfdis: CfdiRecord[] = source.cfdis.map(document => {
    const id = documentIds.get(document.id)!;
    const riskFlags = {
      statusSat: document.statusSat === 'cancelado' ? 'cancelado' as const : 'no_verificado' as const,
      isEfos: document.isEfos,
    };
    if (document.sourceType === 'xml') {
      if (!document.rawXml?.trim()) throw invalidBackup('Cada CFDI XML necesita su XML original para restaurarse.');
      const parsed = XmlCfdiParser.parse(document.rawXml, profile.id);
      if (!parsed.success || !parsed.cfdi) throw invalidBackup('El respaldo contiene un XML original inválido.');
      const fiscal = cfdiSchema.safeParse(parsed.cfdi);
      if (!fiscal.success) throw invalidBackup('El respaldo contiene un CFDI XML incompatible con el piloto.');
      if (fiscal.data.rfcEmisor !== profile.rfc && fiscal.data.rfcReceptor !== profile.rfc) {
        throw invalidBackup('El RFC de tu perfil no aparece en un XML del respaldo.');
      }
      if (uuids.has(fiscal.data.uuidSat)) throw invalidBackup('El respaldo contiene UUID de CFDI duplicados.');
      uuids.add(fiscal.data.uuidSat);
      return {...fiscal.data, id, userId: profile.id, ...riskFlags, rawXml: document.rawXml};
    }
    if (document.sourceType !== 'manual' || document.rawXml !== undefined || document.uuidSat !== ''
      || document.tipoComprobante !== 'I' || document.rfcReceptor !== profile.rfc) {
      throw invalidBackup('Sólo se restauran CFDI con XML original y documentos manuales provisionales.');
    }
    const manual = manualDocumentSchema.safeParse(document);
    if (!manual.success) throw invalidBackup('El respaldo contiene un documento manual inválido.');
    const provisional = cfdiSchema.safeParse({
      ...manual.data, id, userId: profile.id, uuidSat: '', rfcReceptor: profile.rfc,
      total: Math.round((manual.data.subtotal + manual.data.iva - manual.data.retenciones) * 100) / 100,
      tipoComprobante: 'I', sourceType: 'manual', ...riskFlags,
    });
    if (!provisional.success) throw invalidBackup('El respaldo contiene un documento manual fuera de los límites del piloto.');
    return provisional.data;
  });

  const csvIds = profile.id === source.profile.id ? new Map<string, string>() : csvRestoreIds(source.transactions, source.profile.id, profile.id);
  const transactions: BankTransaction[] = source.transactions.map(transaction => {
    const paused = transaction.reconciliationLocked === true;
    const matchIntent = paused || !transaction.matchedCfdiId ? null : documentIds.get(transaction.matchedCfdiId)!;
    // A saved match is an intention only. The engine rechecks its amount, day,
    // currency, direction, document ownership and exclusive claim below.
    return {
      ...transaction, id: csvIds.get(transaction.id) ?? restoredId('bank', profile.id, source.profile.id, transaction.id), userId: profile.id,
      status: matchIntent ? 'conciliado' : 'discrepancia', matchedCfdiId: matchIntent,
      candidateCfdiIds: [], alertReason: undefined, reconciliationLocked: paused,
    };
  });
  return {profile, cfdis, transactions: MatchingEngineService.evaluateBatch(transactions, cfdis, profile)};
}
