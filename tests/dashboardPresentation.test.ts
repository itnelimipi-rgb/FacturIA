import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {HomeOverview} from '../src/components/HomeOverview';
import {loadedDateRange, summarizeInvoiceOrientation, summarizeLoadedMovements} from '../src/lib/dashboardPresentation';
import type {BankTransaction, CfdiRecord} from '../src/lib/types';

const businessRfc = 'BBB010101BBB';
const transaction = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({id: 'movement-1', userId: 'user-1', accountId: 'account-1', amount: -116, currency: 'MXN', date: '2026-10-12', description: 'Pago a proveedor', status: 'discrepancia', ...overrides});
const document = (overrides: Partial<CfdiRecord> = {}): CfdiRecord => ({id: 'document-1', userId: 'user-1', uuidSat: '550E8400-E29B-41D4-A716-446655440001', rfcEmisor: 'AAA010101AAA', rfcReceptor: businessRfc, total: 116, subtotal: 100, iva: 16, retenciones: 0, fechaEmision: '2026-10-12T12:00:00', tipoComprobante: 'I', statusSat: 'no_verificado', isEfos: false, sourceType: 'xml', currency: 'MXN', ...overrides});
const home = (documents: CfdiRecord[], transactions: BankTransaction[]) => renderToStaticMarkup(React.createElement(HomeOverview, {
  transactions, documents, profileRfc: businessRfc, businessName: 'Negocio de prueba', demoMode: false,
  onUpload() {}, onChoose() {}, onUploadFor() {}, onResume() {}, onShowMovements() {}, onShowDocuments() {},
}));

test('empty and document-only accounts do not present zero money as a bank balance or completed checks', () => {
  const empty = home([], []);
  assert.match(empty, /Subir archivos/);
  assert.doesNotMatch(empty, /\$0\.00|Todo al día|Con factura/);
  const onlyDocuments = home([document()], []);
  assert.match(onlyDocuments, /Falta tu estado de cuenta/);
  assert.match(onlyDocuments, /Recibidas \(compras\) · 1/);
  assert.match(onlyDocuments, /Subir estado de cuenta/);
  assert.doesNotMatch(onlyDocuments, /Entró|Salió|Todos tus movimientos tienen factura/);
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
  const html = home([document({id: 'unrelated', total: 5})], [transaction({reconciliationLocked: true})]);
  assert.match(html, /búsqueda automática está pausada/);
  assert.match(html, /Volver a buscar/);
  assert.doesNotMatch(html, /Subir factura/);
});

test('every loaded bank currency remains visible even when its code is not a familiar monetary currency', () => {
  assert.deepEqual(summarizeLoadedMovements([transaction({currency: 'XXX', amount: 10})]).totals, [{currency: 'XXX', incoming: 10, outgoing: 0, difference: 10, unlinkedOutgoing: 0, unlinkedOutgoingCount: 0}]);
});

test('movement-only and multiple currency views separate bank facts from missing invoice data', () => {
  const html = home([], [transaction({amount: 150}), transaction({id: 'movement-2', currency: 'USD', amount: -20})]);
  assert.match(html, /Faltan tus facturas/);
  assert.match(html, /\$150\.00/);
  assert.match(html, /USD/);
  assert.match(html, /Cada moneda se suma por separado/);
  assert.match(html, /no es el saldo de tu banco/);
  assert.match(html, /0 <span[^>]*>de 2<\/span>/);
});

test('credit notes and payment declarations never net invoices or loaded bank amounts', () => {
  const records = [document(), document({id: 'credit', tipoComprobante: 'E', total: 58}), document({id: 'payment', tipoComprobante: 'P', currency: 'XXX', total: 0, paymentComplement: {version: '2.0', totalPaymentsMxn: '58', payments: []}})];
  assert.deepEqual(summarizeInvoiceOrientation(records, businessRfc).received, [['MXN', 116]]);
  assert.deepEqual(summarizeLoadedMovements([]).totals, []);
  const html = home(records, []);
  assert.match(html, /1 nota de crédito/);
  assert.match(html, /1 comprobante de pago/);
  assert.match(html, /no cambian estos totales/);
  assert.match(html, /\$116\.00/);
  assert.doesNotMatch(html, /\$174\.00|\$58\.00/);
});

test('loaded date bounds come from written dates, ignoring invalid days and maintaining time zone independence', () => {
  assert.deepEqual(loadedDateRange(['2026-10-12T23:59:00-06:00', '2026-09-01', '2026-02-31', 'invalid']), {from: '2026-09-01', to: '2026-10-12'});
  assert.equal(loadedDateRange([]), null);
});
