import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SatStatusControls } from '../src/components/SatStatusControls';
import { RegisterInvoiceModal } from '../src/components/RegisterInvoiceModal';
import { CfdiDetailModal } from '../src/components/CfdiDetailModal';
import { describeSavedDocument } from '../src/components/UploadCenter';
import { documentAmountText } from '../src/lib/documentSummary';
import type { BankTransaction, CfdiRecord, SatVerification } from '../src/lib/types';

const record = (overrides: Partial<CfdiRecord> = {}): CfdiRecord => ({
  id: 'document-1', userId: 'user-1', uuidSat: '550E8400-E29B-41D4-A716-446655440001',
  rfcEmisor: 'AAA010101AAA', rfcReceptor: 'BBB010101BBB', total: 116, subtotal: 100, iva: 16,
  retenciones: 0, fechaEmision: '2026-10-12T12:00:00', tipoComprobante: 'I', statusSat: 'no_verificado',
  isEfos: false, sourceType: 'xml', currency: 'MXN', ...overrides,
});
const consultation = (outcome: SatVerification['outcome'], status: SatVerification['status'] = 'no_verificado'): SatVerification => ({
  source: 'sat', checkedAt: '2026-10-12T12:00:00Z', outcome, status, efos: 'unknown',
});
const renderSat = (document: CfdiRecord, demoMode = false) => renderToStaticMarkup(React.createElement(SatStatusControls, { document, demoMode, onSnapshotUpdated: () => {} }));

test('SAT displays missing, unavailable and found results as different outcomes and preserves previous alerts', () => {
  const missing = renderSat(record({ satVerification: consultation('not_found') }));
  const unavailable = renderSat(record({ isEfos: true, satVerification: consultation('unavailable') }));
  const found = renderSat(record({ statusSat: 'vigente', satVerification: consultation('found', 'vigente') }));
  assert.ok(missing.includes('documento no encontrado'));
  assert.ok(!missing.includes('documento vigente en la fecha'));
  assert.ok(unavailable.includes('No pudimos obtener una respuesta'));
  assert.ok(unavailable.includes('La alerta anterior sobre el emisor se conserva'));
  assert.ok(!unavailable.includes('documento cancelado en la fecha'));
  assert.ok(found.includes('documento vigente en la fecha de esta consulta'));
  assert.ok(!found.includes('Sin consultar:'));
  for (const html of [missing, unavailable, found]) {
    assert.ok(html.includes('Fuente: servicio de consulta del SAT. Fecha:'));
    assert.ok(html.includes('UUID'));
    assert.ok(html.includes('los RFC de quien lo emitió y recibió, y el total del XML'));
    assert.ok(html.includes('No se envía el archivo completo'));
    assert.ok(html.includes('no confirma que el documento sea deducible'));
  }
});

test('an XML with no SAT consultation does not borrow its recorded state as a confirmed result and demo cannot query', () => {
  const initial = renderSat(record({ statusSat: 'vigente' }));
  const demo = renderSat(record({ statusSat: 'vigente' }), true);
  assert.ok(initial.includes('Sin consultar:'));
  assert.ok(!initial.includes('El SAT respondió:'));
  assert.ok(demo.includes('Estado SAT de ejemplo'));
  assert.ok(!demo.includes('Consultar estado del documento en el SAT'));
  assert.ok(!demo.includes('El SAT respondió:'));
});

test('manual expense leaves unknown tax amounts empty and does not display a fabricated zero total', () => {
  const html = renderToStaticMarkup(React.createElement(RegisterInvoiceModal, { isOpen: true, userId: 'user-1', receptorRfc: 'BBB010101BBB', onClose: () => {}, onInvoiceCreated: () => {} }));
  const taxInputs = html.match(/<input[^>]*aria-describedby="expense-tax-help"[^>]*>/g) || [];
  assert.equal(taxInputs.length, 2);
  assert.ok(taxInputs.every(input => input.includes('value=""') && input.includes('required=""')));
  assert.ok(!html.includes('value="0"'));
  assert.ok(html.includes('Completa los tres importes'));
  assert.ok(!html.includes('0.00 MXN'));
  assert.ok(html.includes('No emite una factura'));
  assert.ok(html.includes('no se vincula automáticamente con el banco'));
  assert.ok(html.includes('role="dialog"'));
});

