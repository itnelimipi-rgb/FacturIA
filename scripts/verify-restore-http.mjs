import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseBankCsv } from '../src/lib/bankCsvParser.ts';

class VerificationError extends Error {}

// Run with node --import tsx scripts/verify-restore-http.mjs --base-url ORIGIN.
// Synthetic credentials stay in the ignored cache; output contains only checks.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({options: {
  'base-url': {type: 'string', default: 'http://127.0.0.1:3000'},
  state: {type: 'string', default: 'node_modules/.cache/local-restore-http.json'},
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
  check(response.status === expectedStatus,
    `${label}: esperado HTTP ${expectedStatus}, recibido HTTP ${response.status}`);
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
  check(/;\s*HttpOnly(?:;|$)/i.test(sessionCookie) &&
    /;\s*SameSite=(?:Lax|Strict)(?:;|$)/i.test(sessionCookie),
  'La cookie de sesión no incluye HttpOnly y SameSite seguros');
  if (baseURL.protocol === 'https:') {
    check(/;\s*Secure(?:;|$)/i.test(sessionCookie), 'La cookie HTTPS no incluye Secure');
  }
  return setCookies.map(value => value.split(';')[0]).join('; ');
}
async function saveState() {
  await mkdir(path.dirname(statePath), {recursive: true});
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {mode: 0o600});
}
async function register(label) {
  const account = {
    email: `facturia-restore-${state.runId}-${label}@example.test`,
    password: `${randomBytes(32).toString('base64url')}!aA1`,
  };
  const registrationBody = {name: `Pruebas respaldo ${label}`, email: account.email, password: account.password};
  let response = await request('/api/auth/sign-up/email', {body: registrationBody});
  // Respect BetterAuth's stricter signup rule (three requests in ten seconds).
  // A 429 guarantees this request was not registered; never retry ambiguous errors.
  if (response.status === 429) {
    const retrySeconds = Number(response.headers.get('x-retry-after') ?? response.headers.get('retry-after'));
    check(Number.isFinite(retrySeconds) && retrySeconds > 0 && retrySeconds <= 60,
      'El registro requiere esperar antes de repetir las pruebas');
    await response.body?.cancel();
    console.log(`Pausa de ${retrySeconds} segundos para respetar el límite de registros de prueba.`);
    await delay(retrySeconds * 1000 + 100);
    response = await request('/api/auth/sign-up/email', {body: registrationBody});
  }
  await expectResponse(Promise.resolve(response), 200, `Registro de cuenta sintética ${label}`);
  const data = await response.json();
  check(typeof data.user?.id === 'string', 'Registro sin identificador de cuenta');
  account.id = data.user.id;
  state.users[label] = account;
  await saveState();
  return {account, cookie: cookieOf(response)};
}
async function signIn(account) {
  const response = await expectResponse(request('/api/auth/sign-in/email', {body: {
    email: account.email, password: account.password,
  }}), 200, 'Ingreso con credenciales sintéticas guardadas');
  const data = await response.json();
  check(data.user?.id === account.id, 'El ingreso no conservó la identidad guardada');
  return cookieOf(response);
}
async function getSnapshot(cookie) {
  const response = await expectResponse(request('/api/workspace', {cookie}), 200, 'Lectura de espacio propio');
  check(response.headers.get('cache-control') === 'no-store', 'El espacio no protege su respuesta de caché');
  return response.json();
}
async function writeAction(cookie, body) {
  return json(request('/api/workspace', {cookie, body}), 200, `Acción ${body.action}`);
}
async function restoreAction(cookie, action, backup, options = {}) {
  const response = await expectResponse(request('/api/workspace/restore', {
    cookie, body: {action, backup}, ...options,
  }), 200, `Restauración ${action}`);
  check(response.headers.get('cache-control') === 'no-store', 'La restauración no protege su respuesta de caché');
  return response.json();
}
async function exportOwn(cookie, spoofedUserId) {
  const response = await expectResponse(request(`/api/workspace/export?userId=${encodeURIComponent(spoofedUserId)}`, {cookie}),
    200, 'Exportación privada');
  check(response.headers.get('cache-control') === 'no-store', 'El respaldo no protege su respuesta de caché');
  check(response.headers.get('content-disposition') === 'attachment; filename="facturia-respaldo-v1.json"',
    'El respaldo no tiene el nombre de descarga esperado');
  check(response.headers.get('x-content-type-options') === 'nosniff', 'El respaldo no protege su tipo de contenido');
  return response.json();
}
async function logout(cookie) {
  await expectResponse(request('/api/auth/sign-out', {body: {}, cookie}), 200, 'Cerrar sesión');
  await expectResponse(request('/api/workspace', {cookie}), 401, 'Sesión cerrada');
}
function checkDestination(snapshot) {
  const owner = state.users.b.id;
  check(snapshot.profile?.id === owner && snapshot.profile.rfc === 'XAXX010101000',
    'El perfil restaurado no pertenece a la sesión de destino');
  check(snapshot.profile.businessName === 'Destino sintético B' && snapshot.profile.regimeCode === '601',
    'La restauración sobrescribió el perfil de destino');
  check(snapshot.cfdis.length === 2 && snapshot.transactions.length === 2,
    'La restauración no conserva todos los documentos y movimientos');
  check([...snapshot.cfdis, ...snapshot.transactions].every(record => record.userId === owner),
    'La restauración conserva una identidad enviada por el respaldo');
  const xml = snapshot.cfdis.find(document => document.uuidSat === '12345678-ABCD-4321-8ABC-123456789ABC');
  const manual = snapshot.cfdis.find(document => document.sourceType === 'manual');
  const matched = snapshot.transactions.find(transaction => transaction.amount === -116);
  const locked = snapshot.transactions.find(transaction => transaction.amount === -50);
  check(xml?.statusSat === 'no_verificado' && xml.isEfos === false && xml.total === 116,
    'La restauración afirma verificación fiscal o altera el importe del XML');
  check(manual?.uuidSat === '' && manual.total === 50 && manual.iva === 0 && manual.statusSat === 'no_verificado',
    'El registro provisional restaurado inventa UUID, IVA o verificación SAT');
  check(matched?.status === 'conciliado' && matched.matchedCfdiId === xml.id,
    'La restauración no remapeó el vínculo a un documento del destino');
  check(locked?.reconciliationLocked === true && locked.matchedCfdiId === null,
    'La restauración perdió la pausa manual de conciliación');
  if (state.restored) {
    check(xml.id === state.restored.xmlId && manual.id === state.restored.manualId &&
      matched.id === state.restored.matchedId && locked.id === state.restored.lockedId,
    'Los identificadores restaurados cambiaron después del reinicio');
  }
  return {xmlId: xml.id, manualId: manual.id, matchedId: matched.id, lockedId: locked.id};
}
async function verifySaved(sourceCookie, destinationCookie, firstXml) {
  const source = await getSnapshot(sourceCookie);
  const destination = await getSnapshot(destinationCookie);
  check(source.profile?.id === state.users.a.id && source.cfdis.length === 2 && source.transactions.length === 2,
    'La restauración alteró el espacio de origen');
  check(source.cfdis.some(document => document.id === state.source.xmlId) &&
    source.transactions.some(transaction => transaction.id === state.source.matchedId),
  'La restauración alteró los identificadores del origen');
  checkDestination(destination);
  const backup = await exportOwn(destinationCookie, state.users.a.id);
  check(backup.mode === 'workspace' && backup.version === 1 && backup.profile?.id === state.users.b.id,
    'El respaldo del destino pertenece a otra cuenta');
  check(backup.cfdis.find(document => document.id === state.restored.xmlId)?.rawXml === firstXml,
    'El destino no conserva el XML original completo');
  checkDestination(backup);
  const serialized = JSON.stringify(backup);
  check(!serialized.includes(state.users.a.password) && !serialized.includes(state.users.b.password) &&
    !serialized.includes(sourceCookie) && !serialized.includes(destinationCookie),
  'El respaldo incluye credenciales o sesiones');
  pass('registros de origen intactos; destino propietario de datos y XML exportable sin credenciales');
}

