import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseBankCsv } from '../src/lib/bankCsvParser.ts';
import { XmlCfdiParser } from '../src/lib/xmlParser.ts';

// node --import tsx scripts/verify-cfdi-documents-http.mjs --base-url ORIGIN
// Only public synthetic fixtures and example.test accounts are used. Credentials
// stay in ignored cache; responses, passwords, cookies and XML are never logged.
class VerificationError extends Error {}
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({options: {
  'base-url': {type: 'string', default: 'http://127.0.0.1:3001'},
  state: {type: 'string', default: 'node_modules/.cache/cfdi-documents-http.json'},
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
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};
if (!inside(cacheRoot, statePath)) throw new Error('El estado privado debe quedar dentro de node_modules/.cache.');
let state;
let passed = 0;
const activeCookies = new Set();
const originals = new Map();
const expectedDocuments = new Map();
const bankCsv = 'fecha,descripcion,monto,moneda\n2026-10-01,Pago factura sintética,-116.00,MXN\n2026-10-02,Pago parcial sintético,-58.00,MXN\n';

function check(condition, message) {
  if (!condition) throw new VerificationError(message);
}
function pass(message) {
  passed++;
  console.log(`PASS ${passed}: ${message}`);
}
const same = isDeepStrictEqual;
async function assertPrivateStatePath(create = false) {
  if (create) await mkdir(path.dirname(statePath), {recursive: true});
  const actualCache = await realpath(cacheRoot);
  const actualParent = await realpath(path.dirname(statePath));
  check(inside(await realpath(repositoryRoot), actualCache), 'La caché privada no debe apuntar fuera del proyecto');
  check(actualParent === actualCache || inside(actualCache, actualParent), 'El estado privado no debe atravesar un enlace fuera de la caché');
  try {
    const entry = await lstat(statePath);
    check(entry.isFile() && !entry.isSymbolicLink(), 'El estado privado debe ser un archivo normal dentro de la caché');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
async function saveState() {
  await assertPrivateStatePath(true);
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {mode: 0o600});
}
async function request(endpoint, {body, cookie} = {}) {
  const headers = {origin};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${origin}${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST', headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
}
async function expect(responsePromise, expectedStatus, label) {
  const response = await responsePromise;
  check(response.status === expectedStatus, `${label}: esperado HTTP ${expectedStatus}, recibido HTTP ${response.status}`);
  return response;
}
async function json(responsePromise, expectedStatus, label) {
  const response = await expect(responsePromise, expectedStatus, label);
  try { return await response.json(); }
  catch { throw new VerificationError(`${label}: respuesta JSON inválida`); }
}
async function rejectedAuthRetry(endpoint, body, label) {
  let response = await request(endpoint, {body});
  // Retry only an explicit authentication rejection, never an ambiguous write
  // or a transport failure. The shared application quota remains unchanged.
  if (response.status === 429) {
    const seconds = Number(response.headers.get('x-retry-after') ?? response.headers.get('retry-after'));
    check(Number.isFinite(seconds) && seconds > 0 && seconds <= 60, `${label}: espera de autenticación fuera del límite de prueba`);
    await response.body?.cancel();
    console.log(`Pausa de ${seconds} segundos para respetar el límite de autenticación.`);
    await delay(Math.min(60_000, seconds * 1000 + 100));
    response = await request(endpoint, {body});
  }
  return expect(Promise.resolve(response), 200, label);
}
function cookieOf(response) {
  const setCookies = response.headers.getSetCookie();
  const session = setCookies.find(value => value.split(';')[0].includes('session_token='));
  check(Boolean(session) && /;\s*HttpOnly(?:;|$)/i.test(session) && /;\s*SameSite=(?:Lax|Strict)(?:;|$)/i.test(session),
    'La autenticación no devolvió una cookie de sesión segura');
  if (baseURL.protocol === 'https:') check(/;\s*Secure(?:;|$)/i.test(session), 'La sesión HTTPS requiere Secure');
  const cookie = setCookies.map(value => value.split(';')[0]).join('; ');
  activeCookies.add(cookie);
  return cookie;
}
async function register(label) {
  const account = {email: `facturia-documents-${state.runId}-${label}@example.test`, password: `${randomBytes(32).toString('base64url')}!aA1`};
  const response = await rejectedAuthRetry('/api/auth/sign-up/email', {name: `Pruebas CFDI ${label}`, ...account}, 'Registro sintético');
  const data = await response.json();
  check(typeof data.user?.id === 'string' && data.user.id.length > 0, 'Registro sin identidad de cuenta');
  account.id = data.user.id;
  state.users[label] = account;
  await saveState();
  return {account, cookie: cookieOf(response)};
}
async function signIn(account) {
  check(typeof account?.id === 'string' && typeof account?.password === 'string' && typeof account?.email === 'string' &&
    /^facturia-documents-[a-z0-9-]+-[ab]@example\.test$/.test(account.email), 'El estado privado no contiene una cuenta sintética reconocida');
  const response = await rejectedAuthRetry('/api/auth/sign-in/email', {email: account.email, password: account.password}, 'Ingreso sintético');
  const data = await response.json();
  check(data.user?.id === account.id, 'El ingreso no conserva la identidad guardada');
  return cookieOf(response);
}
async function snapshot(cookie, spoofedUserId) {
  const endpoint = '/api/workspace' + (spoofedUserId ? `?userId=${encodeURIComponent(spoofedUserId)}` : '');
  const response = await expect(request(endpoint, {cookie}), 200, 'Lectura de espacio propio');
  check(response.headers.get('cache-control') === 'no-store', 'El espacio debe protegerse de caché');
  return response.json();
}
const action = (cookie, body) => json(request('/api/workspace', {cookie, body}), 200, `Acción ${body.action}`);
async function exportOwn(cookie, spoofedUserId) {
  const response = await expect(request(`/api/workspace/export?userId=${encodeURIComponent(spoofedUserId)}`, {cookie}), 200, 'Respaldo propio');
  check(response.headers.get('cache-control') === 'no-store' && response.headers.get('x-content-type-options') === 'nosniff', 'El respaldo requiere cabeceras privadas');
  check(response.headers.get('content-disposition') === 'attachment; filename="facturia-respaldo-v1.json"', 'El respaldo no tiene nombre de descarga esperado');
  return response.json();
}
function documentOf(records, type) {
  const document = records.find(record => record.tipoComprobante === type);
  check(Boolean(document), `No se conservó el comprobante sintético ${type}`);
  return document;
}
function checkWorkspace(saved, label, expectedIds) {
  const owner = state.users[label].id;
  check(saved.profile?.id === owner && saved.profile.rfc === 'XAXX010101000', 'El perfil no pertenece a la sesión');
  check(saved.profile.businessName === `Documentos sintéticos ${label.toUpperCase()}`, 'La restauración alteró el perfil de destino');
  check(saved.cfdis.length === 3 && saved.transactions.length === 2, 'El espacio no conserva tres documentos y dos movimientos');
  check([...saved.cfdis, ...saved.transactions].every(record => record.userId === owner), 'El espacio contiene registros de otro propietario');
  const ids = {};
  for (const type of ['I', 'P', 'E']) {
    const actual = documentOf(saved.cfdis, type);
    const expected = expectedDocuments.get(type);
    ids[type] = actual.id;
    check(actual.uuidSat === expected.uuidSat && actual.total === expected.total && actual.currency === expected.currency &&
      same(actual.relatedCfdis, expected.relatedCfdis) && same(actual.paymentComplement, expected.paymentComplement) &&
      actual.metodoPago === expected.metodoPago && actual.statusSat === 'no_verificado' && actual.isEfos === false,
    'Los metadatos del XML cambiaron o afirman verificación fiscal');
    check(actual.rawXml === undefined || actual.rawXml === originals.get(type), 'Se alteró un XML original');
  }
  const full = saved.transactions.find(transaction => transaction.amount === -116);
  const partial = saved.transactions.find(transaction => transaction.amount === -58);
  check(full?.status === 'conciliado' && full.matchedCfdiId === ids.I, 'La factura completa no conserva su conciliación');
  check(partial?.status === 'discrepancia' && partial.matchedCfdiId === null && !partial.candidateCfdiIds?.length,
    'El complemento o crédito creó una conciliación bancaria');
  ids.full = full.id;
  ids.partial = partial.id;
  if (expectedIds) check(same(ids, expectedIds), 'Los identificadores persistidos cambiaron');
  return ids;
}
function transactionsFor(owner) {
  const parsed = parseBankCsv(bankCsv, {userId: owner, accountId: 'cfdi-documents-test-bank'});
  check(parsed.errors.length === 0 && parsed.transactions.length === 2, 'El CSV sintético no pasó el parser real');
  return parsed.transactions;
}
async function verifySaved(firstCookie, secondCookie) {
  checkWorkspace(await snapshot(firstCookie, state.users.b.id), 'a', state.source);
  checkWorkspace(await snapshot(secondCookie, state.users.a.id), 'b', state.restored);
  for (const [label, cookie, foreignId] of [['a', firstCookie, state.users.b.id], ['b', secondCookie, state.users.a.id]]) {
    const backup = await exportOwn(cookie, foreignId);
    check(backup.format === 'facturia-workspace-backup' && backup.version === 1 && backup.mode === 'workspace', 'Formato de respaldo incorrecto');
    checkWorkspace(backup, label, label === 'a' ? state.source : state.restored);
    for (const type of ['I', 'P', 'E']) check(documentOf(backup.cfdis, type).rawXml === originals.get(type), 'El respaldo no conserva su XML original');
    const text = JSON.stringify(backup);
    check(![state.users.a.password, state.users.b.password, firstCookie, secondCookie, state.users.a.email, state.users.b.email].some(secret => text.includes(secret)),
      'El respaldo contiene credenciales o sesiones');
  }
  pass('sesiones propias conservan tres CFDI, dos movimientos y XML originales sin credenciales');
  const deduplicated = await action(secondCookie, {action: 'transactions', transactions: transactionsFor(state.users.b.id)});
  checkWorkspace(deduplicated, 'b', state.restored);
  await expect(request('/api/workspace', {cookie: firstCookie, body: {action: 'xml', rawXml: originals.get('P')}}), 409, 'Pago persistido duplicado');
  await expect(request('/api/workspace', {cookie: secondCookie, body: {action: 'resolve', transactionId: state.source.partial, cfdiId: state.source.P}}), 404, 'Movimiento de otra cuenta');
  await expect(request(`/api/workspace/documents/${encodeURIComponent(state.source.P)}/file`, {cookie: secondCookie}), 404, 'Original privado de otra cuenta');
  pass('reimportación idempotente y duplicados y registros ajenos rechazados con nuevas sesiones');
}
async function logout(cookie) {
  await expect(request('/api/auth/sign-out', {body: {}, cookie}), 200, 'Cerrar sesión sintética');
  activeCookies.delete(cookie);
  await expect(request('/api/workspace', {cookie}), 401, 'Sesión sintética cerrada');
}

async function main() {
  const health = await json(request('/api/health'), 200, 'Salud funcional');
  check(health.status === 'ok' && health.mode === 'workspace', 'La aplicación requiere PostgreSQL migrado');
  for (const [type, fixture] of [['I', 'sample-cfdi40.xml'], ['P', 'sample-payment20.xml'], ['E', 'sample-credit-note.xml']]) {
    const rawXml = await readFile(path.join(repositoryRoot, 'tests', 'fixtures', fixture), 'utf8');
    const parsed = XmlCfdiParser.parse(rawXml, 'synthetic-fixture-owner');
    check(parsed.success && parsed.cfdi?.tipoComprobante === type, 'El fixture XML público debe ser válido para el piloto');
    originals.set(type, rawXml);
    expectedDocuments.set(type, JSON.parse(JSON.stringify(parsed.cfdi)));
  }
  pass('salud PostgreSQL y fixtures sintéticos I/P/E disponibles');
  if (values['verify-only']) {
    await assertPrivateStatePath();
    state = JSON.parse(await readFile(statePath, 'utf8'));
    check(state.version === 1 && state.baseURL === origin && state.completed === true && state.source && state.restored,
      'El estado privado no corresponde a una verificación completada de este entorno');
    const firstCookie = await signIn(state.users.a);
    const secondCookie = await signIn(state.users.b);
    await verifySaved(firstCookie, secondCookie);
    await logout(firstCookie);
    await logout(secondCookie);
    pass('persistencia comprobada y nuevas sesiones sintéticas cerradas e invalidadas');
    return;
  }
  state = {version: 1, baseURL: origin, runId: randomUUID().slice(0, 12), users: {}, completed: false};
  await expect(request('/api/workspace'), 401, 'Espacio sin sesión');
  await expect(request('/api/workspace/export'), 401, 'Respaldo sin sesión');
  await expect(request('/api/workspace/documents/no-private-session/file'), 401, 'Original sin sesión');
  pass('espacios, respaldos y originales requieren autenticación');
  const first = await register('a');
  const second = await register('b');
  for (const [label, account] of [['a', first], ['b', second]]) {
    const empty = await snapshot(account.cookie);
    check(empty.profile === null && empty.cfdis.length === 0 && empty.transactions.length === 0, 'Una cuenta nueva contiene registros preexistentes');
    const own = await action(account.cookie, {action: 'profile', profile: {rfc: 'XAXX010101000', businessName: `Documentos sintéticos ${label.toUpperCase()}`,
      regimeCode: '601', id: label === 'a' ? second.account.id : first.account.id}});
    check(own.profile?.id === account.account.id, 'El perfil tomó una identidad enviada por el cliente');
  }
  pass('dos cuentas sintéticas vacías con perfil propio; identidad del cliente reemplazada');
  let imported;
  for (const type of ['I', 'P', 'E']) imported = await action(first.cookie, {action: 'xml', rawXml: originals.get(type)});
  check(imported.transactions.length === 0 && imported.cfdis.length === 3, 'Importar documentos creó movimientos bancarios');
  check(imported.cfdis.every(document => document.rawXml === undefined && document.statusSat === 'no_verificado'), 'La lectura expone XML o afirma verificación fiscal');
  const payment = documentOf(imported.cfdis, 'P');
  const credit = documentOf(imported.cfdis, 'E');
  check(payment.total === 0 && payment.currency === 'XXX' && payment.paymentComplement?.totalPaymentsMxn === '58.00' &&
    payment.paymentComplement.payments[0].relatedDocuments[0].paidAmount === '58.00' && credit.total === 58 && credit.relatedCfdis?.length === 1,
  'El pago o crédito perdió sus importes y referencias declarados');
  pass('XML I/P/E importados con pago documental de total cero y referencias; sin movimientos añadidos');
  const beforeRejected = await snapshot(first.cookie);
  const missingPayments = originals.get('P').replace(/<pago20:Pagos\b[^>]*>[\s\S]*?<\/pago20:Pagos>/, '');
  await expect(request('/api/workspace', {cookie: first.cookie, body: {action: 'xml', rawXml: missingPayments}}), 400, 'Pago sin complemento');
  await expect(request('/api/workspace', {cookie: first.cookie, body: {action: 'xml', rawXml: originals.get('P')}}), 409, 'Pago duplicado');
  check(same(await snapshot(first.cookie), beforeRejected), 'El rechazo de XML inválido o duplicado dejó cambios');
  pass('P sin Pagos y UUID duplicado rechazados sin escrituras parciales');
  // Preserve the source CSV's canonical IDs for cross-account reimport; spoof
  // only userId to check that the server takes ownership from the session.
  const transactions = transactionsFor(first.account.id).map(transaction => ({...transaction, userId: second.account.id}));
  let saved = await action(first.cookie, {action: 'transactions', transactions});
  state.source = checkWorkspace(saved, 'a');
  saved = await action(first.cookie, {action: 'transactions', transactions});
  checkWorkspace(saved, 'a', state.source);
  await saveState();
  pass('dos movimientos bancarios idempotentes: sólo factura I se concilia, pago y crédito quedan documentales');
  const beforeResolve = await snapshot(first.cookie);
  for (const type of ['P', 'E']) await expect(request('/api/workspace', {cookie: first.cookie,
    body: {action: 'resolve', transactionId: state.source.partial, cfdiId: state.source[type]},
  }), 409, 'Resolución documental no candidata');
  check(same(await snapshot(first.cookie), beforeResolve), 'Resolver contra P/E cambió el estado bancario');
  pass('resolver contra complemento y crédito devuelve conflicto y conserva la conciliación');
  const blank = await snapshot(second.cookie, first.account.id);
  check(blank.profile?.id === second.account.id && blank.cfdis.length === 0 && blank.transactions.length === 0, 'Consultar userId ajeno expone registros');
  await expect(request('/api/workspace', {cookie: second.cookie, body: {action: 'resolve', transactionId: state.source.partial, cfdiId: state.source.P}}), 404, 'Resolver movimiento ajeno');
  await expect(request(`/api/workspace/documents/${encodeURIComponent(state.source.P)}/file`, {cookie: second.cookie}), 404, 'Original ajeno');
  const emptyBackup = await exportOwn(second.cookie, first.account.id);
  check(emptyBackup.profile?.id === second.account.id && emptyBackup.cfdis.length === 0, 'Exportar userId ajeno expone documentos');
  pass('segunda cuenta permanece vacía; referencias ajenas y spoof de propietario no exponen datos');
  const backup = await exportOwn(first.cookie, second.account.id);
  checkWorkspace(backup, 'a', state.source);
  for (const type of ['I', 'P', 'E']) check(documentOf(backup.cfdis, type).rawXml === originals.get(type), 'La exportación perdió el XML original');
  pass('respaldo JSON propio conserva XML originales, decimales de pagos y relaciones documentales');
  const forged = structuredClone(backup);
  documentOf(forged.cfdis, 'P').paymentComplement = {version: '2.0', totalPaymentsMxn: '999.00', payments: [{
    date: '2026-10-05T13:30:00', currency: 'MXN', amount: '999.000000', form: '01', relatedDocuments: [{
      uuid: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', currency: 'MXN', installment: 9,
      previousBalance: '2000.000000', paidAmount: '999.000000', remainingBalance: '1001.000000', taxObject: '01',
    }],
  }]};
  documentOf(forged.cfdis, 'E').relatedCfdis = [{type: '04', uuids: ['AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA']}];
  const preview = await json(request('/api/workspace/restore', {cookie: second.cookie, body: {action: 'preview', backup: forged}}), 200, 'Vista previa de recuperación');
  check(preview.preview?.documents === 3 && preview.preview.transactions === 2 && preview.preview.matchedTransactions === 1,
    'La vista previa no mantiene los conteos y conciliación esperados');
  check(same(await snapshot(second.cookie), blank), 'La vista previa modificó el espacio vacío');
  pass('previsualización de respaldo revalida tres documentos sin modificar el destino');
  const restored = await json(request('/api/workspace/restore', {cookie: second.cookie, body: {action: 'restore', backup: forged}}), 200, 'Recuperación de documentos');
  state.restored = checkWorkspace(restored, 'b');
  check(state.restored.I !== state.source.I && state.restored.full !== state.source.full, 'La recuperación reutilizó identificadores de otra cuenta');
  check(same(await snapshot(first.cookie), beforeResolve), 'La recuperación alteró la cuenta de origen');
  await saveState();
  const beforeRepeated = await snapshot(second.cookie);
  await expect(request('/api/workspace/restore', {cookie: second.cookie, body: {action: 'restore', backup}}), 409, 'Recuperación repetida');
  check(same(await snapshot(second.cookie), beforeRepeated), 'La recuperación repetida cambió el destino ocupado');
  pass('recuperación canónica propia con XML original; repetición rechazada sin duplicar ni sobrescribir');
  await logout(first.cookie);
  await logout(second.cookie);
  const firstCookie = await signIn(first.account);
  const secondCookie = await signIn(second.account);
  await verifySaved(firstCookie, secondCookie);
  await logout(firstCookie);
  await logout(secondCookie);
  pass('sesiones sintéticas cerradas e invalidadas después de comprobar persistencia');
  state.completed = true;
  state.completedAt = new Date().toISOString();
  await saveState();
  console.log('Estado privado guardado en caché ignorada; disponible para --verify-only tras reiniciar.');
}

try {
  await main();
  console.log(`Resultado: ${passed} comprobaciones HTTP documentales aprobadas.`);
} catch (error) {
  const message = error instanceof VerificationError ? error.message : 'No se completó la verificación documental; revisa el entorno y el estado privado';
  console.error(`FAIL tras ${passed} comprobaciones: ${message}`);
  process.exitCode = 1;
} finally {
  // Close remaining synthetic sessions on failure without retrying mutations.
  for (const cookie of activeCookies) {
    try { await logout(cookie); }
    catch { console.error('No se pudo comprobar el cierre de una sesión sintética de esta prueba.'); }
  }
}
