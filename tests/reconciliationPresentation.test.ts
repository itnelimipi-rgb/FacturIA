import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MatchingEngineService} from '../src/lib/MatchingEngineService';
import {candidateComparison, documentCardLabel, pendingExplanation, reconciliationExplanation} from '../src/lib/reconciliationPresentation';
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
  transactions, cfdis, profileRfc: profile.rfc, onOpenResolver: () => {}, onOpenCfdiDetail: () => {}, onUnmatch: () => {},
  onRequestUploadForDiscrepancy: () => {}, ...extra,
}));
const library = (cfdis: CfdiRecord[], transactions: BankTransaction[] = []) => renderToStaticMarkup(React.createElement(DocumentLibrary, {cfdis, transactions, onOpenCfdiDetail: () => {}, profileRfc: profile.rfc}));

test('one invoice disputed by two movements explains the actual conflict rather than inventing multiple invoices', () => {
  const original = [transaction(), transaction({id: 'transaction-2'})];
  const evaluated = MatchingEngineService.evaluateBatch(original, [document()], profile);
  assert.equal(evaluated[0].status, 'ambiguo');
  assert.deepEqual(evaluated[0].candidateCfdiIds, ['document-1']);
  const html = renderToStaticMarkup(React.createElement(AmbiguousResolverModal, {isOpen: true, onClose: () => {}, transaction: evaluated[0], candidates: [document()], profileRfc: profile.rfc, onResolve: () => {}}));
  assert.match(html, /Esta factura coincide con más de un movimiento/);
  assert.match(html, />Factura posible</);
  assert.match(html, /Usar esta factura/);
  assert.doesNotMatch(html, /Múltiples CFDI|coincidencia exacta|Vincular y Conciliar/);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="[^"]+" aria-describedby="[^"]+" tabindex="-1"/);
  assert.match(html, /aria-label="Cerrar sin elegir"/);
});

test('candidate comparisons expose the matching tolerance and written date difference honestly', () => {
  const first = document();
  const second = document({id: 'document-2', uuidSat: '550E8400-E29B-41D4-A716-446655440002', total: 116.01, fechaEmision: '2026-10-15T00:01:00'});
  const evaluated = MatchingEngineService.evaluateBatch([transaction()], [first, second], profile)[0];
  assert.equal(evaluated.status, 'ambiguo');
  const html = renderToStaticMarkup(React.createElement(AmbiguousResolverModal, {isOpen: true, onClose: () => {}, transaction: evaluated, candidates: [first, second], profileRfc: profile.rfc, onResolve: () => {}}));
  assert.match(html, /2 facturas coinciden con este movimiento/);
  assert.match(html, /Mismo importe que el movimiento/);
  assert.match(html, /El importe difiere por \$0\.01/);
  assert.match(html, /Emitida 3 días después del movimiento/);
  assert.doesNotMatch(html, /coincidencia exacta|1 clic|±3/);
});

test('comparison never equates amounts across currencies and respects written dates across offsets', () => {
  const compared = candidateComparison(transaction(), document({currency: 'USD', fechaEmision: '2026-10-09T23:59:59-06:00'}));
  assert.match(compared.amount, /Monedas distintas \(MXN y USD\)/);
  assert.match(compared.amount, /no se convierten/);
  assert.equal(compared.date, 'Emitida 3 días antes del movimiento.');
  assert.equal(candidateComparison(transaction({date: 'invalid'}), document()).date, 'Compara la fecha de la factura y del movimiento.');
});

