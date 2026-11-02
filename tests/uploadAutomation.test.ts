import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {XmlCfdiParser} from '../src/lib/xmlParser';
import {regimeLabel, suggestProfile} from '../src/lib/profileDetection';
import {classifyUpload, unsupportedUploadMessage, uploadOrder} from '../src/lib/uploadRouting';
import {buildHomeSummary} from '../src/lib/homeSummary';
import {MatchingEngineService} from '../src/lib/MatchingEngineService';
import {HomeOverview} from '../src/components/HomeOverview';
import {SEED_CFDIS, SEED_PROFILE, SEED_TRANSACTIONS} from '../src/lib/seed';
import type {BankTransaction, CfdiRecord} from '../src/lib/types';

const party = (rfc: string, name = '', regime = '') => ({rfc, name, regime});

test('the parser exposes who issued and received a CFDI with their declared regimes', () => {
  const parsed = XmlCfdiParser.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'sample-cfdi40.xml'), 'utf8'), 'user-1');
  assert.ok(parsed.success, parsed.error);
  assert.deepEqual(parsed.parties, {
    emisor: {rfc: 'AAA010101AAA', name: 'PROVEEDOR SINTETICO DE PRUEBAS', regime: '601'},
    receptor: {rfc: 'XAXX010101000', name: 'PUBLICO EN GENERAL', regime: '616'},
  });
  assert.equal(XmlCfdiParser.parse('<xml/>', 'user-1').parties, undefined);
});

test('profile detection picks the RFC present in every uploaded CFDI and asks when that is not certain', () => {
  const owner = 'XAXX010101000';
  const detected = suggestProfile([
    {emisor: party('AAA010101AAA', 'Papelería'), receptor: party(owner, 'Mi negocio', '601')},
    {emisor: party(owner, 'Mi negocio', '601'), receptor: party('CCC010101CCC', 'Cliente')},
    {emisor: party('DDD010101DDD', 'Publicidad'), receptor: party(owner, 'Mi negocio')},
  ]);
  assert.deepEqual(detected.detected, {rfc: owner, name: 'Mi negocio', regime: '601', documents: 3});
  const single = suggestProfile([{emisor: party('AAA010101AAA', 'Proveedor', '601'), receptor: party(owner, 'Mi negocio', '616')}]);
  assert.equal(single.detected, undefined);
  assert.deepEqual(single.candidates.map(candidate => candidate.rfc).sort(), ['AAA010101AAA', owner]);
  const sameSupplier = suggestProfile([
    {emisor: party('AAA010101AAA'), receptor: party(owner)},
    {emisor: party('AAA010101AAA'), receptor: party(owner)},
  ]);
  assert.equal(sameSupplier.detected, undefined, 'two RFCs in every document cannot be told apart');
  assert.equal(regimeLabel('626'), '626 · Régimen Simplificado de Confianza (RESICO)');
  assert.equal(regimeLabel('999'), '999');
});

test('one upload control routes every file type and explains the ones it cannot read', () => {
  const kinds = ['factura.XML', 'estado.csv', 'banco.txt', 'ticket.pdf', 'foto.JPEG', 'foto.webp', 'movimientos.xlsx', 'paquete.zip', 'nota.docx'].map(name => classifyUpload({name, type: ''}));
  assert.deepEqual(kinds, ['xml', 'csv', 'csv', 'pdf', 'image', 'image', 'spreadsheet', 'zip', 'unsupported']);
  assert.ok(uploadOrder.xml < uploadOrder.csv && uploadOrder.csv < uploadOrder.pdf);
  assert.match(unsupportedUploadMessage('spreadsheet'), /Guárdalo como CSV/);
  assert.match(unsupportedUploadMessage('zip'), /Descomprime/);
});

test('home summary orders pending work by the decision it needs and only counts XML invoices as matchable', () => {
  const movements = MatchingEngineService.evaluateBatch(SEED_TRANSACTIONS, SEED_CFDIS, SEED_PROFILE);
  const summary = buildHomeSummary(movements, SEED_CFDIS, SEED_PROFILE.rfc);
  assert.equal(summary.stage, 'ready');
  assert.equal(summary.linked, 3);
  assert.deepEqual(summary.pending.map(item => item.action), ['choose', 'upload']);
  const paused = {...movements.find(item => item.status === 'discrepancia')!, id: 'paused', reconciliationLocked: true};
  assert.deepEqual(buildHomeSummary([paused, ...movements], SEED_CFDIS, SEED_PROFILE.rfc).pending.map(item => item.action), ['choose', 'upload', 'resume']);
  assert.equal(buildHomeSummary([], [], SEED_PROFILE.rfc).stage, 'empty');
  assert.equal(buildHomeSummary([], SEED_CFDIS, SEED_PROFILE.rfc).stage, 'documents-only');
  assert.equal(buildHomeSummary(movements, [], SEED_PROFILE.rfc).stage, 'movements-only');
  const notMatchable: CfdiRecord[] = [{...SEED_CFDIS[0], sourceType: 'manual', uuidSat: ''}, {...SEED_CFDIS[1], tipoComprobante: 'P', total: 0, currency: 'XXX'}, {...SEED_CFDIS[2], statusSat: 'cancelado'}];
  assert.equal(buildHomeSummary(movements, notMatchable, SEED_PROFILE.rfc).matchableInvoices, 0);
});

test('Inicio answers what to do next and never reports zero pending work as reviewed by the SAT', () => {
  const render = (transactions: BankTransaction[], documents: CfdiRecord[], demoMode = false) => renderToStaticMarkup(React.createElement(HomeOverview, {
    transactions, documents, profileRfc: SEED_PROFILE.rfc, businessName: SEED_PROFILE.businessName, demoMode,
    onUpload() {}, onChoose() {}, onUploadFor() {}, onResume() {}, onShowMovements() {}, onShowDocuments() {},
  }));
  const movements = MatchingEngineService.evaluateBatch(SEED_TRANSACTIONS, SEED_CFDIS, SEED_PROFILE);
  const html = render(movements, SEED_CFDIS, true);
  assert.match(html, /Demo con datos de ejemplo/);
  assert.match(html, /2 movimientos necesitan tu atención/);
  assert.match(html, /Elegir factura/);
  assert.match(html, /Subir factura/);
  const linked = movements.filter(item => item.status === 'conciliado');
  const done = render(linked, SEED_CFDIS);
  assert.match(done, /Todo al día/);
  assert.match(done, /Todos tus movimientos tienen factura/);
  assert.doesNotMatch(done, /SAT confirmó|saldo disponible/);
  const notMatchable = render(movements, [{...SEED_CFDIS[0], sourceType: 'manual', uuidSat: ''}]);
  assert.match(notMatchable, /necesitas facturas XML/);
});
