import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseBankCsv } from '../src/lib/bankCsvParser.ts';

class VerificationError extends Error {}

// Run with: node --import tsx scripts/verify-workspace-http.mjs
// Only synthetic data is created. State contains passwords and must stay in the
// ignored cache. No credentials, cookies or response payloads are printed.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({options: {
  'base-url': {type: 'string', default: 'http://127.0.0.1:3000'},
  state: {type: 'string', default: 'node_modules/.cache/local-http.json'},
  'verify-only': {type: 'boolean', default: false},
}});
const baseURL = new URL(values['base-url']);
if (!['http:', 'https:'].includes(baseURL.protocol) || baseURL.username || baseURL.password ||
    baseURL.pathname !== '/' || baseURL.search || baseURL.hash) {
  throw new Error('La URL debe ser el origen HTTP(S) de la aplicación, sin credenciales ni rutas.');
}
const origin = baseURL.origin;
const cacheRoot = path.resolve(repositoryRoot, 'node_modules', '.cache');
const statePath = path.resolve(repositoryRoot, values.state);
const relativeStatePath = path.relative(cacheRoot, statePath);
if (!relativeStatePath || relativeStatePath.startsWith('..') || path.isAbsolute(relativeStatePath)) {
  throw new Error('El archivo privado de estado debe quedar dentro de node_modules/.cache.');
}
let passed = 0;
let state;

