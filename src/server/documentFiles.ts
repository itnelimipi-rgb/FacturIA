import {createHash, randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {cfdiSchema, manualDocumentSchema, WORKSPACE_DOCUMENT_LIMIT} from '../lib/validation';
import type {CfdiRecord} from '../lib/types';
import {HttpError} from './http';
import {WorkspaceRepository} from './workspaceRepository';

export const MAX_DOCUMENT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ACCOUNT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ACCOUNT_FILES = 20;
type ContentType = 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';
export function inspectDocumentFile(content: Uint8Array, contentType: string) {
  const bytes = Buffer.from(content);
  if (!bytes.length || bytes.length > MAX_DOCUMENT_FILE_BYTES) throw new HttpError(413, 'El archivo admite hasta 5 MiB.');
  const detected: ContentType | null = bytes.subarray(0, 5).toString('ascii') === '%PDF-' && bytes.subarray(-1024).includes(Buffer.from('%%EOF'))
    ? 'application/pdf' : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
    : bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP' ? 'image/webp' : null;
  if (!detected || detected !== contentType) throw new HttpError(415, 'Selecciona un PDF, PNG, JPEG o WebP con un tipo de archivo válido.');
  return {contentType: detected, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), source: detected === 'application/pdf' ? 'pdf' as const : 'image' as const};
}

export class DocumentFilesRepository {
  constructor(private readonly database: Pick<Pool, 'connect'>) {}
  async createProvisional(userId: string, input: unknown, content: Uint8Array, contentType: string, requestKey?: string) {
    const fields = manualDocumentSchema.parse(input);
    const attachment = inspectDocumentFile(content, contentType);
    if (requestKey !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) throw new HttpError(400, 'Identificador de solicitud inválido');
    const fingerprint = createHash('sha256').update(JSON.stringify([fields, attachment.sha256])).digest('hex');
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
      if (requestKey) {
        const previous = await client.query<{request_fingerprint: string}>('SELECT request_fingerprint FROM app_document_files WHERE user_id=$1 AND request_key=$2', [userId, requestKey]);
        if (previous.rows[0]) {
          if (previous.rows[0].request_fingerprint !== fingerprint) throw new HttpError(409, 'La solicitud ya se guardó con otros datos');
          await client.query('COMMIT');
          // Start the read only after finally has released the write connection.
          return Promise.resolve().then(() => new WorkspaceRepository(this.database).get(userId));
        }
      }
      const profile = await client.query<{rfc: string}>('SELECT rfc FROM app_profiles WHERE user_id=$1', [userId]);
      if (!profile.rows[0]) throw new HttpError(409, 'Configura primero tu perfil fiscal');
      const counts = await client.query<{documents: number; files: number; bytes: string}>(
        'SELECT (SELECT count(*)::int FROM app_documents WHERE user_id=$1) AS documents, count(*)::int AS files, COALESCE(sum(bytes),0)::text AS bytes FROM app_document_files WHERE user_id=$1', [userId]);
      if (counts.rows[0].documents >= WORKSPACE_DOCUMENT_LIMIT || counts.rows[0].files >= MAX_ACCOUNT_FILES || Number(counts.rows[0].bytes) + attachment.bytes > MAX_ACCOUNT_FILE_BYTES) {
        throw new HttpError(413, 'El piloto admite hasta 20 originales y 25 MiB de archivos por cuenta, dentro del límite de documentos. No se guardó el gasto.');
      }
      const document: CfdiRecord = cfdiSchema.parse({...fields, id: randomUUID(), userId, uuidSat: '',
        rfcReceptor: profile.rows[0].rfc, total: Math.round((fields.subtotal+fields.iva-fields.retenciones)*100)/100,
        tipoComprobante: 'I', sourceType: 'manual', statusSat: 'no_verificado', isEfos: false, attachment});
      await client.query('INSERT INTO app_documents(id,user_id,payload) VALUES($1,$2,$3)', [document.id, userId, JSON.stringify(document)]);
      await client.query('INSERT INTO app_document_files(document_id,user_id,content_type,bytes,sha256,content,request_key,request_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [document.id,userId,attachment.contentType,attachment.bytes,attachment.sha256,Buffer.from(content),requestKey ?? null,requestKey ? fingerprint : null]);
      await client.query('INSERT INTO app_audit_events(id,user_id,action,record_id) VALUES($1,$2,$3,$4)', [randomUUID(),userId,'provisional_file_saved',document.id]);
      await client.query('COMMIT');
    } catch (error) {await client.query('ROLLBACK'); throw error;}
    finally {client.release();}
    return new WorkspaceRepository(this.database).get(userId);
  }
  async get(userId: string, documentId: string) {
    const client = await this.database.connect();
    try {
      const result = await client.query<{content_type: ContentType; content: Buffer; bytes: number; sha256: string}>(
        'SELECT content_type,content,bytes,sha256 FROM app_document_files WHERE user_id=$1 AND document_id=$2', [userId, documentId]);
      if (!result.rows[0]) throw new HttpError(404, 'Original no encontrado');
      return result.rows[0];
    } finally {client.release();}
  }
}
