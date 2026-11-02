import assert from 'node:assert/strict';
import {test} from 'node:test';
import {aiConfigured, aiModel, answerWithAi, extractReceipt, type MessagesClient} from '../src/server/ai';
import {HttpError} from '../src/server/http';
import {POST as extract} from '../src/app/api/ai/extract/route';
import {GET as features} from '../src/app/api/account/features/route';
import {buildAssistantContext} from '../src/lib/assistantContext';
import {SEED_CFDIS, SEED_PROFILE, SEED_TRANSACTIONS} from '../src/lib/seed';

async function withEnvironment(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { await run(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

type Recorded = {model: string; system?: string; output_config?: {effort?: string}; messages: Array<{role: string; content: string | Array<{type: string; source?: {media_type?: string}}>}>};
function recordingClient(response: unknown) {
  const calls: Recorded[] = [];
  const respond = async (body: Recorded) => { calls.push(body); return response; };
  return {calls, client: {messages: {parse: respond, create: respond}} as unknown as MessagesClient};
}

test('AI stays off without a server key, and the extraction route refuses before reading any file', async () => {
  await withEnvironment({ANTHROPIC_API_KEY: undefined}, async () => {
    assert.equal(aiConfigured(), false);
    const response = await extract(new Request('http://localhost:3000/api/ai/extract', {method: 'POST', headers: {origin: 'http://localhost:3000', 'content-type': 'multipart/form-data; boundary=x'}, body: 'x'}));
    assert.equal(response.status, 404);
    assert.equal((await features().json()).aiEnabled, false);
  });
  await withEnvironment({ANTHROPIC_API_KEY: 'test-key-not-real'}, async () => {
    assert.equal(aiConfigured(), true);
    assert.equal((await features().json()).aiEnabled, true);
    const foreign = await extract(new Request('http://localhost:3000/api/ai/extract', {method: 'POST', headers: {origin: 'https://other.example', 'content-type': 'multipart/form-data; boundary=x'}, body: 'x'}));
    assert.equal(foreign.status, 403);
  });
});

test('Haiku is the default model and only Haiku or Sonnet models can be configured', async () => {
  await withEnvironment({FACTURIA_AI_MODEL: undefined}, async () => assert.equal(aiModel(), 'claude-haiku-5-5'));
  await withEnvironment({FACTURIA_AI_MODEL: 'claude-sonnet-5-5'}, async () => assert.equal(aiModel(), 'claude-sonnet-5-5'));
  await withEnvironment({FACTURIA_AI_MODEL: 'claude-opus-5-5'}, async () => assert.equal(aiModel(), 'claude-haiku-5-5'));
  await withEnvironment({FACTURIA_AI_MODEL: 'otro-modelo'}, async () => assert.equal(aiModel(), 'claude-haiku-5-5'));
});

test('receipt extraction sends the original file and keeps only verifiable suggestions', async () => {
  const {calls, client} = recordingClient({stop_reason: 'end_turn', parsed_output: {
    esComprobante: true, proveedor: ' Cafetería Sintética ', rfcProveedor: 'CAF-010101-AA1', fecha: '2026-10-08', moneda: 'MXN',
    subtotal: '50', iva: '8.00', retenciones: '', total: '$58.00', concepto: 'Café y pan',
  }});
  const result = await extractReceipt({bytes: new TextEncoder().encode('%PDF-1.4'), mediaType: 'application/pdf'}, {rfc: 'XAXX010101000', name: 'Negocio'}, client);
  assert.equal(calls[0].model, 'claude-haiku-5-5');
  assert.equal(calls[0].output_config?.effort, 'low');
  const content = calls[0].messages[0].content as Array<{type: string}>;
  assert.equal(content[0].type, 'document');
  assert.deepEqual(result.draft, {rfcEmisor: 'CAF010101AA1', nombreEmisor: 'Cafetería Sintética', fechaEmision: '2026-10-08', subtotal: '50.00', iva: '8.00', retenciones: '', currency: 'MXN'});
  assert.equal(result.total, '58.00');
  assert.equal(result.concept, 'Café y pan');
  assert.equal(result.isReceipt, true);
});

test('receipt extraction drops the customer RFC, impossible dates, percentages and foreign currencies', async () => {
  const {calls, client} = recordingClient({stop_reason: 'end_turn', parsed_output: {
    esComprobante: false, proveedor: '', rfcProveedor: 'XAXX010101000', fecha: '2026-02-30', moneda: 'USD',
    subtotal: '1.234,50', iva: '16%', retenciones: '0', total: 'abc', concepto: '',
  }});
  const result = await extractReceipt({bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png'}, {rfc: 'XAXX010101000', name: 'Negocio'}, client);
  const content = calls[0].messages[0].content as Array<{type: string; source?: {media_type?: string}}>;
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source?.media_type, 'image/png');
  assert.deepEqual(result.draft, {rfcEmisor: '', nombreEmisor: '', fechaEmision: '', subtotal: '1234.50', iva: '', retenciones: '0.00', currency: ''});
  assert.equal(result.total, '');
  assert.equal(result.foreignCurrency, 'USD');
  assert.equal(result.isReceipt, false);
});

test('a refused or unreadable extraction becomes a controlled error instead of invented fields', async () => {
  const refused = recordingClient({stop_reason: 'refusal', parsed_output: null});
  await assert.rejects(extractReceipt({bytes: new Uint8Array([1]), mediaType: 'image/jpeg'}, {rfc: 'XAXX010101000', name: 'Negocio'}, refused.client), (error: unknown) => error instanceof HttpError && error.status === 422);
  const empty = recordingClient({stop_reason: 'end_turn', parsed_output: null});
  await assert.rejects(extractReceipt({bytes: new Uint8Array([1]), mediaType: 'image/jpeg'}, {rfc: 'XAXX010101000', name: 'Negocio'}, empty.client), (error: unknown) => error instanceof HttpError && error.status === 502);
});

test('assistant answers start with the person, carry the computed facts and keep fiscal limits in the instructions', async () => {
  const {calls, client} = recordingClient({stop_reason: 'end_turn', content: [{type: 'text', text: 'Tienes 2 movimientos pendientes.'}]});
  const reply = await answerWithAi('¿Qué tengo pendiente?', [{role: 'assistant', text: 'Hola'}, {role: 'user', text: 'Antes'}, {role: 'assistant', text: 'Respuesta'}], {pendientes: 2}, client);
  assert.equal(reply, 'Tienes 2 movimientos pendientes.');
  assert.equal(calls[0].messages[0].role, 'user');
  assert.match(String(calls[0].messages.at(-1)?.content), /"pendientes":2/);
  assert.match(calls[0].system ?? '', /No determines deducciones/);
  assert.match(calls[0].system ?? '', /no es una confirmación del SAT/);
  const refused = recordingClient({stop_reason: 'refusal', content: []});
  assert.match(await answerWithAi('Pregunta', [], {}, refused.client), /No puedo ayudarte con esa pregunta/);
});

test('assistant context includes only the account records, without original XML, and explains each pending movement', () => {
  const foreignMovement = {...SEED_TRANSACTIONS[0], id: 'foreign', userId: 'another-user', description: 'Movimiento de otra cuenta'};
  const context = buildAssistantContext({
    profile: SEED_PROFILE,
    transactions: [...SEED_TRANSACTIONS, foreignMovement],
    cfdis: SEED_CFDIS.map(record => ({...record, rawXml: '<secreto/>'})),
  });
  const json = JSON.stringify(context);
  assert.doesNotMatch(json, /<secreto\/>|Movimiento de otra cuenta/);
  assert.equal(context.movimientos.cargados, SEED_TRANSACTIONS.length);
  assert.equal(context.pendientes.length, 2);
  assert.ok(context.pendientes.every(item => item.estado && item.motivo));
  assert.match(context.nota, /no es el saldo del banco/);
});
