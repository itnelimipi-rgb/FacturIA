import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual, parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

// Only synthetic records are created. Passwords stay in the ignored cache.
// Run with node --import tsx scripts/verify-pending-http.mjs --base-url ORIGIN.
class VerificationError extends Error {}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {values} = parseArgs({options: {
  'base-url': {type: 'string', default: 'http://127.0.0.1:3000'},
  state: {type: 'string', default: 'node_modules/.cache/pending-http.json'},
  'verify-only': {type: 'boolean', default: false},
}});
const base = new URL(values['base-url']);
if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Usa un origen HTTP(S) sin credenciales ni rutas.');
const origin = base.origin;
const cache = path.resolve(root, 'node_modules/.cache');
const statePath = path.resolve(root, values.state);
const relative = path.relative(cache, statePath);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('El estado privado debe permanecer en node_modules/.cache.');
let state, passed = 0;
const check = (condition, message) => { if (!condition) throw new VerificationError(message); };
const pass = message => { console.log(`PASS ${++passed}: ${message}`); };
async function request(endpoint, {body, form, cookie, headers: extraHeaders = {}, requestOrigin = origin} = {}) {
  const headers = {...extraHeaders, origin: requestOrigin};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${origin}${endpoint}`, {method: body !== undefined || form ? 'POST' : 'GET', headers,
    body: form || (body === undefined ? undefined : JSON.stringify(body)), redirect: 'error', signal: AbortSignal.timeout(45_000)});
}
async function expect(promise, code, label) {
  const response = await promise;
  check(response.status === code, `${label}: esperado HTTP ${code}, recibido HTTP ${response.status}`);
  return response;
}
async function json(promise, code, label) {
  const response = await expect(promise, code, label);
  try { return await response.json(); } catch { throw new VerificationError(`${label}: JSON inválido`); }
}
function cookieOf(response) {
  const cookies = response.headers.getSetCookie();
  const session = cookies.find(value => value.split(';')[0].includes('session_token='));
  check(session && /;\s*HttpOnly(?:;|$)/i.test(session) && /;\s*SameSite=(?:Lax|Strict)(?:;|$)/i.test(session), 'Cookie de sesión sin protecciones esperadas');
  if (base.protocol === 'https:') check(/;\s*Secure(?:;|$)/i.test(session), 'Cookie HTTPS sin Secure');
  return cookies.map(value => value.split(';')[0]).join('; ');
}
async function saveState() { await mkdir(path.dirname(statePath), {recursive: true}); await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {mode: 0o600}); }
async function register(label) {
  const account = {email: `facturia-pendientes-${state.runId}-${label}@example.test`, password: `${randomBytes(32).toString('base64url')}!Aa1`};
  const response = await expect(request('/api/auth/sign-up/email', {body: {name: `Prueba pendientes ${label}`, ...account}}), 200, 'Registro sintético');
  const data = await response.json(); check(typeof data.user?.id === 'string', 'Registro sin identidad');
  account.id = data.user.id; state.users[label] = account; await saveState();
  return cookieOf(response);
}
async function login(account) {
  const response = await expect(request('/api/auth/sign-in/email', {body: {email: account.email, password: account.password}}), 200, 'Inicio de sesión');
  const data = await response.json(); check(data.user?.id === account.id, 'La sesión cambió de identidad');
  return cookieOf(response);
}
const snapshot = cookie => json(request('/api/workspace', {cookie}), 200, 'Espacio privado');
const write = (cookie, action) => json(request('/api/workspace', {cookie, body: action}), 200, 'Cambio privado');
const fileEndpoint = id => `/api/workspace/documents/${encodeURIComponent(id)}/file`;
function syntheticPdf() {
  const stream = 'BT /F1 14 Tf 50 740 Td (Factura de prueba local sin validez fiscal) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.7\n'; const offsets = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const pdf = syntheticPdf();
const pdfHash = createHash('sha256').update(pdf).digest('hex');
function uploadForm(bytes = pdf, type = 'application/pdf', documentChanges = {}) {
  const form = new FormData();
  form.set('document', JSON.stringify({rfcEmisor: 'AAA010101AAA', nombreEmisor: 'Original privado de prueba', subtotal: 100, iva: 16, retenciones: 0, fechaEmision: '2026-10-11', currency: 'MXN',
    userId: state.users.b.id, id: 'foreign-owner-spoof', uuidSat: 'FORGED', statusSat: 'vigente', isEfos: true, ...documentChanges}));
  form.set('file', new Blob([bytes], {type}), 'original-sintetico.pdf'); return form;
}
async function download(cookie) {
  const response = await expect(request(fileEndpoint(state.fileId), {cookie}), 200, 'Descarga propia');
  check(response.headers.get('cache-control') === 'no-store' && response.headers.get('x-content-type-options') === 'nosniff', 'Original sin protección de caché o MIME');
  check(response.headers.get('content-disposition') === 'attachment; filename="facturia-original.pdf"', 'Original sin nombre de descarga fijo');
  check(response.headers.get('content-security-policy')?.includes('sandbox'), 'Original sin aislamiento CSP');
  const bytes = Buffer.from(await response.arrayBuffer());
  check(bytes.equals(pdf) && createHash('sha256').update(bytes).digest('hex') === state.fileHash, 'El original descargado cambió');
}
async function verifySaved(first, second) {
  const a = await snapshot(first), b = await snapshot(second);
  check(a.profile?.id === state.users.a.id && b.profile?.id === state.users.b.id, 'Perfiles fuera de sus cuentas');
  check(a.cfdis.length === 2 && a.transactions.length === 0 && b.cfdis.length === 0 && b.transactions.length === 0, 'Registros inesperados o aislamiento roto');
  const original = a.cfdis.find(document => document.id === state.fileId);
  check(original?.userId === state.users.a.id && original.uuidSat === '' && original.statusSat === 'no_verificado' && original.isEfos === false && original.sourceType === 'manual', 'El registro provisional inventó identidad fiscal o propietario');
  check(original.attachment?.sha256 === state.fileHash && original.attachment.bytes === pdf.length, 'Metadatos del original cambiaron');
  const xml = a.cfdis.find(document => document.id === state.xmlId);
  check(xml?.statusSat === 'no_verificado' && isDeepStrictEqual(xml.satVerification, state.satProof), 'La consulta SAT o su estado no persistieron exactamente');
  await download(first);
  await expect(request(fileEndpoint(state.fileId), {cookie: second}), 404, 'Original ajeno');
  await expect(request(fileEndpoint(state.fileId)), 401, 'Original sin sesión');
  pass('archivo, hash, identidad provisional y consulta SAT persistidos; segunda cuenta aislada');
}
async function logout(cookie) {
  await expect(request('/api/auth/sign-out', {cookie, body: {}}), 200, 'Cierre de sesión');
  await expect(request('/api/workspace', {cookie}), 401, 'Sesión invalidada');
  await expect(request(fileEndpoint(state.fileId), {cookie}), 401, 'Descarga con sesión invalidada');
}

async function main() {
  const health = await json(request('/api/health'), 200, 'Salud funcional');
  check(health.status === 'ok' && health.mode === 'workspace', 'Migraciones o base de datos no disponibles');
  pass('aplicación funcional con PostgreSQL');
  if (values['verify-only']) {
    state = JSON.parse(await readFile(statePath, 'utf8'));
    check(state.completed === true && state.baseURL === origin, 'Estado privado incompleto o de otro entorno');
    const first = await login(state.users.a), second = await login(state.users.b);
    await verifySaved(first, second);
    if (Date.now() - Date.parse(state.satProof.checkedAt) < 55_000) {
      await expect(request('/api/workspace/sat', {cookie: first, body: {documentId: state.xmlId}}), 429, 'Cuota SAT después del reinicio');
      pass('cuota SAT durable conserva el rechazo dentro de su ventana de un minuto');
    } else console.log('INFO: la ventana SAT de un minuto ya venció; no se atribuye una prueba de rechazo al reinicio.');
    await logout(first); await logout(second); pass('sesiones nuevas cerradas e invalidadas'); return;
  }
  state = {version: 1, runId: randomUUID().slice(0, 12), users: {}, baseURL: origin, completed: false};
  const first = await register('a'), second = await register('b');
  await write(first, {action: 'profile', profile: {rfc: 'XAXX010101000', businessName: 'Pendientes cuenta A', regimeCode: '601'}});
  await write(second, {action: 'profile', profile: {rfc: 'XEXX010101000', businessName: 'Pendientes cuenta B', regimeCode: '601'}});
  pass('dos cuentas sintéticas con perfiles separados');
  const features = await json(request('/api/account/features'), 200, 'Capacidades de correo');
  check(features.emailDeliveryEnabled === false && features.requireEmailVerification === false && features.signUpEnabled === true, 'Estas pruebas requieren el piloto sin SMTP y con registro disponible');
  await expect(request('/api/auth/request-password-reset', {body: {email: state.users.a.email, redirectTo: `${origin}/workspace`}}), 503, 'Recuperación sin SMTP');
  await expect(request('/api/auth/send-verification-email', {body: {email: state.users.a.email, callbackURL: `${origin}/workspace`}}), 503, 'Verificación sin SMTP');
  pass('correo no configurado devuelve 503 y no anuncia envíos ficticios');
  await expect(request('/api/workspace/documents/provisional', {form: uploadForm()}), 401, 'Original sin sesión');
  await expect(request('/api/workspace/documents/provisional', {cookie: first, requestOrigin: 'https://foreign-origin.example', form: uploadForm()}), 403, 'Original desde origen ajeno');
  pass('carga de originales exige sesión y mismo origen');
  state.idempotencyKey = randomUUID(); await saveState();
  const idempotencyHeaders = {'Idempotency-Key': state.idempotencyKey};
  const imported = await json(request('/api/workspace/documents/provisional', {cookie: first, headers: idempotencyHeaders, form: uploadForm()}), 200, 'Original provisional');
  const original = imported.cfdis.find(document => document.attachment?.sha256 === pdfHash);
  check(original?.userId === state.users.a.id && original.id !== 'foreign-owner-spoof' && original.uuidSat === '' && original.statusSat === 'no_verificado' && original.isEfos === false, 'Original confió en campos de identidad enviados');
  state.fileId = original.id; state.fileHash = pdfHash; await saveState();
  await download(first); pass('PDF privado guardado como gasto provisional y descargado idéntico con hash SHA-256');
  await expect(request(fileEndpoint(state.fileId), {cookie: second}), 404, 'Original ajeno');
  await expect(request(fileEndpoint(state.fileId)), 401, 'Original sin sesión');
  pass('descarga de otra cuenta devuelve 404 y descarga sin sesión devuelve 401');
  const repeated = await json(request('/api/workspace/documents/provisional', {cookie: first, headers: idempotencyHeaders, form: uploadForm()}), 200, 'Reintento del mismo original');
  check(repeated.cfdis.length === 1 && repeated.cfdis[0].id === state.fileId && repeated.cfdis[0].attachment?.sha256 === state.fileHash && repeated.cfdis[0].attachment.bytes === pdf.length,
    'El reintento con la misma clave duplicó o cambió el original');
  await expect(request('/api/workspace/documents/provisional', {cookie: first, headers: idempotencyHeaders, form: uploadForm(pdf, 'application/pdf', {subtotal: 101})}), 409, 'Clave reutilizada con importes diferentes');
  const afterConflict = await snapshot(first);
  check(afterConflict.cfdis.length === 1 && afterConflict.cfdis[0].id === state.fileId && afterConflict.cfdis[0].subtotal === 100, 'El conflicto de idempotencia cambió el registro');
  pass('reintento idempotente conserva el mismo gasto y original; reutilizar la clave con importes distintos devuelve 409');
  await expect(request('/api/workspace/documents/provisional', {cookie: first, form: uploadForm(pdf, 'image/png')}), 415, 'Tipo MIME alterado');
  const tooLarge = Buffer.alloc(5 * 1024 * 1024 + 1, 32); tooLarge.set(Buffer.from('%PDF-')); tooLarge.set(Buffer.from('%%EOF'), tooLarge.length - 5);
  await expect(request('/api/workspace/documents/provisional', {cookie: first, form: uploadForm(tooLarge)}), 413, 'Archivo demasiado grande');
  check((await snapshot(first)).cfdis.length === 1, 'Una carga rechazada dejó un documento parcial');
  pass('MIME alterado y límite de 5 MiB rechazados sin documentos parciales');
  const rawXml = await readFile(path.join(root, 'tests/fixtures/sample-cfdi40.xml'), 'utf8');
  const xmlSnapshot = await write(first, {action: 'xml', rawXml});
  state.xmlId = xmlSnapshot.cfdis.find(document => document.sourceType === 'xml')?.id;
  check(typeof state.xmlId === 'string', 'XML sintético no guardado');
  await expect(request('/api/workspace/sat', {cookie: second, body: {documentId: state.xmlId}}), 404, 'Consulta SAT de documento ajeno');
  await expect(request('/api/workspace/sat', {body: {documentId: state.xmlId}}), 401, 'Consulta SAT sin sesión');
  await expect(request('/api/workspace/sat', {cookie: first, requestOrigin: 'https://foreign-origin.example', body: {documentId: state.xmlId}}), 403, 'Consulta SAT desde origen ajeno');
  pass('consulta SAT exige XML propio, sesión y mismo origen');
  const sat = await json(request('/api/workspace/sat', {cookie: first, body: {documentId: state.xmlId}}), 200, 'Consulta SAT sintética');
  check(sat.consultation?.source === 'sat' && ['not_found', 'unavailable'].includes(sat.consultation.outcome) && sat.consultation.status === 'no_verificado' && sat.consultation.efos === 'unknown' && Number.isFinite(Date.parse(sat.consultation.checkedAt)), 'La consulta de un CFDI sintético devolvió un éxito fiscal inesperado');
  if (sat.consultation.outcome === 'not_found') check(sat.consultation.code === 'N602', 'SAT no encontrado sin código N602');
  state.satProof = sat.consultation; await saveState();
  pass(sat.consultation.outcome === 'not_found' ? 'SAT oficial respondió N602 al XML sintético y conservó no verificado' : 'transporte SAT no disponible quedó fechado y conservó no verificado');
  await expect(request('/api/workspace/sat', {cookie: first, body: {documentId: state.xmlId}}), 429, 'Repetición SAT dentro del minuto');
  pass('el mismo XML admite una consulta SAT por minuto');
  for (let index = 0; index < 4; index++) await expect(request('/api/workspace/sat', {cookie: first, body: {documentId: `not-owned-${index}`}}), 404, 'Documento SAT ausente');
  const limited = await expect(request('/api/workspace/sat', {cookie: first, body: {documentId: 'not-owned-final'}}), 429, 'Límite SAT por cuenta');
  check(limited.headers.get('retry-after') === '60', 'Cuota SAT sin Retry-After');
  pass('la cuenta admite hasta seis solicitudes SAT por minuto');
  await verifySaved(first, second);
  await logout(first); await logout(second); pass('cerrar sesión invalida espacio y originales');
  state.completed = true; state.completedAt = new Date().toISOString(); await saveState();
  console.log('Estado privado guardado; usa --verify-only después de reiniciar únicamente la aplicación.');
}
try { await main(); console.log(`Resultado: ${passed} comprobaciones HTTP aprobadas.`); }
catch (error) { console.error(`FAIL tras ${passed} comprobaciones: ${error instanceof VerificationError ? error.message : 'No se pudo completar la verificación; revisa el entorno y el estado privado'}`); process.exitCode = 1; }