async function main() {
  const health = await json(request('/api/health'), 200, 'Salud de base migrada');
  check(health.status === 'ok' && health.mode === 'workspace', 'El servidor no activó el espacio funcional');
  pass('salud funcional con PostgreSQL y migraciones disponibles');
  const firstXml = await readFile(path.join(repositoryRoot, 'tests/fixtures/sample-cfdi40.xml'), 'utf8');
  if (values['verify-only']) {
    state = JSON.parse(await readFile(statePath, 'utf8'));
    check(state.baseURL === origin && state.completed === true,
      'El estado privado no corresponde a este entorno o quedó incompleto');
    const sourceCookie = await signIn(state.users.a);
    const destinationCookie = await signIn(state.users.b);
    await verifySaved(sourceCookie, destinationCookie, firstXml);
    pass('persistencia de identidades, vínculos y pausa manual comprobada con nuevas sesiones');
    await logout(sourceCookie);
    await logout(destinationCookie);
    pass('sesiones de verificación cerradas e invalidadas');
    return;
  }

  state = {version: 1, baseURL: origin, runId: randomUUID().slice(0, 12), users: {}, completed: false};
  const source = await register('a');
  const destination = await register('b');
  const foreign = await register('c');
  const blank = await register('d');
  await writeAction(source.cookie, {action: 'profile', profile: {
    rfc: 'XAXX010101000', businessName: 'Origen sintético A', regimeCode: '601', id: destination.account.id,
  }});
  await writeAction(destination.cookie, {action: 'profile', profile: {
    rfc: 'XAXX010101000', businessName: 'Destino sintético B', regimeCode: '601', id: source.account.id,
  }});
  await writeAction(foreign.cookie, {action: 'profile', profile: {
    rfc: 'XEXX010101000', businessName: 'RFC ajeno sintético C', regimeCode: '601',
  }});
  await writeAction(blank.cookie, {action: 'profile', profile: {
    rfc: 'XAXX010101000', businessName: 'Vacío sintético D', regimeCode: '601',
  }});
  await writeAction(source.cookie, {action: 'xml', rawXml: firstXml});
  await writeAction(source.cookie, {action: 'manual', document: {
    rfcEmisor: 'AAA010101AAA', nombreEmisor: 'PROVEEDOR SINTETICO', subtotal: 50,
    iva: 0, retenciones: 0, fechaEmision: '2026-10-01', currency: 'MXN',
  }});
  const csv = await readFile(path.join(repositoryRoot, 'tests/fixtures/sample-bank.csv'), 'utf8');
  const bankCsv = `${csv.trimEnd()}\n2026-10-01,Movimiento pausado sintético,-50.00,MXN\n`;
  const parsed = parseBankCsv(bankCsv, {
    userId: source.account.id, accountId: 'restore-test-bank',
  });
  check(parsed.errors.length === 0 && parsed.transactions.length === 2, 'El CSV no pasó el parser bancario real');
  const bank = await writeAction(source.cookie, {action: 'transactions', transactions: parsed.transactions});
  const locked = bank.transactions.find(transaction => transaction.amount === -50);
  check(Boolean(locked), 'No se creó el movimiento de prueba para pausa manual');
  const seeded = await writeAction(source.cookie, {action: 'unmatch', transactionId: locked.id});
  const sourceXml = seeded.cfdis.find(document => document.sourceType === 'xml');
  const sourceMatched = seeded.transactions.find(transaction => transaction.amount === -116);
  check(sourceMatched?.matchedCfdiId === sourceXml?.id &&
    seeded.transactions.find(transaction => transaction.id === locked.id)?.reconciliationLocked === true,
  'Los datos de origen no contienen el vínculo y la pausa esperados');
  state.source = {xmlId: sourceXml.id, matchedId: sourceMatched.id, lockedId: locked.id};
  await saveState();
  const backup = await exportOwn(source.cookie, destination.account.id);
  // A backup may carry old SAT metadata, but restoring cannot verify its validity.
  backup.cfdis.find(document => document.id === sourceXml.id).statusSat = 'vigente';
  const blankBefore = await getSnapshot(blank.cookie);
  const destinationBefore = await getSnapshot(destination.cookie);
  const sourceBefore = await getSnapshot(source.cookie);
  pass('respaldo real preparado con XML, provisional, vínculo y pausa manual de conciliación');

  await expectResponse(request('/api/workspace/restore', {body: {action: 'preview', backup}}), 401,
    'Restauración sin sesión');
  await expectResponse(request('/api/workspace/restore', {cookie: blank.cookie,
    requestOrigin: 'https://foreign-origin.example.test', body: {action: 'restore', backup},
  }), 403, 'Restauración desde origen ajeno');
  check(JSON.stringify(await getSnapshot(blank.cookie)) === JSON.stringify(blankBefore),
    'El acceso rechazado alteró el destino vacío');
  pass('restauración exige sesión y origen autorizado; rechazos sin escrituras');

  for (const action of ['preview', 'restore']) {
    await expectResponse(request('/api/workspace/restore', {cookie: foreign.cookie, body: {action, backup}}),
      400, `RFC ajeno en ${action}`);
  }
  const foreignAfter = await getSnapshot(foreign.cookie);
  check(foreignAfter.cfdis.length === 0 && foreignAfter.transactions.length === 0 &&
    foreignAfter.profile?.rfc === 'XEXX010101000', 'El respaldo alteró el destino de RFC ajeno');
  pass('un respaldo de RFC ajeno no puede previsualizarse ni restaurarse en otra cuenta');

  for (const action of ['preview', 'restore']) {
    await expectResponse(request('/api/workspace/restore', {cookie: source.cookie, body: {action, backup}}),
      409, `Destino ocupado en ${action}`);
  }
  check(JSON.stringify(await getSnapshot(source.cookie)) === JSON.stringify(sourceBefore),
    'El rechazo de destino ocupado alteró los registros existentes');
  pass('destino ocupado rechazado sin sobrescribir documentos, movimientos o conciliaciones');

  const demoBackup = structuredClone(backup);
  demoBackup.mode = 'demo';
  const invalidOwnerBackup = structuredClone(backup);
  invalidOwnerBackup.transactions[0].userId = foreign.account.id;
  const corruptedXmlBackup = structuredClone(backup);
  corruptedXmlBackup.cfdis.find(document => document.sourceType === 'xml').rawXml = '<broken>';
  for (const [label, invalidBackup] of [
    ['respaldo demostrativo', demoBackup],
    ['identidades de origen incoherentes', invalidOwnerBackup],
    ['XML original corrupto', corruptedXmlBackup],
  ]) {
    for (const action of ['preview', 'restore']) {
      await expectResponse(request('/api/workspace/restore', {cookie: blank.cookie,
        body: {action, backup: invalidBackup},
      }), 400, `${label} en ${action}`);
    }
    check(JSON.stringify(await getSnapshot(blank.cookie)) === JSON.stringify(blankBefore),
      `El rechazo de ${label} dejó escrituras parciales`);
  }
  pass('demo, identidades incoherentes y XML corrupto rechazados sin escrituras parciales');

  const concurrent = await Promise.all([
    request('/api/workspace/restore', {cookie: blank.cookie, body: {action: 'restore', backup}}),
    request('/api/workspace/restore', {cookie: blank.cookie, body: {action: 'restore', backup}}),
  ]);
  check(JSON.stringify(concurrent.map(response => response.status).sort()) === JSON.stringify([200, 409]),
    'Dos restauraciones concurrentes deben guardar una vez y rechazar la otra');
  const concurrentSaved = await getSnapshot(blank.cookie);
  check(concurrentSaved.cfdis.length === 2 && concurrentSaved.transactions.length === 2 &&
    [...concurrentSaved.cfdis, ...concurrentSaved.transactions].every(record => record.userId === blank.account.id),
  'La restauración concurrente duplicó registros o alteró su propietario');
  pass('dos restauraciones simultáneas guardan una sola copia mediante el bloqueo por cuenta');

  const preview = await restoreAction(destination.cookie, 'preview', backup);
  check(preview.preview?.rfc === 'XAXX010101000' && preview.preview.documents === 2 &&
    preview.preview.transactions === 2 && preview.preview.lockedTransactions === 1 &&
    preview.preview.matchedTransactions === 1 && typeof preview.warning === 'string' && preview.warning.length > 0,
  'La previsualización no informa el RFC, los registros y las conciliaciones esperados');
  check(JSON.stringify(await getSnapshot(destination.cookie)) === JSON.stringify(destinationBefore),
    'La previsualización escribió registros antes de confirmar');
  pass('previsualización presenta conteos y advertencia; destino permanece vacío');

  const restored = await restoreAction(destination.cookie, 'restore', backup);
  state.restored = checkDestination(restored);
  check(state.restored.xmlId !== state.source.xmlId && state.restored.matchedId !== state.source.matchedId,
    'La restauración reutilizó identificadores globales del origen');
  await saveState();
  pass('restauración completa remapea propiedad y vínculos, conserva pausa y no afirma validez SAT');

  const destinationParsed = parseBankCsv(bankCsv, {
    userId: destination.account.id, accountId: 'restore-test-bank',
  });
  check(destinationParsed.errors.length === 0 && destinationParsed.transactions.length === 2,
    'El CSV no pasó el parser bancario para la cuenta restaurada');
  const reimported = await writeAction(destination.cookie, {
    action: 'transactions', transactions: destinationParsed.transactions,
  });
  checkDestination(reimported);
  pass('reimportar el CSV original en el destino conserva dos movimientos, identificadores, vínculo y pausa');

  const destinationAfter = await getSnapshot(destination.cookie);
  await expectResponse(request('/api/workspace/restore', {cookie: destination.cookie, body: {action: 'restore', backup}}),
    409, 'Segunda restauración sobre destino ocupado');
  check(JSON.stringify(await getSnapshot(destination.cookie)) === JSON.stringify(destinationAfter),
    'La segunda restauración duplicó o alteró registros');
  pass('repetir la restauración devuelve conflicto y conserva exactamente los datos importados');

  await verifySaved(source.cookie, destination.cookie, firstXml);
  for (const account of [source, destination, foreign, blank]) await logout(account.cookie);
  pass('las cuatro sesiones sintéticas quedan cerradas e invalidadas');
  state.completed = true;
  state.completedAt = new Date().toISOString();
  await saveState();
  console.log('Estado privado guardado en la caché ignorada; listo para verificar persistencia después de reiniciar.');
}

try {
  await main();
  console.log(`Resultado: ${passed} comprobaciones HTTP de restauración aprobadas.`);
} catch (error) {
  const safeMessage = error instanceof VerificationError ? error.message :
    'No se pudo completar la verificación HTTP de restauración; revisa el entorno y el estado privado';
  // Native errors may contain response payloads, request bodies or private data.
  console.error(`FAIL tras ${passed} comprobaciones: ${safeMessage}`);
  process.exitCode = 1;
}
