import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { POST as ingest } from '../src/app/api/ingest/route';
import { POST as matching } from '../src/app/api/matching/route';
import { POST as assistant } from '../src/app/api/assistant/route';
import { GET as health } from '../src/app/api/health/route';
import { GET as workspaceGet, POST as workspacePost } from '../src/app/api/workspace/route';
import { GET as authGet, POST as authPost } from '../src/app/api/auth/[...all]/route';
import { assertSameOrigin, errorResponse, HttpError, readJson } from '../src/server/http';
import { XmlCfdiParser } from '../src/lib/xmlParser';
import type { BankTransaction, CfdiRecord, Profile } from '../src/lib/types';

// The tests run in their own Node test process. Never connect to a configured database.
const environmentKeys = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'] as const;
const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
for (const key of environmentKeys) delete process.env[key];
after(() => {
  for (const key of environmentKeys) {
    const value = previousEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const baseUrl = 'http://localhost:3000';
const rawXml = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'sample-cfdi40.xml'), 'utf8');
const profile: Profile = {
  id: 'api-test-user', rfc: 'XAXX010101000', businessName: 'Empresa de pruebas', regimeCode: '601', createdAt: '2026-10-01T00:00:00Z',
};
const parsed = XmlCfdiParser.parse(rawXml, profile.id);
assert.ok(parsed.success && parsed.cfdi, parsed.error);
const document: CfdiRecord = parsed.cfdi;
const transaction: BankTransaction = {
  id: 'bank-test-1', userId: profile.id, accountId: 'test-account', amount: -116,
  currency: 'MXN', date: '2026-10-01', description: 'Pago a proveedor', status: 'discrepancia',
};
const snapshot = { profile, transactions: [transaction], cfdis: [document] };

function request(path: string, value: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${baseUrl}${path}`, {
    method: 'POST', headers: {'content-type': 'application/json', origin: baseUrl, ...headers}, body: JSON.stringify(value),
  });
}

test('ingest imports XML deterministically and reports unverified fiscal checks', async () => {
  const response = await ingest(request('/api/ingest', {rawXml}));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.source, 'xml');
  assert.equal(body.tokensConsumed, 0);
  assert.equal(body.cfdi.total, 116);
  assert.equal(body.cfdi.statusSat, 'no_verificado');
  assert.equal(body.deterministicValidation.coincideExacto, true);
  assert.deepEqual(body.checks, {sat: 'no_verificado', efos: 'no_verificado'});
});

test('ingest rejects arbitrary XML with an HTTP 400 result', async () => {
  const response = await ingest(request('/api/ingest', {rawXml: '<documento Total="116"/>'}));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /CFDI/);
});

test('ingest rejects an invalid Zod request without echoing the invalid input', async () => {
  const response = await ingest(request('/api/ingest', {rawXml: 116, privateValue: 'test-private-value'}));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'Datos inválidos');
  assert.ok(Array.isArray(body.details));
  assert.doesNotMatch(JSON.stringify(body), /test-private-value/);
});

test('ingest rejects malformed JSON and unsupported body formats', async () => {
  const malformed = await ingest(new Request(`${baseUrl}/api/ingest`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{'}));
  assert.equal(malformed.status, 400);
  const plainText = await ingest(request('/api/ingest', {rawXml}, {'content-type': 'text/plain'}));
  assert.equal(plainText.status, 415);
});

test('ingest enforces declared request size before parsing any XML', async () => {
  const response = await ingest(request('/api/ingest', {rawXml}, {'content-length': '3000001'}));
  assert.equal(response.status, 413);
});

test('matching route evaluates actual imported CFDI and reports contextual fiscal impact zero', async () => {
  const response = await matching(request('/api/matching', snapshot));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.transactions[0].status, 'conciliado');
  assert.equal(body.transactions[0].matchedCfdiId, document.id);
  assert.match(body.transactions[0].alertReason, /SAT.*no está verificado/);
  assert.equal(body.metrics.totalExpense, 116);
  assert.equal(body.metrics.totalBankBalance, -116);
  assert.equal(body.metrics.nonDeductibleImpactEstimated, 0);
});

test('matching an unreceipted expense does not invent a percentage or tax saving', async () => {
  const response = await matching(request('/api/matching', {...snapshot, cfdis: []}));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.transactions[0].status, 'discrepancia');
  assert.equal(body.metrics.nonDeductibleExpenseDiscrepancies, 116);
  assert.equal(body.metrics.nonDeductibleImpactEstimated, 0);
  assert.equal(body.metrics.projectedRetentionsResico, 0);
});

test('matching rejects data owned by another profile before evaluating it', async () => {
  const response = await matching(request('/api/matching', {...snapshot, transactions: [{...transaction, userId: 'someone-else'}]}));
  assert.equal(response.status, 400);
  assert.match(JSON.stringify(await response.json()), /perfil activo/);
});

test('matching rejects invalid money or missing profile through the request schema', async () => {
  const invalidAmount = await matching(request('/api/matching', {...snapshot, transactions: [{...transaction, amount: '116'}]}));
  assert.equal(invalidAmount.status, 400);
  const missingProfile = await matching(request('/api/matching', {transactions: [], cfdis: []}));
  assert.equal(missingProfile.status, 400);
});

test('assistant answers using current records and labels its rules honestly', async () => {
  const response = await assistant(request('/api/assistant', {message: 'Dame el saldo del banco', mode: 'demo', snapshot}));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.mode, 'rules');
  assert.equal(body.generatedByAI, false);
  assert.match(body.reply, /116/);
  assert.match(body.reply, /no sustituye el saldo/);
});

test('assistant refuses to fabricate fiscal savings or a live SAT check', async () => {
  const response = await assistant(request('/api/assistant', {message: 'Cuánto ahorro en ISR', mode: 'demo', snapshot}));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.generatedByAI, false);
  assert.match(body.reply, /no están activadas/);
  assert.match(body.reply, /porcentajes simulados/);
});

test('assistant requires a demo snapshot and validates its request', async () => {
  const missingSnapshot = await assistant(request('/api/assistant', {message: 'Hola', mode: 'demo'}));
  assert.equal(missingSnapshot.status, 400);
  const emptyMessage = await assistant(request('/api/assistant', {message: '   ', mode: 'demo', snapshot}));
  assert.equal(emptyMessage.status, 400);
  const overlong = await assistant(request('/api/assistant', {message: 'x'.repeat(2001), mode: 'demo', snapshot}));
  assert.equal(overlong.status, 400);
});

test('health succeeds in demo mode with PostgreSQL intentionally unconfigured', async () => {
  const response = await health();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {status: 'ok', mode: 'demo', workspace: 'not_configured'});
});

test('workspace read/write and workspace assistant remain unavailable without configuration', async () => {
  const read = await workspaceGet(new Request(`${baseUrl}/api/workspace`));
  assert.equal(read.status, 503);
  const write = await workspacePost(request('/api/workspace', {action: 'profile', profile: {}}));
  assert.equal(write.status, 503);
  const reply = await assistant(request('/api/assistant', {message: 'Hola', mode: 'workspace'}));
  assert.equal(reply.status, 503);
});

test('auth handlers return unavailable without creating external sessions', async () => {
  const get = await authGet(new Request(`${baseUrl}/api/auth/get-session`));
  const post = await authPost(request('/api/auth/sign-in/email', {email: 'test@example.invalid', password: 'test-password-never-sent'}));
  assert.equal(get.status, 503);
  assert.equal(post.status, 503);
});

test('readJson permits a valid JSON body with a charset parameter', async () => {
  const input = request('/test', {value: 'é'}, {'content-type': 'application/json; charset=utf-8'});
  assert.deepEqual(await readJson(input), {value: 'é'});
});

for (const contentType of ['text/plain', 'application/jsonp', 'text/plain; parameter=application/json']) {
  test(`readJson rejects the unsupported media type ${contentType}`, async () => {
    await assert.rejects(readJson(request('/test', {}, {'content-type': contentType})), (error: unknown) => error instanceof HttpError && error.status === 415);
  });
}

test('readJson rejects missing body and invalid JSON with 400', async () => {
  await assert.rejects(readJson(new Request(`${baseUrl}/test`, {method: 'POST', headers: {'content-type': 'application/json'}})), (error: unknown) => error instanceof HttpError && error.status === 400);
  await assert.rejects(readJson(new Request(`${baseUrl}/test`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{no}'})), (error: unknown) => error instanceof HttpError && error.status === 400);
});

test('readJson enforces actual UTF-8 byte count and permits a body exactly at the limit', async () => {
  const payload = {name: 'é'};
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  assert.deepEqual(await readJson(request('/test', payload), bytes), payload);
  await assert.rejects(readJson(request('/test', payload), bytes - 1), (error: unknown) => error instanceof HttpError && error.status === 413);
  await assert.rejects(readJson(request('/test', payload, {'content-length': String(bytes + 1)}), bytes), (error: unknown) => error instanceof HttpError && error.status === 413);
});

test('readJson stops an oversized streamed body even without a content-length header', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from('{"value":'));
      controller.enqueue(Buffer.from('"too-long"}'));
      controller.close();
    },
  });
  const input = new Request(`${baseUrl}/test`, {method: 'POST', headers: {'content-type': 'application/json'}, body: stream, duplex: 'half'} as RequestInit & {duplex: 'half'});
  await assert.rejects(readJson(input, 10), (error: unknown) => error instanceof HttpError && error.status === 413);
});

test('workspace mutation rejects missing or different origin', async () => {
  const noOrigin = new Request(`${baseUrl}/api/workspace`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
  assert.equal((await workspacePost(noOrigin)).status, 403);
  assert.equal((await workspacePost(request('/api/workspace', {}, {origin: 'https://foreign.example.invalid'}))).status, 403);
  assert.doesNotThrow(() => assertSameOrigin(request('/api/workspace', {})));
});

test('errorResponse exposes a controlled message for HTTP, Zod, and duplicate records', async () => {
  const forbidden = errorResponse(new HttpError(403, 'Acceso denegado'));
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), {error: 'Acceso denegado'});
  const validation = z.object({required: z.string()}).safeParse({});
  assert.equal(validation.success, false);
  if (!validation.success) assert.equal(errorResponse(validation.error).status, 400);
  const duplicate = errorResponse({code: '23505', detail: 'private database detail'});
  assert.equal(duplicate.status, 409);
  assert.doesNotMatch(JSON.stringify(await duplicate.json()), /private database detail/);
});

test('errorResponse never leaks an internal error or credential-like value', async () => {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...values: unknown[]) => { logged.push(values); };
  try {
    const response = errorResponse(new Error('postgres://private-secret@example.invalid/database'));
    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private-secret/);
    assert.doesNotMatch(JSON.stringify(logged), /private-secret/);
  } finally { console.error = original; }
});