function check(condition, message) {
  if (!condition) throw new VerificationError(message);
}
function pass(message) {
  passed++;
  console.log(`PASS ${passed}: ${message}`);
}
async function request(endpoint, {body, cookie, requestOrigin = origin} = {}) {
  const headers = {origin: requestOrigin};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${origin}${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  });
}
async function expectResponse(responsePromise, expectedStatus, label) {
  const response = await responsePromise;
  check(response.status === expectedStatus, `${label}: esperado HTTP ${expectedStatus}, recibido HTTP ${response.status}`);
  return response;
}
async function json(responsePromise, expectedStatus, label) {
  const response = await expectResponse(responsePromise, expectedStatus, label);
  try { return await response.json(); }
  catch { throw new VerificationError(`${label}: la respuesta no es JSON válido`); }
}
function cookieOf(response) {
  const setCookies = response.headers.getSetCookie();
  const sessionCookie = setCookies.find(value => value.split(';')[0].includes('session_token='));
  check(Boolean(sessionCookie), 'La autenticación no devolvió la cookie de sesión esperada');
  check(/;\s*HttpOnly(?:;|$)/i.test(sessionCookie) && /;\s*SameSite=(?:Lax|Strict)(?:;|$)/i.test(sessionCookie),
    'La cookie de sesión no incluye HttpOnly y SameSite seguros');
  if (baseURL.protocol === 'https:') {
    check(/;\s*Secure(?:;|$)/i.test(sessionCookie), 'La cookie HTTPS no incluye Secure');
  }
  const cookie = setCookies.map(value => value.split(';')[0]).join('; ');
  check(cookie.includes('session_token='), 'La autenticación no devolvió la cookie de sesión esperada');
  return cookie;
}
async function saveState() {
  await mkdir(path.dirname(statePath), {recursive: true});
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {mode: 0o600});
}
async function register(label) {
  const account = {
    email: `facturia-${state.runId}-${label}@example.test`,
    password: `${randomBytes(32).toString('base64url')}!aA1`,
  };
  const response = await expectResponse(request('/api/auth/sign-up/email', {
    body: {name: `Pruebas HTTP ${label}`, email: account.email, password: account.password},
  }), 200, `Registro de cuenta sintética ${label}`);
  const data = await response.json();
  check(typeof data.user?.id === 'string', 'Registro sin identificador de cuenta');
  account.id = data.user.id;
  state.users[label] = account;
  await saveState();
  return {account, cookie: cookieOf(response)};
}
async function signIn(account) {
  const response = await expectResponse(request('/api/auth/sign-in/email', {
    body: {email: account.email, password: account.password},
  }), 200, 'Ingreso con credenciales sintéticas guardadas');
  const data = await response.json();
  check(data.user?.id === account.id, 'El ingreso no conservó la identidad guardada');
  return cookieOf(response);
}
async function getSnapshot(cookie) {
  const response = await expectResponse(request('/api/workspace', {cookie}), 200, 'Lectura de espacio propio');
  check(response.headers.get('cache-control') === 'no-store', 'El espacio no protege su respuesta de caché');
  return response.json();
}
async function writeAction(cookie, action) {
  return json(request('/api/workspace', {body: action, cookie}), 200, `Acción ${action.action}`);
}
async function exportOwn(cookie, spoofedUserId) {
  const response = await expectResponse(request(`/api/workspace/export?userId=${encodeURIComponent(spoofedUserId)}`, {cookie}), 200, 'Exportación privada');
  check(response.headers.get('cache-control') === 'no-store', 'Exportación sin protección de caché');
  check(response.headers.get('content-disposition') === 'attachment; filename="facturia-respaldo-v1.json"', 'Exportación sin nombre de descarga esperado');
  check(response.headers.get('x-content-type-options') === 'nosniff', 'Exportación sin protección de tipo de contenido');
  return response.json();
}
async function health() {
  const status = await json(request('/api/health'), 200, 'Salud de base migrada');
  check(status.status === 'ok' && status.mode === 'workspace', 'El servidor no activó el espacio funcional');
  pass('salud funcional con PostgreSQL y migraciones disponibles');
}
async function logout(cookie) {
  await expectResponse(request('/api/auth/sign-out', {body: {}, cookie}), 200, 'Cerrar sesión');
  await expectResponse(request('/api/workspace', {cookie}), 401, 'Sesión cerrada');
}
async function verifySaved(firstCookie, secondCookie, firstXml, secondXml) {
  const first = await getSnapshot(firstCookie);
  const second = await getSnapshot(secondCookie);
  check(first.profile?.id === state.users.a.id && second.profile?.id === state.users.b.id, 'Los perfiles no pertenecen a sus sesiones');
  check(first.cfdis.length === 2 && first.transactions.length === 1, 'La primera cuenta no conserva sus registros esperados');
  check(second.cfdis.length === 1 && second.transactions.length === 0, 'La segunda cuenta contiene registros ajenos');
  check(first.transactions[0].id === state.transactionId && first.transactions[0].status === 'conciliado' &&
    first.transactions[0].matchedCfdiId === state.documentId, 'No se conservó la conciliación esperada');
  check(first.cfdis.every(record => record.userId === state.users.a.id) &&
    second.cfdis.every(record => record.userId === state.users.b.id), 'Hay documentos de otra cuenta');
  const firstBackup = await exportOwn(firstCookie, state.users.b.id);
  const secondBackup = await exportOwn(secondCookie, state.users.a.id);
  check(firstBackup.mode === 'workspace' && firstBackup.version === 1 && firstBackup.profile?.id === state.users.a.id,
    'Exportación propia incorrecta');
  check(secondBackup.profile?.id === state.users.b.id && secondBackup.cfdis.length === 1 && secondBackup.transactions.length === 0,
    'La exportación de segunda cuenta contiene datos ajenos');
  check(firstBackup.cfdis.find(record => record.id === state.documentId)?.rawXml === firstXml &&
    secondBackup.cfdis[0].rawXml === secondXml, 'La exportación no conserva los XML originales propios');
  const serialized = JSON.stringify(firstBackup);
  check(!serialized.includes('Servicio privado segunda cuenta') && !serialized.includes(state.users.a.password) &&
    !serialized.includes(firstCookie), 'La exportación contiene información privada ajena o credenciales');
  pass('perfiles, documentos y movimientos aislados por sesión; exportación privada con XML originales');
}

