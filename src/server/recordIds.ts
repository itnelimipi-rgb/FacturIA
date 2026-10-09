import { createHash } from 'node:crypto';

/** Namespace a bank import ID by its authenticated owner; keep the existing formula. */
export function namespacedTransactionId(userId: string, importedId: string): string {
  return `bank-${createHash('sha256').update(JSON.stringify([userId, importedId])).digest('hex')}`;
}
