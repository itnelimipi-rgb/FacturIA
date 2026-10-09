import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { MatchingEngineService } from '../lib/MatchingEngineService';
import type { Profile, BankTransaction, CfdiRecord } from '../lib/types';
import { HttpError } from './http';
import { cfdiSchema, WORKSPACE_DOCUMENT_LIMIT, WORKSPACE_TRANSACTION_LIMIT } from '../lib/validation';
import { MAX_WORKSPACE_EXPORT_BYTES } from '../lib/workspaceExport';
import { prepareWorkspaceRestore, type PreparedWorkspaceRestore } from './workspaceRestore';
export { namespacedTransactionId } from './recordIds';

export interface WorkspaceSnapshot {profile: Profile | null; transactions: BankTransaction[]; cfdis: CfdiRecord[]}
type Connection = Pick<PoolClient, 'query' | 'release'>;
type Database = Pick<Pool, 'connect'>;

export class WorkspaceRepository {
  constructor(private readonly database: Database) {}

  private async load(client: Connection, userId: string): Promise<WorkspaceSnapshot> {
    const rows = await client.query('SELECT * FROM app_profiles WHERE user_id=$1', [userId]);
    if (!rows.rows[0]) return {profile: null, transactions: [], cfdis: []};
    await this.assertWorkspaceLimits(client, userId);
    const row = rows.rows[0];
    const profile: Profile = {id: userId, rfc: row.rfc, businessName: row.business_name, regimeCode: row.regime_code, createdAt: new Date(row.created_at).toISOString()};
    const txs = await client.query('SELECT payload FROM app_bank_transactions WHERE user_id=$1 ORDER BY created_at, id', [userId]);
    const docs = await client.query('SELECT payload FROM app_documents WHERE user_id=$1 ORDER BY created_at, id', [userId]);
    return {profile, transactions: txs.rows.map(row => row.payload), cfdis: docs.rows.map(row => row.payload)};
  }