async function main() {
  await health();
  const firstXml = await readFile(path.join(repositoryRoot, 'tests/fixtures/sample-cfdi40.xml'), 'utf8');
  const secondXml = firstXml.replace('XAXX010101000', 'XEXX010101000')
    .replace('Servicio de prueba', 'Servicio privado segunda cuenta');
  if (values['verify-only']) {
    state = JSON.parse(await readFile(statePath, 'utf8'));
    check(state.baseURL === origin && state.completed === true, 'El estado privado no corresponde a este entorno o quedó incompleto');
    const firstCookie = await signIn(state.users.a);
    const secondCookie = await signIn(state.users.b);
    await verifySaved(firstCookie, secondCookie, firstXml, secondXml);
    pass('persistencia comprobada usando nuevas sesiones de las mismas cuentas');
    await logout(firstCookie);
    await logout(secondCookie);
    pass('sesiones de verificación cerradas e invalidadas');
    return;
  }
  state = {version: 1, baseURL: origin, runId: randomUUID().slice(0, 12), users: {}, completed: false};
  const unsignedExport = await expectResponse(request('/api/workspace/export'), 401, 'Exportación sin sesión');
  check(unsignedExport.headers.get('cache-control') === 'no-store', 'El rechazo de exportación no protege la caché');
  await expectResponse(request('/api/workspace'), 401, 'Espacio sin sesión');
  pass('datos y respaldos requieren una sesión autenticada');
  const first = await register('a');
  const second = await register('b');
  const initial = await getSnapshot(first.cookie);
  check(initial.profile === null && initial.cfdis.length === 0 && initial.transactions.length === 0, 'Cuenta nueva con datos preexistentes');
  await expectResponse(request('/api/auth/sign-in/email', {body: {
    email: first.account.email, password: `${randomBytes(24).toString('hex')}!Wrong1`,
  }}), 401, 'Contraseña incorrecta');
  pass('registro de dos cuentas nuevas y rechazo de contraseña incorrecta');
  await expectResponse(request('/api/workspace', {
    cookie: first.cookie, requestOrigin: 'https://foreign-origin.example.test',
    body: {action: 'profile', profile: {rfc: 'XAXX010101000', businessName: 'Origen ajeno', regimeCode: '601'}},
  }), 403, 'Protección de origen');
  check((await getSnapshot(first.cookie)).profile === null, 'El origen ajeno alteró el perfil');
  pass('escrituras de origen ajeno rechazadas sin cambiar el perfil');
  const savedProfile = await writeAction(first.cookie, {action: 'profile', profile: {
    rfc: 'XAXX010101000', businessName: 'Empresa sintética A', regimeCode: '601', id: second.account.id,
  }});
  check(savedProfile.profile.id === first.account.id, 'El perfil aceptó una identidad enviada por el cliente');
  await writeAction(second.cookie, {action: 'profile', profile: {rfc: 'XEXX010101000', businessName: 'Empresa sintética B', regimeCode: '601'}});
  const importedXml = await writeAction(first.cookie, {action: 'xml', rawXml: firstXml});
  state.documentId = importedXml.cfdis[0].id;
  check(importedXml.cfdis[0].statusSat === 'no_verificado' && importedXml.cfdis[0].rawXml === undefined,
    'El documento afirma verificación fiscal o expone XML en la lectura ordinaria');
  await expectResponse(request('/api/workspace', {cookie: first.cookie, body: {action: 'xml', rawXml: firstXml}}), 409, 'XML duplicado');
  await expectResponse(request('/api/workspace', {cookie: second.cookie, body: {action: 'xml', rawXml: firstXml}}), 400, 'XML con RFC ajeno');
  await writeAction(second.cookie, {action: 'xml', rawXml: secondXml});
  pass('XML validado, duplicados rechazados y pertenencia fiscal comprobada sin afirmar validación SAT');
  const csv = await readFile(path.join(repositoryRoot, 'tests/fixtures/sample-bank.csv'), 'utf8');
  const parsed = parseBankCsv(csv, {userId: second.account.id, accountId: 'http-test-bank'});
  check(parsed.errors.length === 0 && parsed.transactions.length === 1, 'El fixture CSV no pasó el parser bancario real');
  const bank = await writeAction(first.cookie, {action: 'transactions', transactions: parsed.transactions});
  state.transactionId = bank.transactions[0].id;
  check(bank.transactions[0].userId === first.account.id && bank.transactions[0].status === 'conciliado' &&
    bank.transactions[0].matchedCfdiId === state.documentId, 'Importación bancaria sin identidad o conciliación válida');
  const repeated = await writeAction(first.cookie, {action: 'transactions', transactions: parsed.transactions});
  check(repeated.transactions.length === 1 && repeated.transactions[0].id === state.transactionId, 'Reimportación bancaria no idempotente');
  pass('CSV real conciliado e idempotente; el servidor reemplaza la identidad del cliente');
  for (const action of ['resolve', 'unmatch', 'resumeReconciliation']) {
    await expectResponse(request('/api/workspace', {cookie: second.cookie, body: {
      action, transactionId: state.transactionId, cfdiId: state.documentId,
    }}), 404, `Protección de ${action} sobre registros ajenos`);
  }
  pass('resolver, desvincular y reanudar movimientos ajenos rechazados');
  const unlinked = await writeAction(first.cookie, {action: 'unmatch', transactionId: state.transactionId});
  check(unlinked.transactions[0].reconciliationLocked === true && unlinked.transactions[0].matchedCfdiId === null,
    'Desvinculación sin bloqueo manual');
  const unlinkedAgain = await writeAction(first.cookie, {action: 'transactions', transactions: parsed.transactions});
  check(unlinkedAgain.transactions[0].matchedCfdiId === null && unlinkedAgain.transactions[0].reconciliationLocked === true,
    'La reimportación ignoró el bloqueo manual');
  const resumed = await writeAction(first.cookie, {action: 'resumeReconciliation', transactionId: state.transactionId});
  check(resumed.transactions[0].status === 'conciliado' && resumed.transactions[0].matchedCfdiId === state.documentId,
    'La reanudación no restableció el vínculo válido');
  pass('desvinculación persiste hasta reanudar explícitamente la conciliación');
  const manual = await writeAction(first.cookie, {action: 'manual', document: {
    rfcEmisor: 'AAA010101AAA', nombreEmisor: 'PROVEEDOR SINTETICO', subtotal: 50,
    iva: 0, retenciones: 0, fechaEmision: '2026-10-01', currency: 'MXN',
  }});
  const provisional = manual.cfdis.find(record => record.sourceType === 'manual');
  check(provisional?.uuidSat === '' && provisional.total === 50 && provisional.iva === 0 && provisional.statusSat === 'no_verificado',
    'El documento provisional inventó UUID, IVA o verificación SAT');
  pass('registro provisional conserva impuestos declarados sin inventar UUID ni validez fiscal');
  await verifySaved(first.cookie, second.cookie, firstXml, secondXml);
  await logout(first.cookie);
  await logout(second.cookie);
  pass('cerrar sesión invalida el acceso a los datos');
  state.completed = true;
  state.completedAt = new Date().toISOString();
  await saveState();
  console.log('Estado privado guardado en la caché ignorada; listo para verificar persistencia después de reiniciar.');
}

try {
  await main();
  console.log(`Resultado: ${passed} comprobaciones HTTP aprobadas.`);
} catch (error) {
  const safeMessage = error instanceof VerificationError ? error.message : 'No se pudo completar la verificación HTTP; revisa el entorno y el estado privado';
  // Native errors can embed request bodies, malformed JSON or local file data.
  console.error(`FAIL tras ${passed} comprobaciones: ${safeMessage}`);
  process.exitCode = 1;
}
