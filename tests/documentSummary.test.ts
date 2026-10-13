import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentTypeLabel, formatDeclaredAmount, summarizeXmlDocuments } from '../src/lib/documentSummary';
import type { CfdiRecord } from '../src/lib/types';
import { SEED_CFDIS } from '../src/lib/seed';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CfdiDetailModal } from '../src/components/CfdiDetailModal';

const record = (overrides: Partial<CfdiRecord> = {}): CfdiRecord => ({
  id: 'document-1', userId: 'user-1', uuidSat: '550E8400-E29B-41D4-A716-446655440001',
  rfcEmisor: 'AAA010101AAA', rfcReceptor: 'BBB010101BBB', total: 116, subtotal: 100, iva: 16,
  retenciones: 0, fechaEmision: '2026-10-12T12:00:00', tipoComprobante: 'I', statusSat: 'no_verificado',
  isEfos: false, sourceType: 'xml', currency: 'MXN', ...overrides,
});

test('document totals keep credit notes separate and never count zero XXX payment documents as invoice money', () => {
  const summary = summarizeXmlDocuments([
    record(), record({ tipoComprobante: 'E', total: 20 }), record({ tipoComprobante: 'P', total: 0, currency: 'XXX', paymentComplement: { version: '2.0', totalPaymentsMxn: '96', payments: [] } }),
    record({ tipoComprobante: 'N', total: 700 }), record({ tipoComprobante: 'T', total: 800 }),
  ]);
  assert.deepEqual(summary, { invoiceTotals: [['MXN', 116]], creditNoteTotals: [['MXN', 20]], invoiceCount: 1, creditNoteCount: 1, paymentCount: 1 });
});

test('documentary XML totals separate currencies and exclude cancelled, provisional and missing UUID records', () => {
  const summary = summarizeXmlDocuments([
    record(), record({ currency: 'USD', total: 50 }), record({ tipoComprobante: 'E', currency: 'USD', total: 10 }),
    record({ statusSat: 'cancelado', total: 999 }), record({ tipoComprobante: 'E', statusSat: 'cancelado', total: 999 }),
    record({ sourceType: 'manual', total: 999 }), record({ sourceType: 'pdf', total: 999 }), record({ uuidSat: '', total: 999 }),
    record({ currency: 'XXX', total: 999 }),
  ]);
  assert.deepEqual(summary.invoiceTotals, [['MXN', 116], ['USD', 50]]);
  assert.deepEqual(summary.creditNoteTotals, [['USD', 10]]);
  assert.equal(summary.invoiceCount, 2);
});

test('demo retains its XML income document total and an empty account does not invent a default currency', () => {
  assert.deepEqual(summarizeXmlDocuments(SEED_CFDIS).invoiceTotals, [['MXN', 39660]]);
  assert.deepEqual(summarizeXmlDocuments([]).invoiceTotals, []);
});

test('declared payment amounts preserve currency and every decimal without exchange conversion', () => {
  assert.equal(formatDeclaredAmount('1234.123456', 'USD'), 'USD 1,234.123456');
  assert.equal(formatDeclaredAmount('0', 'XXX'), 'XXX 0.00');
  assert.equal(formatDeclaredAmount('116.5', 'MXN'), 'MXN 116.50');
  assert.equal(formatDeclaredAmount('1e3', 'MXN'), 'Importe no disponible');
  assert.equal(formatDeclaredAmount('116', '<MXN>'), 'Importe no disponible');
});

test('document type labels distinguish credit notes, payments, payroll, transfers and manual records', () => {
  assert.match(documentTypeLabel(record({ tipoComprobante: 'E' })), /Nota de crédito.*egreso.*E/);
  assert.equal(documentTypeLabel(record({ tipoComprobante: 'P' })), 'Complemento de pagos (P)');
  assert.match(documentTypeLabel(record({ tipoComprobante: 'N' })), /nómina/);
  assert.match(documentTypeLabel(record({ tipoComprobante: 'T' })), /traslado/);
  assert.equal(documentTypeLabel(record({ sourceType: 'manual' })), 'Gasto provisional');
});

test('payment detail renders exact declared currencies and balances while keeping zero XXX separate', () => {
  const payment = record({ tipoComprobante: 'P', total: 0, subtotal: 0, iva: 0, currency: 'XXX', paymentComplement: {
    version: '2.0', totalPaymentsMxn: '3400.25', payments: [{ date: '2026-10-12T12:34:56', currency: 'USD', amount: '200.123456', form: '03', exchangeRate: '17.125', relatedDocuments: [{ uuid: '550E8400-E29B-41D4-A716-446655440009', currency: 'USD', equivalence: '1', installment: 2, previousBalance: '500', paidAmount: '200.123456', remainingBalance: '299.876544', taxObject: '02' }] }],
  } });
  const html = renderToStaticMarkup(React.createElement(CfdiDetailModal, { isOpen: true, onClose: () => {}, cfdi: payment }));
  for (const text of ['MontoTotalPagos declarado en MXN', 'MXN 3,400.25', 'USD 200.123456', 'USD 299.876544', 'USD 500.00', 'TipoCambioP declarado', '17.125', 'FechaPago', '2026-10-12T12:34:56', 'El total cero y la moneda XXX']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('IVA declarado'));
  assert.match(html, /no crea cobros, cargos o conciliaciones/);
});

test('related UUID lookup ignores another owner and payment detail bounds visible lists', () => {
  const referencedUuid = '550E8400-E29B-41D4-A716-446655440009';
  const declared = { date: '2026-10-12T12:34:56', currency: 'MXN', amount: '10', form: '03', relatedDocuments: [{ uuid: referencedUuid, currency: 'MXN', installment: 1, previousBalance: '20', paidAmount: '10', remainingBalance: '10', taxObject: '02' }] };
  const payment = record({ tipoComprobante: 'P', total: 0, currency: 'XXX', relatedCfdis: [{ type: '04', uuids: [referencedUuid] }], paymentComplement: { version: '2.0', totalPaymentsMxn: '110', payments: Array.from({ length: 11 }, () => declared) } });
  const foreign = record({ userId: 'foreign-owner', uuidSat: referencedUuid, tipoComprobante: 'E' });
  const html = renderToStaticMarkup(React.createElement(CfdiDetailModal, { isOpen: true, onClose: () => {}, cfdi: payment, documents: [foreign] }));
  assert.ok(!html.includes('Registrado en tu cuenta:'));
  assert.ok(html.includes('su comprobante no está cargado en esta cuenta.'));
  assert.ok(html.includes('Pago declarado 10'));
  assert.ok(!html.includes('Pago declarado 11'));
  assert.ok(html.includes('Se muestran diez pagos de 11.'));
  const own = record({ uuidSat: referencedUuid });
  const withOwn = renderToStaticMarkup(React.createElement(CfdiDetailModal, { isOpen: true, onClose: () => {}, cfdi: payment, documents: [own] }));
  assert.ok(withOwn.includes('Registrado en tu cuenta: CFDI de ingreso (I)'));
  assert.ok(withOwn.includes('vigencia SAT sin verificar'));
});
