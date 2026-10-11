import assert from 'node:assert/strict';
import {test} from 'node:test';
import {acquireSatQuery, parseSatResponse, querySatStatus, satExpression, SAT_RESPONSE_MAX_BYTES, SAT_SERVICE_URL, SatResponseError} from '../src/server/satStatus';
import {HttpError} from '../src/server/http';

const document = {uuidSat: '12345678-ABCD-4321-8ABC-123456789ABC', rfcEmisor: 'AAA010101AAA', rfcReceptor: 'XAXX010101000', total: 116};
const checkedAt = '2026-10-11T00:00:00.000Z';
const namespace = 'http://schemas.datacontract.org/2004/07/Sat.Cfdi.Negocio.ConsultaCfdi.Servicio';
function reply({code = 'S - Comprobante obtenido satisfactoriamente.', state = 'Vigente', efos = '200'} = {}) {
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><ConsultaResponse xmlns="http://tempuri.org/"><ConsultaResult xmlns:a="${namespace}" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><a:CodigoEstatus>${code}</a:CodigoEstatus><a:EsCancelable>Cancelable con aceptación</a:EsCancelable><a:Estado>${state}</a:Estado><a:EstatusCancelacion i:nil="true"/><a:ValidacionEFOS>${efos}</a:ValidacionEFOS></ConsultaResult></ConsultaResponse></s:Body></s:Envelope>`;
}
const hasStatus = (status: number) => (error: unknown) => error instanceof HttpError && error.status === status;
const transport = (body: string, status = 200, headers: Record<string, string> = {'content-type': 'text/xml; charset=UTF-8'}) => (async () => new Response(body, {status, headers})) as typeof fetch;

test('SAT expression uses canonical UUID, RFCs and a decimal total without insignificant zeroes', () => {
  assert.equal(satExpression(document), '?re=AAA010101AAA&rr=XAXX010101000&tt=116.0&id=12345678-ABCD-4321-8ABC-123456789ABC');
  for (const [total, expected] of [[0, '0.0'], [0.99, '0.99'], [1.2, '1.2'], [10000000000, '10000000000.0']] as const) {
    assert.ok(satExpression({...document, total}).includes(`&tt=${expected}&`));
  }
  for (const invalid of [{uuidSat: 'javascript:alert(1)'}, {rfcEmisor: 'AAA&<fake>'}, {total: NaN}, {total: -1}, {total: 0.001}]) {
    assert.throws(() => satExpression({...document, ...invalid}), hasStatus(409));
  }
  assert.ok(satExpression({...document, rfcEmisor: 'AA&010101AAA'}).includes('?re=AA%26010101AAA&rr='));
});

test('official SAT success preserves date, state, EFOS and cancellation details', () => {
  assert.deepEqual(parseSatResponse(reply(), checkedAt), {
    source: 'sat', checkedAt, outcome: 'found', status: 'vigente', code: 'S', efos: 'not_listed', cancelability: 'Cancelable con aceptación',
  });
  const cancelled = parseSatResponse(reply({state: 'Cancelado', efos: '100'}), checkedAt);
  assert.equal(cancelled.status, 'cancelado');
  assert.equal(cancelled.efos, 'listed');
  assert.equal(parseSatResponse(reply({efos: 'unrecognized'}), checkedAt).efos, 'unknown');
});

test('official rejection codes never become a current or EFOS confirmation', () => {
  for (const [code, expected] of [['N - 601: La expresión impresa proporcionada no es válida.', 'invalid_query'], ['N - 602: Comprobante no encontrado.', 'not_found']] as const) {
    const result = parseSatResponse(reply({code, state: 'No Encontrado', efos: '100'}), checkedAt);
    assert.equal(result.outcome, expected);
    assert.equal(result.status, 'no_verificado');
    assert.equal(result.efos, 'unknown');
  }
});

test('SOAP namespaces, nested result and response codes are required before accepting fiscal status', () => {
  const invalid = [
    reply().replace('http://schemas.xmlsoap.org/soap/envelope/', 'https://untrusted.example/envelope'),
    reply().replace('http://tempuri.org/', 'https://untrusted.example/service'),
    reply().replace(namespace, 'https://untrusted.example/result'),
    reply({code: 'Anything', state: 'Vigente'}),
    reply({code: 'S', state: 'unknown'}),
    reply().replace('<a:Estado>Vigente</a:Estado>', '<a:Estado>Vigente</a:Estado><a:Estado>Cancelado</a:Estado>'),
    reply().replace('<a:Estado>Vigente</a:Estado>', '<a:Estado><a:Nested>Vigente</a:Nested></a:Estado>'),
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultstring>Vigente</faultstring></s:Fault></s:Body></s:Envelope>',
    reply().replace('<s:Body>', '<s:Body><s:Fault><faultstring>Failure</faultstring></s:Fault>'),
  ];
  for (const xml of invalid) assert.throws(() => parseSatResponse(xml), SatResponseError);
});

test('SAT response refuses DTD, unknown entities, duplicate results and oversized payloads', () => {
  for (const xml of [
    '<!DOCTYPE x [<!ENTITY entity SYSTEM "file:///private">]>' + reply(),
    reply().replace('Vigente', '&entity;'),
    reply().replace('</ConsultaResult>', '</ConsultaResult><ConsultaResult/>'),
    reply().replace('Vigente', 'a'.repeat(101)),
    'x'.repeat(SAT_RESPONSE_MAX_BYTES + 1),
  ]) assert.throws(() => parseSatResponse(xml), SatResponseError);
});

test('SAT transport uses one fixed HTTPS destination, escaped XML, no redirects and correct SOAPAction', async () => {
  let captured: RequestInit | undefined;
  const fetcher = (async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(url, SAT_SERVICE_URL); captured = options;
    return new Response(reply(), {headers: {'content-type': 'text/xml; charset=utf-8'}});
  }) as typeof fetch;
  const result = await querySatStatus({...document, rfcEmisor: 'AA&010101AAA'}, fetcher);
  assert.equal(result.status, 'vigente');
  assert.equal(captured?.method, 'POST');
  assert.equal(captured?.redirect, 'error');
  assert.equal(captured?.cache, 'no-store');
  assert.ok((captured?.headers as Record<string, string>).SOAPAction.includes('IConsultaCFDIService/Consulta'));
  assert.ok(String(captured?.body).includes('?re=AA%26010101AAA&amp;rr='));
  assert.ok(captured?.signal instanceof AbortSignal);
});

test('network errors, redirects, SOAP faults and invalid MIME responses fail closed with dated unavailable results', async () => {
  const failing = (async () => { throw new Error('secret raw network detail'); }) as typeof fetch;
  for (const fetcher of [failing, transport(reply(), 500), transport(reply(), 302), transport(reply(), 200, {'content-type': 'text/html'}), transport('<invalid/>')]) {
    const result = await querySatStatus(document, fetcher);
    assert.equal(result.outcome, 'unavailable');
    assert.equal(result.status, 'no_verificado');
    assert.equal(result.efos, 'unknown');
    assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});

test('real streamed byte limit applies when Content-Length is absent and UTF-8 decoding is strict', async () => {
  for (const fetcher of [
    transport('x'.repeat(SAT_RESPONSE_MAX_BYTES + 1)),
    transport(reply(), 200, {'content-type': 'text/xml', 'content-length': String(SAT_RESPONSE_MAX_BYTES + 1)}),
    (async () => new Response(Uint8Array.from([0xC3, 0x28]), {headers: {'content-type': 'text/xml'}})) as typeof fetch,
  ]) assert.equal((await querySatStatus(document, fetcher)).outcome, 'unavailable');
});

test('process guard caps concurrent requests, repeated documents and requests per account', () => {
  const now = 10_000_000;
  const releases = Array.from({length: 4}, (_, index) => acquireSatQuery(`parallel-${index}`, 'doc', now));
  assert.throws(() => acquireSatQuery('parallel-overflow', 'doc', now), hasStatus(429));
  releases.forEach(release => {release(); release();});
  assert.throws(() => acquireSatQuery('parallel-0', 'doc', now + 1), hasStatus(429));
  acquireSatQuery('parallel-0', 'doc', now + 60_000)();
  for (let index = 0; index < 6; index++) acquireSatQuery('account-limited', `doc-${index}`, now + 60_000)();
  assert.throws(() => acquireSatQuery('account-limited', 'doc-6', now + 60_001), hasStatus(429));
});
