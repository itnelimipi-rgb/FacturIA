import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assistantReply} from '../src/lib/assistantService';
import {MatchingEngineService} from '../src/lib/MatchingEngineService';
import {summarizeLoadedMovements} from '../src/lib/dashboardPresentation';
import {SEED_TRANSACTIONS} from '../src/lib/seed';

const transactions = [{...SEED_TRANSACTIONS[0], id: 'review', amount: -100, status: 'ambiguo' as const}, {...SEED_TRANSACTIONS[0], id: 'missing', amount: -50, status: 'discrepancia' as const}];
const metrics = MatchingEngineService.calculateCashFlowShieldMetrics(transactions, []);

test('plain new action questions get procedures without pretending they changed the account', () => {
  const cases: [string, RegExp, RegExp][] = [
    ['¿Cómo anoto un gasto sin factura?', /anotación provisional/, /en Documentos usa «Anotar gasto sin factura»/],
    ['¿Cómo agrego mis documentos?', /varios a la vez/, /^Usa «Subir archivos»/],
    ['¿Cómo quito un vínculo?', /No borra el movimiento ni la factura/, /^En Movimientos, busca el movimiento y pulsa «Quitar»/],
    ['¿Cómo vuelvo a buscar?', /no garantiza que encuentre una que coincida/, /pulsa «Volver a buscar»/],
  ];
  for (const [question, needed, destination] of cases) {
    const reply = assistantReply(question, metrics);
    assert.match(reply, needed as RegExp);
    assert.match(reply, destination);
    assert.doesNotMatch(reply, /Movimientos y documentos/);
    assert.doesNotMatch(reply, /Hay \d|Tienes \d|\$|ya se guardó|ya se quitó/i);
  }
});

test('how-to questions about uploads get a guide instead of an unrelated account summary', () => {
  for (const [question, expected] of [
    ['¿Cómo subo mi estado de cuenta?', /súbelo con «Subir archivos»/],
    ['¿Dónde subo una foto de un ticket?', /PDF o la foto del ticket/],
    ['¿Qué significa «Elige la factura»?', /debes decidir/],
  ] as const) {
    const reply = assistantReply(question, metrics);
    assert.match(reply, expected);
    assert.doesNotMatch(reply, /Tienes \d|\$\d/);
  }
});

test('mixed questions cannot use a procedure to bypass factual or fiscal boundaries', () => {
  const factual = assistantReply('¿Cómo quito un vínculo y dame el saldo?', metrics);
  assert.match(factual, /diferencia es -\$150\.00/);
  assert.doesNotMatch(factual, /pulsa «Quitar»/);
  const fiscal = assistantReply('¿Cómo anoto un gasto sin factura y lo deduzco?', metrics);
  assert.match(fiscal, /revisión contable/);
  assert.doesNotMatch(fiscal, /Anotar gasto sin factura/);
});

test('assistant identifies its unlinked subset while the bank overview includes all pending links', () => {
  const overview = summarizeLoadedMovements(transactions);
  assert.equal(overview.totals[0].unlinkedOutgoing, 150);
  assert.equal(metrics.nonDeductibleExpenseDiscrepancies, 50);
  const reply = assistantReply('¿Qué necesita mi atención?', metrics);
  assert.match(reply, /1 movimiento\(s\) sin factura y 1 donde debes elegir la factura/);
  assert.match(reply, /\$50\.00/);
  assert.match(reply, /se cuentan aparte/);
  assert.match(reply, /Resuélvelos desde Inicio o Movimientos/);
  assert.doesNotMatch(reply, /rechazado|no deducible/);
});
