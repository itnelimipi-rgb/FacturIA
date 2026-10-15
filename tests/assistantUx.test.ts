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
    ['¿Cómo anoto un gasto sin factura?', /anotación provisional/, /^En Documentos usa Anotar un gasto sin factura/],
    ['¿Cómo agrego mis documentos?', /Agregar documentos/, /abre Documentos/],
    ['¿Cómo quito un vínculo?', /No borra el movimiento ni el documento/, /en Movimientos y usa Quitar vínculo/],
    ['¿Cómo vuelvo a buscar?', /no garantiza que encuentre uno compatible/, /en Movimientos y usa Volver a buscar/],
  ];
  for (const [question, needed, destination] of cases) {
    const reply = assistantReply(question, metrics);
    assert.match(reply, needed as RegExp);
    assert.match(reply, destination);
    assert.doesNotMatch(reply, /Movimientos y documentos/);
    assert.doesNotMatch(reply, /Hay \d|Tienes \d|\$|ya se guardó|ya se quitó/i);
  }
});
test('mixed questions cannot use a procedure to bypass factual or fiscal boundaries', () => {
  const factual = assistantReply('¿Cómo quito un vínculo y dame el saldo?', metrics);
  assert.match(factual, /diferencia es -\$150\.00/);
  assert.doesNotMatch(factual, /usa Quitar vínculo/);
  const fiscal = assistantReply('¿Cómo anoto un gasto sin factura y lo deduzco?', metrics);
  assert.match(fiscal, /revisión contable/);
  assert.doesNotMatch(fiscal, /usa Anotar un gasto/);
});
test('assistant identifies its unlinked subset while the bank overview includes all pending links', () => {
  const overview = summarizeLoadedMovements(transactions);
  assert.equal(overview.totals[0].unlinkedOutgoing, 150);
  assert.equal(metrics.nonDeductibleExpenseDiscrepancies, 50);
  const reply = assistantReply('¿Qué necesita mi atención?', metrics);
  assert.match(reply, /estado «Sin documento vinculado»/);
  assert.match(reply, /\$50\.00/);
  assert.match(reply, /coincidencias por revisar se cuentan aparte/);
  assert.match(reply, /Abre Movimientos para revisar/);
  assert.doesNotMatch(reply, /rechazado|no deducible/);
});
