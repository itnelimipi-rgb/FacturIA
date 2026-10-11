import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {before, beforeEach, after, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {DocumentFilesRepository, inspectDocumentFile, MAX_ACCOUNT_FILE_BYTES, MAX_ACCOUNT_FILES, MAX_DOCUMENT_FILE_BYTES} from '../src/server/documentFiles';
import {HttpError} from '../src/server/http';
import {WORKSPACE_DOCUMENT_LIMIT} from '../src/lib/validation';
import {applyTestMigrations} from './helpers/migrations';

const db = new PGlite();
const query = (sql: string, values?: unknown[]) => db.query(sql, values);
const database = {connect: async () => ({query, release() {}})} as unknown as Pick<Pool, 'connect'>;
const repository = new DocumentFilesRepository(database);
const owner = 'document-file-owner';
const other = 'document-file-other';
const input = {rfcEmisor: 'AAA010101AAA', nombreEmisor: 'Proveedor de prueba', subtotal: 100, iva: 16, retenciones: 0, fechaEmision: '2026-10-11', currency: 'MXN'};
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const hasStatus = (status: number) => (error: unknown) => error instanceof HttpError && error.status === status;

before(async () => {await db.waitReady; await applyTestMigrations(db);});
beforeEach(async () => {
  await db.exec('TRUNCATE TABLE "user" CASCADE');
  await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3),($4,$5,$6)', [owner, 'Owner', 'file-owner@example.test', other, 'Other', 'file-other@example.test']);
});
after(async () => {await db.close();});
async function profile(userId = owner) {
  await db.query('INSERT INTO app_profiles(user_id,rfc,business_name,regime_code) VALUES($1,$2,$3,$4)', [userId, userId === owner ? 'XAXX010101000' : 'XEXX010101000', 'Empresa de prueba', '601']);
}
async function counts(userId = owner) {
  const result = await db.query<{documents: number; files: number; audits: number}>('SELECT (SELECT count(*)::int FROM app_documents WHERE user_id=$1) AS documents,(SELECT count(*)::int FROM app_document_files WHERE user_id=$1) AS files,(SELECT count(*)::int FROM app_audit_events WHERE user_id=$1) AS audits', [userId]);
  return result.rows[0];
}
function paddedPdf(bytes: number) {
  const file = Buffer.alloc(bytes, 32);
  file.write('%PDF-1.4\n', 0, 'ascii');
  file.write('\n%%EOF\n', bytes - 7, 'ascii');
  return file;
}

