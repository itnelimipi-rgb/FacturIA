import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FiscalDashboardPanel} from '../src/components/FiscalDashboardPanel';
import {CashFlowShield} from '../src/components/CashFlowShield';
import {loadedDateRange, summarizeInvoiceOrientation, summarizeLoadedMovements} from '../src/lib/dashboardPresentation';
import {MatchingEngineService} from '../src/lib/MatchingEngineService';
import type {BankTransaction, CfdiRecord} from '../src/lib/types';

const businessRfc = 'BBB010101BBB';
const transaction = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({id: 'movement-1', userId: 'user-1', accountId: 'account-1', amount: -116, currency: 'MXN', date: '2026-10-12', description: 'Pago a proveedor', status: 'discrepancia', ...overrides});
const document = (overrides: Partial<CfdiRecord> = {}): CfdiRecord => ({id: 'document-1', userId: 'user-1', uuidSat: '550E8400-E29B-41D4-A716-446655440001', rfcEmisor: 'AAA010101AAA', rfcReceptor: businessRfc, total: 116, subtotal: 100, iva: 16, retenciones: 0, fechaEmision: '2026-10-12T12:00:00', tipoComprobante: 'I', statusSat: 'no_verificado', isEfos: false, sourceType: 'xml', currency: 'MXN', ...overrides});
const panel = (cfdis: CfdiRecord[], transactions: BankTransaction[]) => renderToStaticMarkup(React.createElement(FiscalDashboardPanel, {cfdis, transactions, profileRfc: businessRfc, metrics: MatchingEngineService.calculateCashFlowShieldMetrics(transactions, cfdis), onGoToFacturas() {}}));

test('empty and document-only accounts do not present zero money as a bank balance or completed checks', () => {
  const metrics = MatchingEngineService.calculateCashFlowShieldMetrics([], []);
  const money = renderToStaticMarkup(React.createElement(CashFlowShield, {metrics, transactions: []}));
  assert.ok(money.includes('Aún no hay movimientos cargados'));
  assert.ok(!money.includes('MXN 0.00'));
  const empty = panel([], []);
  assert.ok(!empty.includes('0%'));
  assert.ok(!empty.includes('Los movimientos cargados tienen un documento vinculado'));
  const onlyDocuments = panel([document()], []);
  assert.ok(onlyDocuments.includes('documento ya está guardado'));
  assert.ok(onlyDocuments.includes('Facturas que recibiste (1)'));
  assert.ok(onlyDocuments.includes('Agregar movimientos'));
});

test('CFDI I orientation uses the profile RFC and keeps unknown, self-issued, provisional and cancelled documents honest', () => {
  const summary = summarizeInvoiceOrientation([
    document(), document({rfcEmisor: businessRfc, rfcReceptor: 'CCC010101CCC', total: 200}),
    document({rfcEmisor: 'XXX010101XXX', rfcReceptor: 'YYY010101YYY', total: 30}),
    document({rfcEmisor: businessRfc, total: 40}),
    document({sourceType: 'manual', total: 999}), document({statusSat: 'cancelado', total: 999}),
    document({tipoComprobante: 'E', total: 999}), document({tipoComprobante: 'P', currency: 'XXX', total: 0}),
  ], businessRfc.toLowerCase());
  assert.deepEqual(summary, {issued: [['MXN', 200]], received: [['MXN', 116]], unclassified: [['MXN', 70]], counts: {issued: 1, received: 1, unclassified: 2}});
  assert.deepEqual(summarizeInvoiceOrientation([document()]).counts, {issued: 0, received: 0, unclassified: 1});
});

test('loaded bank money separates currencies, balances cents exactly, and counts deposits apart from unlinked charges', () => {
  const summary = summarizeLoadedMovements([
    transaction({amount: 0.1, status: 'conciliado'}), transaction({amount: 0.2, status: 'conciliado'}), transaction({amount: -0.2, status: 'ambiguo'}),
    transaction({currency: 'USD', amount: 20}), transaction({currency: 'USD', amount: -8, status: 'conciliado'}),
  ]);
  assert.deepEqual(summary.totals, [{currency: 'MXN', incoming: 0.3, outgoing: 0.2, difference: 0.1, unlinkedOutgoing: 0.2, unlinkedOutgoingCount: 1}, {currency: 'USD', incoming: 20, outgoing: 8, difference: 12, unlinkedOutgoing: 0, unlinkedOutgoingCount: 0}]);
  assert.equal(summary.totalCount, 5);
  assert.equal(summary.linkedCount, 3);
  assert.equal(summary.ambiguousCount, 1);
  assert.equal(summary.withoutDocumentCount, 1);
});

test('paused searches are distinct from ordinary movements without a linked document', () => {
  const summary = summarizeLoadedMovements([transaction(), transaction({reconciliationLocked: true}), transaction({status: 'ambiguo'})]);
  assert.equal(summary.withoutDocumentCount, 1);
  assert.equal(summary.pausedCount, 1);
  assert.equal(summary.ambiguousCount, 1);
  const html = panel([], [transaction({reconciliationLocked: true})]);
  assert.ok(html.includes('búsqueda está pausada'));
  assert.ok(!html.includes('1 movimiento está sin documento vinculado'));
});

test('every loaded bank currency remains visible even when its code is not a familiar monetary currency', () => {
  assert.deepEqual(summarizeLoadedMovements([transaction({currency: 'XXX', amount: 10})]).totals, [{currency: 'XXX', incoming: 10, outgoing: 0, difference: 10, unlinkedOutgoing: 0, unlinkedOutgoingCount: 0}]);
});

test('movement-only and multiple currency views separate bank facts from missing invoice data', () => {
  const movements = [transaction({amount: 150}), transaction({currency: 'USD', amount: -20})];
  const html = panel([], movements);
  assert.ok(html.includes('Facturas que recibiste (0)'));
  assert.ok(html.includes('2 movimientos están sin documento vinculado'));
  const money = renderToStaticMarkup(React.createElement(CashFlowShield, {metrics: MatchingEngineService.calculateCashFlowShieldMetrics(movements, []), transactions: movements}));
  assert.ok(money.includes('Movimientos en MXN'));
  assert.ok(money.includes('Movimientos en USD'));
  assert.ok(money.includes('No es el saldo disponible de tu cuenta bancaria'));
  assert.ok(money.includes('1 movimiento pendiente de revisar o vincular'));
  assert.ok(!money.includes('2 movimientos pendientes de revisar o vincular'));
});

test('credit notes and payment declarations never net invoices or loaded bank amounts', () => {
  const records = [document(), document({tipoComprobante: 'E', total: 58}), document({tipoComprobante: 'P', currency: 'XXX', total: 0, paymentComplement: {version: '2.0', totalPaymentsMxn: '58', payments: []}})];
  assert.deepEqual(summarizeInvoiceOrientation(records, businessRfc).received, [['MXN', 116]]);
  assert.deepEqual(summarizeLoadedMovements([]).totals, []);
  const html = panel(records, []);
  assert.ok(html.includes('Notas de crédito (1)'));
  assert.ok(html.includes('Documentos de pagos (1)'));
  assert.ok(html.includes('no agrega movimientos del banco'));
});

test('loaded date bounds come from written dates, ignoring invalid days and maintaining time zone independence', () => {
  assert.deepEqual(loadedDateRange(['2026-10-12T23:59:00-06:00', '2026-09-01', '2026-02-31', 'invalid']), {from: '2026-09-01', to: '2026-10-12'});
  assert.equal(loadedDateRange([]), null);
});
