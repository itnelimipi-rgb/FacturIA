import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MatchingEngineService} from '../src/lib/MatchingEngineService';
import {candidateComparison, documentCardLabel, reconciliationExplanation} from '../src/lib/reconciliationPresentation';
import {applyMovementReviewRequest, TreasuryInbox} from '../src/components/TreasuryInbox';
import {DocumentLibrary, searchDocumentRecords} from '../src/components/DocumentLibrary';
import {AmbiguousResolverModal} from '../src/components/AmbiguousResolverModal';
import type {BankTransaction, CfdiRecord, Profile} from '../src/lib/types';

const profile: Profile = {id: 'user-1', rfc: 'BBB010101BBB', businessName: 'Ejemplo', regimeCode: '626', createdAt: '2026-10-12T00:00:00Z'};
const document = (overrides: Partial<CfdiRecord> = {}): CfdiRecord => ({
  id: 'document-1', userId: profile.id, uuidSat: '550E8400-E29B-41D4-A716-446655440001',
  rfcEmisor: 'AAA010101AAA', rfcReceptor: profile.rfc, nombreEmisor: 'Proveedor de ejemplo',
  total: 116, subtotal: 100, iva: 16, retenciones: 0, fechaEmision: '2026-10-12T12:00:00',
  tipoComprobante: 'I', statusSat: 'no_verificado', isEfos: false, sourceType: 'xml', currency: 'MXN', ...overrides,
});
const transaction = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({
  id: 'transaction-1', userId: profile.id, accountId: 'account-1', amount: -116,
  currency: 'MXN', date: '2026-10-12', description: 'Compra de ejemplo', status: 'discrepancia', ...overrides,
});
const inbox = (transactions: BankTransaction[], cfdis: CfdiRecord[], extra: Partial<React.ComponentProps<typeof TreasuryInbox>> = {}) => renderToStaticMarkup(React.createElement(TreasuryInbox, {
  transactions, cfdis, onOpenResolver: () => {}, onOpenCfdiDetail: () => {}, onUnmatch: () => {},
  onRequestUploadForDiscrepancy: () => {}, ...extra,
}));
const library = (cfdis: CfdiRecord[]) => renderToStaticMarkup(React.createElement(DocumentLibrary, {cfdis, onOpenCfdiDetail: () => {}, profileRfc: profile.rfc}));

test('one document disputed by two movements explains the actual conflict rather than inventing multiple invoices', () => {
  const original = [transaction(), transaction({id: 'transaction-2'})];
  const evaluated = MatchingEngineService.evaluateBatch(original, [document()], profile);
  assert.equal(evaluated[0].status, 'ambiguo');
  assert.deepEqual(evaluated[0].candidateCfdiIds, ['document-1']);
  const html = renderToStaticMarkup(React.createElement(AmbiguousResolverModal, {isOpen: true, onClose: () => {}, transaction: evaluated[0], candidates: [document()], onResolve: () => {}}));
  assert.match(html, /Un documento coincide con más de un movimiento/);
  assert.match(html, />Documento posible</);
  assert.match(html, /Usar este documento/);
  assert.doesNotMatch(html, /Múltiples CFDI|coincidencia exacta|Vincular y Conciliar/);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="[^"]+" aria-describedby="[^"]+" tabindex="-1"/);
  assert.match(html, /aria-label="Cerrar revisión de coincidencia"/);
});

test('candidate comparisons expose the matching tolerance and written date difference honestly', () => {
  const first = document();
  const second = document({id: 'document-2', uuidSat: '550E8400-E29B-41D4-A716-446655440002', total: 116.01, fechaEmision: '2026-10-15T00:01:00'});
  const evaluated = MatchingEngineService.evaluateBatch([transaction()], [first, second], profile)[0];
  assert.equal(evaluated.status, 'ambiguo');
  const html = renderToStaticMarkup(React.createElement(AmbiguousResolverModal, {isOpen: true, onClose: () => {}, transaction: evaluated, candidates: [first, second], onResolve: () => {}}));
  assert.match(html, /Hay 2 documentos posibles/);
  assert.match(html, /Mismo importe a centavos/);
  assert.match(html, /Diferencia de importe: MXN.*0\.01/);
  assert.match(html, /Emitido 3 días después del movimiento/);
  assert.doesNotMatch(html, /coincidencia exacta|1 clic|±3/);
});