test('original inspection enforces byte limits, MIME agreement and supported magic signatures', () => {
  const metadata = inspectDocumentFile(pdf, 'application/pdf');
  assert.deepEqual(metadata, {contentType: 'application/pdf', bytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'), source: 'pdf'});
  for (const [bytes, mime] of [[png, 'image/png'], [Buffer.from([255, 216, 255, 224]), 'image/jpeg'], [Buffer.from('RIFF0000WEBP'), 'image/webp']] as const) {
    assert.equal(inspectDocumentFile(bytes, mime).source, 'image');
  }
  for (const [bytes, mime] of [[pdf, 'image/png'], [Buffer.from('%PDF-not-complete'), 'application/pdf'], [Buffer.from('<svg/>'), 'image/svg+xml'], [png, 'text/html']] as const) {
    assert.throws(() => inspectDocumentFile(bytes, mime), hasStatus(415));
  }
  assert.throws(() => inspectDocumentFile(Buffer.alloc(0), 'application/pdf'), hasStatus(413));
  assert.throws(() => inspectDocumentFile(paddedPdf(MAX_DOCUMENT_FILE_BYTES + 1), 'application/pdf'), hasStatus(413));
});

test('PDF and image originals create provisional expenses with reviewed amounts and owner-derived identity', async () => {
  await profile();
  const first = await repository.createProvisional(owner, {...input, userId: other, id: 'forged-document', rfcReceptor: 'XEXX010101000', uuidSat: 'forged-uuid', total: 999, statusSat: 'vigente', isEfos: true, rawXml: 'forged XML', attachment: {sha256: 'forged'}}, pdf, 'application/pdf');
  const document = first.cfdis[0];
  assert.equal(document.userId, owner);
  assert.equal(document.rfcReceptor, 'XAXX010101000');
  assert.notEqual(document.id, 'forged-document');
  assert.equal(document.uuidSat, '');
  assert.equal(document.total, 116);
  assert.equal(document.sourceType, 'manual');
  assert.equal(document.statusSat, 'no_verificado');
  assert.equal(document.isEfos, false);
  assert.equal(document.rawXml, undefined);
  assert.equal(document.attachment?.sha256, createHash('sha256').update(pdf).digest('hex'));
  assert.deepEqual(await counts(), {documents: 1, files: 1, audits: 1});
  const second = await repository.createProvisional(owner, input, png, 'image/png');
  assert.equal(second.cfdis.length, 2);
  assert.equal(second.cfdis.find(record => record.id !== document.id)?.attachment?.source, 'image');
});

test('private originals return exact bytes only to the owning account and foreign identifiers are hidden', async () => {
  await profile(); await profile(other);
  const saved = await repository.createProvisional(owner, input, pdf, 'application/pdf');
  const documentId = saved.cfdis[0].id;
  const original = await repository.get(owner, documentId);
  assert.equal(original.content_type, 'application/pdf');
  assert.equal(original.bytes, pdf.length);
  assert.deepEqual(Buffer.from(original.content), pdf);
  await assert.rejects(repository.get(other, documentId), hasStatus(404));
  await assert.rejects(repository.get(owner, 'missing'), hasStatus(404));
  assert.deepEqual(await counts(other), {documents: 0, files: 0, audits: 0});
});

test('missing profile, invalid reviewed amounts and invalid file leave no partial expense', async () => {
  await assert.rejects(repository.createProvisional(owner, input, pdf, 'application/pdf'), hasStatus(409));
  assert.deepEqual(await counts(), {documents: 0, files: 0, audits: 0});
  await profile();
  await assert.rejects(repository.createProvisional(owner, {...input, retenciones: 999}, pdf, 'application/pdf'));
  await assert.rejects(repository.createProvisional(owner, input, Buffer.from('not a PDF'), 'application/pdf'), hasStatus(415));
  assert.deepEqual(await counts(), {documents: 0, files: 0, audits: 0});
});

test('late audit failure rolls back both the expense and original bytes', async () => {
  await profile();
  await db.exec("ALTER TABLE app_audit_events ADD CONSTRAINT reject_provisional_test CHECK(action <> 'provisional_file_saved')");
  try {
    await assert.rejects(repository.createProvisional(owner, input, pdf, 'application/pdf'), (error: unknown) => (error as {code?: string}).code === '23514');
    assert.deepEqual(await counts(), {documents: 0, files: 0, audits: 0});
  } finally {await db.exec('ALTER TABLE app_audit_events DROP CONSTRAINT reject_provisional_test');}
});

test('a document deletion cascades its own original and preserves another account original', async () => {
  await profile(); await profile(other);
  const owned = await repository.createProvisional(owner, input, pdf, 'application/pdf');
  const foreign = await repository.createProvisional(other, input, png, 'image/png');
  await db.query('DELETE FROM app_documents WHERE id=$1 AND user_id=$2', [foreign.cfdis[0].id, owner]);
  assert.equal((await repository.get(other, foreign.cfdis[0].id)).bytes, png.length);
  await db.query('DELETE FROM app_documents WHERE id=$1 AND user_id=$2', [owned.cfdis[0].id, owner]);
  await assert.rejects(repository.get(owner, owned.cfdis[0].id), hasStatus(404));
  assert.equal((await repository.get(other, foreign.cfdis[0].id)).bytes, png.length);
  assert.deepEqual(await counts(), {documents: 0, files: 0, audits: 1});
});

test('file count quota accepts exactly twenty originals and refuses the next atomically', async () => {
  await profile();
  for (let index = 0; index < MAX_ACCOUNT_FILES; index++) await repository.createProvisional(owner, input, pdf, 'application/pdf');
  assert.deepEqual(await counts(), {documents: MAX_ACCOUNT_FILES, files: MAX_ACCOUNT_FILES, audits: MAX_ACCOUNT_FILES});
  await assert.rejects(repository.createProvisional(owner, input, pdf, 'application/pdf'), hasStatus(413));
  assert.deepEqual(await counts(), {documents: MAX_ACCOUNT_FILES, files: MAX_ACCOUNT_FILES, audits: MAX_ACCOUNT_FILES});
});

test('aggregate byte quota accepts exactly 25 MiB and refuses any additional original', async () => {
  await profile();
  const maxFile = paddedPdf(MAX_DOCUMENT_FILE_BYTES);
  for (let index = 0; index < MAX_ACCOUNT_FILE_BYTES / MAX_DOCUMENT_FILE_BYTES; index++) await repository.createProvisional(owner, input, maxFile, 'application/pdf');
  const bytes = await db.query<{bytes: string}>('SELECT sum(bytes)::text AS bytes FROM app_document_files WHERE user_id=$1', [owner]);
  assert.equal(Number(bytes.rows[0].bytes), MAX_ACCOUNT_FILE_BYTES);
  await assert.rejects(repository.createProvisional(owner, input, pdf, 'application/pdf'), hasStatus(413));
  assert.deepEqual(await counts(), {documents: 5, files: 5, audits: 5});
});

test('workspace document quota refuses an original before either row is created', async () => {
  await profile();
  const payload = JSON.stringify({...input, id: 'quota', userId: owner, uuidSat: '', rfcReceptor: 'XAXX010101000', total: 116, tipoComprobante: 'I', sourceType: 'manual', statusSat: 'no_verificado', isEfos: false});
  await db.query('INSERT INTO app_documents(id,user_id,payload) SELECT $1 || n::text,$2,$3::jsonb FROM generate_series(1,$4) AS n', ['quota-', owner, payload, WORKSPACE_DOCUMENT_LIMIT]);
  await assert.rejects(repository.createProvisional(owner, input, pdf, 'application/pdf'), hasStatus(413));
  assert.deepEqual(await counts(), {documents: WORKSPACE_DOCUMENT_LIMIT, files: 0, audits: 0});
});

test('database constraints reject an original linked to another owner or inconsistent content length', async () => {
  await profile(); await profile(other);
  const saved = await repository.createProvisional(owner, input, pdf, 'application/pdf');
  const documentId = saved.cfdis[0].id;
  await assert.rejects(db.query('UPDATE app_document_files SET user_id=$1 WHERE document_id=$2', [other, documentId]), (error: unknown) => (error as {code?: string}).code === '23503');
  await assert.rejects(db.query('UPDATE app_document_files SET bytes=$1 WHERE document_id=$2', [pdf.length + 1, documentId]), (error: unknown) => (error as {code?: string}).code === '23514');
  assert.equal((await repository.get(owner, documentId)).bytes, pdf.length);
});

test('an idempotency key retries one original without duplicating the expense or audit', async () => {
  await profile();
  const key = '12345678-1234-4123-8123-123456789ABC';
  const first = await repository.createProvisional(owner, input, pdf, 'application/pdf', key);
  const retried = await repository.createProvisional(owner, {...input}, pdf, 'application/pdf', key);
  assert.deepEqual(retried, first);
  assert.deepEqual(await counts(), {documents: 1, files: 1, audits: 1});
  for (const [fields, content] of [[{...input, subtotal: 101}, pdf], [input, Buffer.from('%PDF-1.4\nchanged original\n%%EOF\n')]] as const) {
    await assert.rejects(repository.createProvisional(owner, fields, content, 'application/pdf', key), hasStatus(409));
  }
  assert.deepEqual(await counts(), {documents: 1, files: 1, audits: 1});
  assert.deepEqual(Buffer.from((await repository.get(owner, first.cfdis[0].id)).content), pdf);
});

test('idempotency keys are owner scoped and invalid keys cannot create a record', async () => {
  await profile(); await profile(other);
  const key = '12345678-1234-4123-8123-123456789ABC';
  const first = await repository.createProvisional(owner, input, pdf, 'application/pdf', key);
  const second = await repository.createProvisional(other, input, png, 'image/png', key);
  assert.notEqual(first.cfdis[0].id, second.cfdis[0].id);
  assert.equal(first.cfdis[0].userId, owner);
  assert.equal(second.cfdis[0].userId, other);
  await assert.rejects(repository.get(owner, second.cfdis[0].id), hasStatus(404));
  await assert.rejects(repository.createProvisional(owner, input, pdf, 'application/pdf', 'arbitrary-key'), hasStatus(400));
  assert.deepEqual(await counts(), {documents: 1, files: 1, audits: 1});
  assert.deepEqual(await counts(other), {documents: 1, files: 1, audits: 1});
});

test('idempotent reads release every connection once and work with a one-connection lease', async () => {
  await profile();
  let leased = false;
  let releases = 0;
  const leasedDatabase = {connect: async () => {
    // A microtask admits a read requested just before the write's finally executes.
    await Promise.resolve();
    assert.equal(leased, false, 'the write connection must be released before the snapshot read');
    leased = true;
    let released = false;
    return {query, release() {assert.equal(released, false); released = true; leased = false; releases++;}};
  }} as unknown as Pick<Pool, 'connect'>;
  const leasedRepository = new DocumentFilesRepository(leasedDatabase);
  const key = '12345678-1234-4123-8123-123456789ABC';
  await leasedRepository.createProvisional(owner, input, pdf, 'application/pdf', key);
  await leasedRepository.createProvisional(owner, input, pdf, 'application/pdf', key);
  assert.equal(releases, 4);
  assert.equal(leased, false);
  assert.deepEqual(await counts(), {documents: 1, files: 1, audits: 1});
});