test('received and issued invoices are oriented by profile RFC and never by the income document type', () => {
  assert.equal(documentCardLabel(document(), profile.rfc), 'Factura recibida');
  assert.equal(documentCardLabel(document({rfcEmisor: profile.rfc, rfcReceptor: 'AAA010101AAA'}), profile.rfc), 'Factura emitida');
  assert.equal(documentCardLabel(document(), undefined), 'Factura');
  assert.equal(documentCardLabel(document({rfcEmisor: profile.rfc}), profile.rfc), 'Factura');
  assert.equal(documentCardLabel(document(), 'CCC010101CCC'), 'Factura');
  assert.equal(documentCardLabel(document({sourceType: 'manual', uuidSat: ''}), profile.rfc), 'Gasto anotado sin factura');
  assert.equal(documentCardLabel(document({sourceType: 'manual', uuidSat: '', attachment: {contentType: 'application/pdf', bytes: 10, sha256: 'a'.repeat(64), source: 'pdf'}}), profile.rfc), 'Gasto de un ticket o foto');
  const html = library([document()]);
  assert.match(html, /Factura recibida/);
  assert.doesNotMatch(html, /CFDI de ingreso|Mis ingresos/);
});

test('pending movements are normal tasks and old tax claims never become a tax judgment', () => {
  const legacy = transaction({alertReason: 'Movimiento bancario sin comprobante fiscal correspondiente vinculado. Alto riesgo de no deducibilidad.'});
  const html = inbox([legacy], []);
  assert.match(html, /Sin factura/);
  assert.match(html, /No hay una factura cargada con el mismo importe/);
  assert.match(html, /Subir factura/);
  assert.doesNotMatch(html, /Alto riesgo|no deducibilidad|Discrepancia|🔴/);
  const flagged = reconciliationExplanation(transaction({alertReason: 'Alerta EFOS en el comprobante candidato del RFC AAA010101AAA; requiere revisión'}));
  assert.match(flagged, /proveedor con una alerta registrada/);
  assert.doesNotMatch(flagged, /fraude|no deducible|SAT confirmó/);
});

test('a movement whose invoice is linked elsewhere says so instead of claiming no invoice exists', () => {
  const linked = transaction({id: 'transfer', description: 'Mantenimiento TRANSFERENCIA', status: 'conciliado', matchedCfdiId: 'document-1'});
  const card = transaction({id: 'card', description: 'Mantenimiento CARGO TARJETA'});
  assert.match(pendingExplanation(card, [linked, card], [document()]), /ya está vinculada a «Mantenimiento TRANSFERENCIA»/);
  assert.match(pendingExplanation(card, [linked, card], [document({total: 200})]), /No hay una factura cargada/);
  assert.match(pendingExplanation(transaction({id: 'income', amount: 116}), [linked], [document()]), /No hay una factura cargada/);
  assert.match(inbox([linked, card], [document()]), /Una factura sólo explica un movimiento/);
});

test('paused search stays distinct from a normal pending movement', () => {
  const html = inbox([transaction({reconciliationLocked: true})], [], {onResumeReconciliation: () => {}});
  assert.match(html, /Búsqueda pausada/);
  assert.match(html, /búsqueda automática está pausada/);
  assert.match(html, /Volver a buscar/);
  assert.doesNotMatch(html, /Subir factura/);
});

test('movement filter does not duplicate the document library or change either dataset', () => {
  const records = [transaction({description: 'Pendiente visible'}), transaction({id: 'transaction-2', description: 'Vinculado no visible', status: 'conciliado', matchedCfdiId: 'document-1'})];
  const original = JSON.stringify(records);
  const html = inbox(records, [document()], {initialFilter: 'pending'});
  assert.match(html, />Pendiente visible<\/h3>/);
  assert.doesNotMatch(html, />Vinculado no visible<\/h3>/);
  assert.match(html, /id="workspace-movements" tabindex="-1"/);
  assert.doesNotMatch(html, /id="workspace-documents"|Documentos cargados|Identificador del documento/);
  const documents = library([document()], records);
  assert.match(documents, /id="workspace-documents" tabindex="-1"/);
  assert.match(documents, /Documentos cargados \(1\)/);
  assert.match(documents, /Vinculada a un movimiento/);
  assert.doesNotMatch(documents, /Movimientos del banco|Quitar/);
  assert.equal(JSON.stringify(records), original);
});