test('comparison never equates amounts across currencies and respects written dates across offsets', () => {
  const compared = candidateComparison(transaction(), document({currency: 'USD', fechaEmision: '2026-10-09T23:59:59-06:00'}));
  assert.match(compared.amount, /Monedas diferentes: MXN y USD/);
  assert.match(compared.amount, /No se convirtió/);
  assert.equal(compared.date, 'Emitido 3 días antes del movimiento.');
  assert.equal(candidateComparison(transaction({date: 'invalid'}), document()).date, 'Compara la fecha del documento y del movimiento.');
});

test('received and issued invoices are oriented by profile RFC and never by the income document type', () => {
  assert.equal(documentCardLabel(document(), profile.rfc), 'Factura recibida');
  assert.equal(documentCardLabel(document({rfcEmisor: profile.rfc, rfcReceptor: 'AAA010101AAA'}), profile.rfc), 'Factura emitida por ti');
  assert.equal(documentCardLabel(document(), undefined), 'Factura');
  assert.equal(documentCardLabel(document({rfcEmisor: profile.rfc}), profile.rfc), 'Factura · relación con tu RFC sin identificar');
  assert.equal(documentCardLabel(document(), 'CCC010101CCC'), 'Factura · relación con tu RFC sin identificar');
  const html = library([document()]);
  assert.match(html, /Factura recibida/);
  assert.doesNotMatch(html, /CFDI de ingreso|Mis ingresos/);
});

test('pending documents are normal tasks and old tax claims never become a tax judgment', () => {
  const legacy = transaction({alertReason: 'Movimiento bancario sin comprobante fiscal correspondiente vinculado. Alto riesgo de no deducibilidad.'});
  const html = inbox([legacy], []);
  assert.match(html, /Sin documento vinculado/);
  assert.match(html, /Puede faltar el documento o no coincidir/);
  assert.match(html, /Agregar comprobante/);
  assert.doesNotMatch(html, /Alto riesgo|no deducibilidad|Discrepancia|🔴/);
  const flagged = reconciliationExplanation(transaction({alertReason: 'Alerta EFOS en el comprobante candidato del RFC AAA010101AAA; requiere revisión'}));
  assert.match(flagged, /alerta registrada sobre su emisor/);
  assert.doesNotMatch(flagged, /fraude|no deducible|SAT confirmó/);
});

test('paused search stays distinct from a normal pending movement', () => {
  const html = inbox([transaction({reconciliationLocked: true})], [], {onResumeReconciliation: () => {}});
  assert.match(html, /búsqueda automática está pausada/);
  assert.match(html, /Volver a buscar/);
  assert.doesNotMatch(html, /Agregar comprobante/);
});

test('movement filter does not duplicate the document library or change either dataset', () => {
  const records = [transaction({description: 'Pendiente visible'}), transaction({id: 'transaction-2', description: 'Vinculado no visible', status: 'conciliado', matchedCfdiId: 'document-1'})];
  const original = JSON.stringify(records);
  const html = inbox(records, [document()], {initialFilter: 'discrepancia'});
  assert.match(html, /Pendiente visible/);
  assert.doesNotMatch(html, /Vinculado no visible/);
  assert.match(html, /id="workspace-movements" tabindex="-1"/);
  assert.doesNotMatch(html, /id="workspace-documents"|Documentos cargados|Identificador del documento/);
  const documents = library([document()]);
  assert.match(documents, /id="workspace-documents" tabindex="-1"/);
  assert.match(documents, /Documentos cargados \(1\)/);
  assert.doesNotMatch(documents, /Movimientos del banco|Quitar vínculo/);
  assert.equal(JSON.stringify(records), original);
});

test('empty account and empty filter explain different next steps', () => {
  const empty = inbox([], []);
  assert.match(empty, /Aún no cargaste movimientos/);
  assert.match(empty, /Puedes cargar documentos antes o después/);
  assert.doesNotMatch(empty, /Aún no cargaste documentos/);
  assert.match(library([]), /Aún no cargaste documentos/);
  const filtered = inbox([transaction()], [], {initialFilter: 'conciliado'});
  assert.match(filtered, /No hay movimientos en este filtro/);
  assert.match(filtered, /Ver todos los movimientos/);
  assert.doesNotMatch(filtered, /Aún no cargaste movimientos/);
});

test('payment card shows declared payment money separately from the technical zero XXX and bank data', () => {
  const payment = document({tipoComprobante: 'P', total: 0, subtotal: 0, iva: 0, currency: 'XXX', paymentComplement: {version: '2.0', totalPaymentsMxn: '58.000001', payments: []}});
  const html = library([payment, document({id: 'credit-note', tipoComprobante: 'E', total: 58})]);
  assert.match(html, /Documento de pagos/);
  assert.match(html, /Pagos indicados en este documento: MXN 58\.000001/);
  assert.match(html, /Nota de crédito/);
  assert.match(html, /no se vincula automáticamente a un movimiento/);
  assert.match(html, /Cargarlos no agrega ni quita dinero en el banco/);
  assert.doesNotMatch(html, /XXX 0|MontoTotalPagos|CFDI de ingreso/);
});

