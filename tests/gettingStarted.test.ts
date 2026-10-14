import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {getGettingStartedState} from '../src/lib/gettingStarted';
import {GettingStarted} from '../src/components/GettingStarted';
import {SEED_CFDIS, SEED_TRANSACTIONS, SEED_PROFILE} from '../src/lib/seed';
import {MatchingEngineService} from '../src/lib/MatchingEngineService';

const movements = MatchingEngineService.evaluateBatch(SEED_TRANSACTIONS, SEED_CFDIS, SEED_PROFILE);
const render = (transactions = movements, documents = SEED_CFDIS) => renderToStaticMarkup(React.createElement(GettingStarted, {transactions, documents, demoMode: false, onAddDocuments: () => {}, onAddMovements: () => {}, onReview: () => {}}));

test('empty workspace offers both first actions and never presents zero pending as everything checked', () => {
  const state = getGettingStartedState([], []);
  assert.equal(state.transactionCount, 0); assert.equal(state.documentCount, 0);
  const html = render([], []);
  assert.ok(html.includes('Agregar documentos') && html.includes('Agregar movimientos'));
  assert.ok(!html.includes('Revisar los documentos vinculados'));
  assert.ok(!html.includes('tienen un documento vinculado'));
});
test('guide uses actual evaluated demo states and exposes two distinct review actions', () => {
  const state = getGettingStartedState(movements, SEED_CFDIS);
  assert.equal(state.matched, 3); assert.equal(state.review, 1); assert.equal(state.unlinked, 1);
  const html = render();
  assert.ok(html.includes('Revisar 1 coincidencia') && html.includes('Ver 1 sin documento vinculado'));
});
test('documents alone never imply bank movements or a linked completion', () => {
  const state = getGettingStartedState([], SEED_CFDIS);
  assert.equal(state.matched, 0); assert.equal(state.transactionCount, 0);
  assert.ok(render([], SEED_CFDIS).includes('Puedes agregar los movimientos del banco'));
  assert.ok(!render([], SEED_CFDIS).includes('Revisar los documentos vinculados'));
});
test('manual records and payment metadata alone do not count as invoices for bank matching', () => {
  const onlyManualAndPayment = [ {...SEED_CFDIS[0], sourceType: 'manual' as const, uuidSat: ''}, {...SEED_CFDIS[1], tipoComprobante: 'P' as const, total: 0, currency: 'XXX'} ];
  assert.equal(getGettingStartedState(movements, onlyManualAndPayment).invoices, 0);
  assert.ok(render(movements, onlyManualAndPayment).includes('necesitas facturas XML'));
});
test('all linked is explicitly documentary and never claims a SAT response or a bank balance', () => {
  const linked = movements.filter(item => item.status === 'conciliado');
  const html = render(linked);
  assert.ok(html.includes('todavía puede necesitar revisión'));
  assert.ok(!html.includes('saldo disponible') && !html.includes('SAT confirmó'));
});
test('cancelled invoice cannot satisfy the guide request for an invoice used in matching', () => {
  const cancelled = [{...SEED_CFDIS[0], statusSat: 'cancelado' as const}];
  assert.equal(getGettingStartedState(movements, cancelled).invoices, 0);
  assert.ok(render(movements, cancelled).includes('necesitas facturas XML'));
});