  async get(userId: string) {
    const client = await this.database.connect();
    try {
      // All three reads must describe the same committed state even during imports.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot = await this.load(client, userId);
      if (snapshot.profile) snapshot.transactions = MatchingEngineService.evaluateBatch(snapshot.transactions, snapshot.cfdis, snapshot.profile);
      await client.query('COMMIT');
      return snapshot;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  /** Read one committed owner snapshot, including original XML, without writing or auditing. */
  async getExport(userId: string): Promise<WorkspaceSnapshot> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await this.assertWorkspaceLimits(client, userId);
      // Check the aggregate size in PostgreSQL before materializing potentially
      // thousands of XML strings in the web process. JSONB formatting plus the
      // reserved envelope/field overhead intentionally makes this conservative.
      const size = await client.query<{bytes: string}>(
        'SELECT 4096 + (SELECT COALESCE(sum(octet_length(payload::text) + 32),0) FROM app_bank_transactions WHERE user_id=$1) + (SELECT COALESCE(sum(octet_length(payload::text) + COALESCE(octet_length(to_jsonb(raw_xml)::text),0) + 32),0) FROM app_documents WHERE user_id=$1) AS bytes', [userId]
      );
      if (Number(size.rows[0].bytes) > MAX_WORKSPACE_EXPORT_BYTES) {
        throw new HttpError(413, 'El respaldo supera el límite de descarga de 25 MiB del piloto.');
      }
      const snapshot = await this.load(client, userId);
      const originals = await client.query<{id: string; raw_xml: string | null}>('SELECT id,raw_xml FROM app_documents WHERE user_id=$1 ORDER BY created_at, id', [userId]);
      const xmlById = new Map(originals.rows.map(row => [row.id, row.raw_xml]));
      snapshot.cfdis = snapshot.cfdis.map(document => {
        const rawXml = xmlById.get(document.id);
        return rawXml === null || rawXml === undefined ? document : {...document, rawXml};
      });
      if (snapshot.profile) snapshot.transactions = MatchingEngineService.evaluateBatch(snapshot.transactions, snapshot.cfdis, snapshot.profile);
      await client.query('COMMIT');
      return snapshot;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async saveProfile(userId: string, input: Pick<Profile, 'rfc' | 'businessName' | 'regimeCode'>) {
    return this.mutate(userId, 'profile_saved', async client => {
      const existing = await client.query('SELECT rfc FROM app_profiles WHERE user_id=$1', [userId]);
      if (existing.rows[0] && existing.rows[0].rfc !== input.rfc) {
        throw new HttpError(409, 'El RFC no puede cambiar después de crear el perfil; requiere una migración de los datos.');
      }
      await client.query('INSERT INTO app_profiles(user_id,rfc,business_name,regime_code) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET business_name=$3,regime_code=$4', [userId, input.rfc, input.businessName, input.regimeCode]);
    });
  }

  /** Validate a recovery against a committed snapshot without changing the database. */
  async previewRestore(userId: string, backup: unknown) {
    const snapshot = await this.get(userId);
    const prepared = this.prepareRestore(snapshot, backup);
    return {
      rfc: prepared.profile.rfc,
      documents: prepared.cfdis.length,
      transactions: prepared.transactions.length,
      lockedTransactions: prepared.transactions.filter(transaction => transaction.reconciliationLocked).length,
      matchedTransactions: prepared.transactions.filter(transaction => transaction.status === 'conciliado').length,
    };
  }

  /** Recover into an empty workspace; the owner lock also prevents concurrent overwrites. */
  async restore(userId: string, backup: unknown) {
    return this.mutate(userId, 'workspace_restored', async client => {
      // Repeat every eligibility check inside the transaction. A preview is not
      // permission to replace data imported in another tab in the meantime.
      const prepared = this.prepareRestore(await this.load(client, userId), backup);
      if (prepared.cfdis.length) {
        const documents = prepared.cfdis.map(document => {
          const {rawXml, ...payload} = document;
          return {id: document.id, uuid_sat: document.uuidSat || null, payload, raw_xml: rawXml ?? null};
        });
        await client.query('INSERT INTO app_documents(id,user_id,uuid_sat,payload,raw_xml) SELECT record.id,$1,record.uuid_sat,record.payload,record.raw_xml FROM jsonb_to_recordset($2::jsonb) AS record(id text,uuid_sat uuid,payload jsonb,raw_xml text)', [userId, JSON.stringify(documents)]);
      }
      if (prepared.transactions.length) {
        const records = prepared.transactions.map(transaction => ({id: transaction.id, payload: transaction}));
        await client.query('INSERT INTO app_bank_transactions(id,user_id,payload) SELECT record.id,$1,record.payload FROM jsonb_to_recordset($2::jsonb) AS record(id text,payload jsonb)', [userId, JSON.stringify(records)]);
      }
    });
  }

  private prepareRestore(snapshot: WorkspaceSnapshot, backup: unknown): PreparedWorkspaceRestore {
    if (!snapshot.profile) throw new HttpError(409, 'Configura primero tu perfil fiscal con el RFC del respaldo');
    if (snapshot.cfdis.length || snapshot.transactions.length) {
      throw new HttpError(409, 'La restauración requiere un espacio vacío. Tus datos actuales se conservan.');
    }
    return prepareWorkspaceRestore(backup, snapshot.profile);
  }

  async addDocument(userId: string, document: CfdiRecord, rawXml?: string) {
    return this.mutate(userId, 'document_imported', async client => {
      if (document.userId !== userId) throw new HttpError(403, 'El comprobante no pertenece a tu cuenta');
      const safeDocument = cfdiSchema.parse(document);
      delete safeDocument.rawXml;
      await client.query('INSERT INTO app_documents(id,user_id,uuid_sat,payload,raw_xml) VALUES($1,$2,$3,$4,$5)', [document.id, userId, document.uuidSat || null, JSON.stringify(safeDocument), rawXml || null]);
    });
  }

  async addTransactions(userId: string, transactions: BankTransaction[]) {
    return this.mutate(userId, 'bank_csv_imported', async client => {
      const incoming = new Map<string, BankTransaction>();
      const sameBankRecord = (previous: BankTransaction, current: BankTransaction) =>
        ['amount', 'date', 'description', 'currency', 'accountId'].every(key => previous[key as keyof BankTransaction] === current[key as keyof BankTransaction]);
      for (const transaction of transactions) {
        if (transaction.userId !== userId) throw new HttpError(403, 'El movimiento no pertenece a tu cuenta');
        const previous = incoming.get(transaction.id);
        if (previous && !sameBankRecord(previous, transaction)) throw new HttpError(409, 'Identificador de movimiento duplicado con datos distintos');
        incoming.set(transaction.id, transaction);
      }
      const existing = await client.query('SELECT id,payload FROM app_bank_transactions WHERE user_id=$1 AND id=ANY($2::text[])', [userId, Array.from(incoming.keys())]);
      for (const row of existing.rows) {
        if (!sameBankRecord(row.payload, incoming.get(row.id)!)) throw new HttpError(409, 'Identificador de movimiento duplicado con datos distintos');
        incoming.delete(row.id);
      }
      const count = await client.query('SELECT count(*)::int AS count FROM app_bank_transactions WHERE user_id=$1', [userId]);
      if (count.rows[0].count + incoming.size > WORKSPACE_TRANSACTION_LIMIT) {
        throw new HttpError(413, `El piloto admite como máximo ${WORKSPACE_TRANSACTION_LIMIT} movimientos acumulados por cuenta. La importación no se guardó.`);
      }
      if (incoming.size) {
        const records = Array.from(incoming.values(), transaction => ({id: transaction.id, payload: {...transaction, status: 'discrepancia', matchedCfdiId: null, candidateCfdiIds: [], reconciliationLocked: false}}));
        await client.query('INSERT INTO app_bank_transactions(id,user_id,payload) SELECT record.id,$1,record.payload FROM jsonb_to_recordset($2::jsonb) AS record(id text,payload jsonb)', [userId, JSON.stringify(records)]);
      }
    });
  }

  async resolve(userId: string, transactionId: string, documentId: string) {
    return this.mutate(userId, 'match_resolved', async client => {
      const snapshot = await this.load(client, userId);
      if (!snapshot.profile) throw new HttpError(409, 'Primero configura tu perfil');
      const evaluated = MatchingEngineService.evaluateBatch(snapshot.transactions, snapshot.cfdis, snapshot.profile);
      const target = evaluated.find(tx => tx.id === transactionId);
      if (!target) throw new HttpError(404, 'Movimiento no encontrado');
      if (target.status !== 'ambiguo' || !target.candidateCfdiIds?.includes(documentId)) throw new HttpError(409, 'El comprobante ya no es candidato válido');
      if (evaluated.some(tx => tx.id !== transactionId && tx.matchedCfdiId === documentId)) throw new HttpError(409, 'El comprobante ya está vinculado');
      const resolved = {...target, status: 'conciliado', matchedCfdiId: documentId, candidateCfdiIds: [], reconciliationLocked: false};
      await client.query('UPDATE app_bank_transactions SET payload=$1 WHERE id=$2 AND user_id=$3', [JSON.stringify(resolved), transactionId, userId]);
    });
  }

  async unmatch(userId: string, transactionId: string) {
    return this.mutate(userId, 'match_removed', async client => {
      const result = await client.query('SELECT payload FROM app_bank_transactions WHERE id=$1 AND user_id=$2', [transactionId, userId]);
      if (!result.rows[0]) throw new HttpError(404, 'Movimiento no encontrado');
      const value = {...result.rows[0].payload, status: 'discrepancia', matchedCfdiId: null, candidateCfdiIds: [], reconciliationLocked: true};
      await client.query('UPDATE app_bank_transactions SET payload=$1,matched_cfdi_id=NULL WHERE id=$2 AND user_id=$3', [JSON.stringify(value), transactionId, userId]);
    });
  }

  async resumeReconciliation(userId: string, transactionId: string) {
    return this.mutate(userId, 'match_resumed', async client => {
      const result = await client.query('SELECT payload FROM app_bank_transactions WHERE id=$1 AND user_id=$2', [transactionId, userId]);
      if (!result.rows[0]) throw new HttpError(404, 'Movimiento no encontrado');
      const value = {...result.rows[0].payload, status: 'discrepancia', matchedCfdiId: null, candidateCfdiIds: [], reconciliationLocked: false};
      await client.query('UPDATE app_bank_transactions SET payload=$1,matched_cfdi_id=NULL WHERE id=$2 AND user_id=$3', [JSON.stringify(value), transactionId, userId]);
    });
  }

  private async assertWorkspaceLimits(client: Connection, userId: string): Promise<void> {
    const counts = await client.query('SELECT (SELECT count(*)::int FROM app_bank_transactions WHERE user_id=$1) AS transactions, (SELECT count(*)::int FROM app_documents WHERE user_id=$1) AS documents', [userId]);
    if (counts.rows[0].transactions > WORKSPACE_TRANSACTION_LIMIT || counts.rows[0].documents > WORKSPACE_DOCUMENT_LIMIT) {
      throw new HttpError(413, `El piloto admite hasta ${WORKSPACE_TRANSACTION_LIMIT} movimientos y ${WORKSPACE_DOCUMENT_LIMIT} documentos acumulados por cuenta. La operación no se guardó.`);
    }
  }

  private async mutate(userId: string, action: string, work: (client: Connection) => Promise<void>) {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
      await work(client);
      const snapshot = await this.load(client, userId);
      if (snapshot.profile) {
        snapshot.transactions = MatchingEngineService.evaluateBatch(snapshot.transactions, snapshot.cfdis, snapshot.profile);
        // Clear old links before updating so the unique constraint also works on link exchanges.
        await client.query('UPDATE app_bank_transactions SET matched_cfdi_id=NULL WHERE user_id=$1', [userId]);
        if (snapshot.transactions.length) {
          const records = snapshot.transactions.map(tx => ({id: tx.id, payload: tx, matched_id: tx.matchedCfdiId || null}));
          await client.query('UPDATE app_bank_transactions AS bank SET payload=record.payload,matched_cfdi_id=record.matched_id FROM jsonb_to_recordset($1::jsonb) AS record(id text,payload jsonb,matched_id text) WHERE bank.id=record.id AND bank.user_id=$2', [JSON.stringify(records), userId]);
        }
      }
      await client.query('INSERT INTO app_audit_events(id,user_id,action) VALUES($1,$2,$3)', [randomUUID(), userId, action]);
      await client.query('COMMIT');
      return snapshot;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