test('missing or invalid comparison data does not manufacture matching evidence', () => {
  assert.match(candidateComparison(transaction({amount: Number.NaN}), document()).amount, /Compara el importe/);
  assert.match(reconciliationExplanation(transaction({status: 'ambiguo', candidateCfdiIds: []})), /posible coincidencia que necesita tu revisión/);
  assert.match(reconciliationExplanation(transaction({alertReason: 'Falta el perfil, RFC o moneda para evaluar la conciliación'})), /Faltan datos/);
  assert.match(reconciliationExplanation(transaction({alertReason: 'El movimiento tiene fecha, monto o dirección inválidos'})), /Revisa la fecha/);
});

test('an explicit new review request clears a stale search while ordinary navigation preserves the current view', () => {
  const current = {filter: 'all' as const, query: 'Proveedor que no coincide', handledRequest: 3};
  const original = JSON.stringify(current);
  assert.equal(applyMovementReviewRequest(current, undefined), current);
  assert.equal(applyMovementReviewRequest(current, {filter: 'ambiguo', request: 3}), current);
  const requested = applyMovementReviewRequest(current, {filter: 'ambiguo', request: 4});
  assert.deepEqual(requested, {filter: 'ambiguo', query: '', handledRequest: 4, clearedSearch: true});
  assert.equal(JSON.stringify(current), original);
  const edited = {...requested, filter: 'conciliado' as const, query: 'Otra búsqueda'};
  assert.equal(applyMovementReviewRequest(edited, {filter: 'ambiguo', request: 4}), edited);
  assert.deepEqual(applyMovementReviewRequest(edited, {filter: 'discrepancia', request: 5}), {filter: 'discrepancia', query: '', handledRequest: 5, clearedSearch: true});
});

test('initial explicit review request displays the requested movements without requiring a remount', () => {
  const pending = transaction({description: 'Pendiente visible'});
  const linked = transaction({id: 'transaction-2', description: 'Vinculado oculto', status: 'conciliado', matchedCfdiId: 'document-1'});
  const html = inbox([pending, linked], [document()], {initialFilter: 'all', reviewRequest: {filter: 'discrepancia', request: 1}});
  assert.match(html, /Pendiente visible/);
  assert.doesNotMatch(html, /Vinculado oculto/);
});

test('document search finds issuer, receiver, fiscal identifier, written dates and descriptions without mutating records', () => {
  const primary = document({nombreEmisor: 'José Álvarez', nombreReceptor: 'Cliente de prueba', conceptos: [{descripcion: 'Asesoría de software', importe: 100}]});
  const other = document({id: 'other', uuidSat: '550E8400-E29B-41D4-A716-446655440099', nombreEmisor: 'Empresa distinta', rfcEmisor: 'CCC010101CCC', rfcReceptor: 'DDD010101DDD', fechaEmision: '2026-11-01T12:00:00'});
  const records = [primary, other];
  const original = JSON.stringify(records);
  for (const query of ['JOSE ALVAREZ', 'cliente prueba', 'AAA010101AAA', profile.rfc, '446655440001', '2026-10-12', '12/10/2026', 'asesoria SOFTWARE', 'factura recibida']) {
    assert.deepEqual(searchDocumentRecords(records, query, profile.rfc).map(record => record.id), ['document-1'], query);
  }
  assert.equal(searchDocumentRecords(records, '   ', profile.rfc), records);
  assert.deepEqual(searchDocumentRecords(records, 'Dato no registrado', profile.rfc), []);
  assert.equal(JSON.stringify(records), original);
});

test('document library provides its own accessible search and does not invent linked bank activity', () => {
  const html = library([document({nombreReceptor: 'Cliente registrado', conceptos: [{descripcion: 'Servicio registrado', importe: 100}]})]);
  assert.match(html, /Buscar un documento/);
  assert.match(html, /<label for="([^"]+)"[^>]*>Buscar un documento/);
  assert.match(html, /type="search"/);
  assert.match(html, /Para: Cliente registrado/);
  assert.match(html, /Descripción: Servicio registrado/);
  assert.doesNotMatch(html, /Movimientos del banco|Con documento vinculado|Vigente y deducible/);
});