test('empty account and empty filter explain different next steps', () => {
  const empty = inbox([], [], {onUpload: () => {}});
  assert.match(empty, /Aún no hay movimientos/);
  assert.match(empty, /Puedes subir tus facturas antes o después/);
  assert.match(empty, /Subir archivos/);
  assert.doesNotMatch(empty, /Aún no hay documentos/);
  assert.match(library([]), /Aún no hay documentos/);
  const filtered = inbox([transaction()], [], {initialFilter: 'conciliado'});
  assert.match(filtered, /No hay movimientos en este filtro/);
  assert.match(filtered, /Ver todos los movimientos/);
  assert.doesNotMatch(filtered, /Aún no hay movimientos/);
  const nothingPending = inbox([transaction({status: 'conciliado', matchedCfdiId: 'document-1'})], [document()], {initialFilter: 'pending'});
  assert.match(nothingPending, /No hay pendientes/);
});

test('payment card shows declared payment money separately from the technical zero XXX and bank data', () => {
  const payment = document({tipoComprobante: 'P', total: 0, subtotal: 0, iva: 0, currency: 'XXX', paymentComplement: {version: '2.0', totalPaymentsMxn: '58.000001', payments: []}});
  const html = library([payment, document({id: 'credit-note', tipoComprobante: 'E', total: 58})]);
  assert.match(html, /Comprobante de pago/);
  assert.match(html, /Pagos por MXN 58\.000001/);
  assert.match(html, /Nota de crédito/);
  assert.match(html, /no cambia tus movimientos/);
  assert.doesNotMatch(html, /XXX 0|MontoTotalPagos|CFDI de ingreso/);
});

test('missing or invalid comparison data does not manufacture matching evidence', () => {
  assert.match(candidateComparison(transaction({amount: Number.NaN}), document()).amount, /Compara el importe/);
  assert.match(reconciliationExplanation(transaction({status: 'ambiguo', candidateCfdiIds: []})), /Hay una factura posible/);
  assert.match(reconciliationExplanation(transaction({alertReason: 'Falta el perfil, RFC o moneda para evaluar la conciliación'})), /Faltan tu RFC/);
  assert.match(reconciliationExplanation(transaction({alertReason: 'El movimiento tiene fecha, monto o dirección inválidos'})), /Revisa la fecha/);
});

test('an explicit new review request clears a stale search while ordinary navigation preserves the current view', () => {
  const current = {filter: 'all' as const, query: 'Proveedor que no coincide', handledRequest: 3};
  const original = JSON.stringify(current);
  assert.equal(applyMovementReviewRequest(current, undefined), current);
  assert.equal(applyMovementReviewRequest(current, {filter: 'pending', request: 3}), current);
  const requested = applyMovementReviewRequest(current, {filter: 'pending', request: 4});
  assert.deepEqual(requested, {filter: 'pending', query: '', handledRequest: 4, clearedSearch: true});
  assert.equal(JSON.stringify(current), original);
  const edited = {...requested, filter: 'conciliado' as const, query: 'Otra búsqueda'};
  assert.equal(applyMovementReviewRequest(edited, {filter: 'pending', request: 4}), edited);
  assert.deepEqual(applyMovementReviewRequest(edited, {filter: 'all', request: 5}), {filter: 'all', query: '', handledRequest: 5, clearedSearch: true});
});

test('initial explicit review request displays the requested movements without requiring a remount', () => {
  const pending = transaction({description: 'Pendiente visible'});
  const linked = transaction({id: 'transaction-2', description: 'Vinculado oculto', status: 'conciliado', matchedCfdiId: 'document-1'});
  const html = inbox([pending, linked], [document()], {initialFilter: 'all', reviewRequest: {filter: 'pending', request: 1}});
  assert.match(html, />Pendiente visible<\/h3>/);
  assert.doesNotMatch(html, />Vinculado oculto<\/h3>/);
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
  assert.match(html, /<label for="([^"]+)"[^>]*><span class="sr-only">Buscar un documento<\/span>/);
  assert.match(html, /type="search"/);
  assert.match(html, /Proveedor de ejemplo/);
  assert.match(html, /Servicio registrado/);
  assert.match(html, /Sin movimiento vinculado/);
  assert.doesNotMatch(html, /Movimientos del banco|Con factura|Vigente y deducible|Vinculada a un movimiento/);
});