test('XML upload results report payment complement money instead of the zero XXX XML total', () => {
  const payment = record({ tipoComprobante: 'P', currency: 'XXX', total: 0, paymentComplement: { version: '2.0', totalPaymentsMxn: '58', payments: [] } });
  assert.equal(documentAmountText(payment), 'Pagos por MXN 58.00');
  assert.equal(documentAmountText({ ...payment, paymentComplement: undefined }), 'Comprobante de pago');
  assert.match(describeSavedDocument(payment, { transactions: [] }, 'BBB010101BBB'), /No cambia tus movimientos/);
  assert.match(describeSavedDocument(record({ tipoComprobante: 'E', total: 20 }), { transactions: [] }, 'BBB010101BBB'), /Nota de crédito guardada. No cambia tus movimientos/);
});

test('upload results describe the link the save produced and explain why a chosen movement did not match', () => {
  const rfc = 'BBB010101BBB';
  const invoice = record();
  const movement: BankTransaction = { id: 'movement-1', userId: 'user-1', accountId: 'account-1', amount: -116, currency: 'MXN', date: '2026-10-12', description: 'Pago proveedor', status: 'discrepancia' };
  assert.match(describeSavedDocument(invoice, { transactions: [] }, rfc), /Sube tu estado de cuenta/);
  assert.match(describeSavedDocument(invoice, { transactions: [movement] }, rfc), /Aún no hay un movimiento/);
  assert.equal(describeSavedDocument(invoice, { transactions: [{ ...movement, status: 'conciliado', matchedCfdiId: invoice.id }] }, rfc), 'Vinculada a «Pago proveedor».');
  assert.match(describeSavedDocument(invoice, { transactions: [{ ...movement, status: 'ambiguo', candidateCfdiIds: [invoice.id] }] }, rfc), /elige si corresponde/);
  assert.equal(describeSavedDocument(invoice, { transactions: [{ ...movement, status: 'conciliado', matchedCfdiId: invoice.id }] }, rfc, movement), 'Quedó vinculada a este movimiento.');
  assert.match(describeSavedDocument(record({ rfcEmisor: rfc, rfcReceptor: 'AAA010101AAA' }), { transactions: [movement] }, rfc, movement), /tú emitiste y este movimiento es un pago/);
  assert.match(describeSavedDocument(record({ total: 200 }), { transactions: [movement] }, rfc, movement), /no coincide con este movimiento\. El importe difiere/);
  assert.match(describeSavedDocument(record({ tipoComprobante: 'P', currency: 'XXX', total: 0 }), { transactions: [movement] }, rfc, movement), /sólo una factura se puede vincular/);
});

test('payment amount precedes technical zero while credit notes do not promise a bank refund', () => {
  const payment = record({ tipoComprobante: 'P', currency: 'XXX', total: 0, paymentComplement: { version: '2.0', totalPaymentsMxn: '58', payments: [] } });
  const html = renderToStaticMarkup(React.createElement(CfdiDetailModal, { isOpen: true, onClose: () => {}, cfdi: payment }));
  assert.ok(html.indexOf('MXN 58.00') < html.indexOf('Total del comprobante XML'));
  assert.ok(html.includes('No muestran cuánto queda pendiente hoy ni el saldo de tu banco'));
  const credit = renderToStaticMarkup(React.createElement(CfdiDetailModal, { isOpen: true, onClose: () => {}, cfdi: record({ tipoComprobante: 'E', total: 20 }) }));
  assert.ok(credit.includes('Nota de crédito'));
  assert.ok(credit.includes('no registra una devolución bancaria ni descuenta dinero de tus movimientos'));
});
