'use client';

import React from 'react';
import type {BankTransaction, CashFlowMetrics, CfdiRecord} from '../lib/types';
import {ArrowRight, FileCheck2, Files, Search} from 'lucide-react';
import {summarizeXmlDocuments} from '../lib/documentSummary';
import {summarizeInvoiceOrientation, summarizeLoadedMovements, type CurrencyAmount, type MovementReviewFilter} from '../lib/dashboardPresentation';

interface FiscalDashboardPanelProps {
  metrics: CashFlowMetrics;
  cfdis: CfdiRecord[];
  transactions?: BankTransaction[];
  profileRfc?: string;
  onGoToFacturas: () => void;
  onReviewMovements?: (filter: MovementReviewFilter) => void;
  onReviewDocuments?: () => void;
  onAddMovements?: () => void;
}

const cardClass = 'min-w-0 rounded-2xl border border-slate-700 bg-slate-900 p-5 sm:p-6';
const actionClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-teal-200 transition hover:border-teal-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300';
const formatCurrency = (value: number, currency: string) => new Intl.NumberFormat('es-MX', {style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2}).format(value);

function Amounts({totals, empty}: {totals: CurrencyAmount[]; empty: string}) {
  return <div className="mt-3 space-y-1 break-words font-mono text-xl font-semibold text-white">{totals.length ? totals.map(([currency, amount]) => <p key={currency}>{formatCurrency(amount, currency)}</p>) : <p className="font-sans text-base font-normal text-slate-300">{empty}</p>}</div>;
}

export const FiscalDashboardPanel: React.FC<FiscalDashboardPanelProps> = ({metrics, cfdis, transactions, profileRfc, onGoToFacturas, onReviewMovements, onReviewDocuments, onAddMovements}) => {
  const loaded = transactions ? summarizeLoadedMovements(transactions) : null;
  const total = loaded?.totalCount ?? metrics.conciliadoCount + metrics.ambiguoCount + metrics.discrepanciaCount;
  const linked = loaded?.linkedCount ?? metrics.conciliadoCount;
  const ambiguous = loaded?.ambiguousCount ?? metrics.ambiguoCount;
  const withoutDocument = loaded?.withoutDocumentCount ?? metrics.discrepanciaCount;
  const paused = loaded?.pausedCount ?? 0;
  const provisional = cfdis.filter(document => document.sourceType === 'manual' || document.sourceType === 'pdf' || document.sourceType === 'image').length;
  const unverifiedXml = cfdis.filter(document => document.sourceType === 'xml' && document.statusSat === 'no_verificado').length;
  const invoices = summarizeInvoiceOrientation(cfdis, profileRfc);
  const documents = summarizeXmlDocuments(cfdis);
  const reviewMovements = (filter: MovementReviewFilter) => onReviewMovements ? onReviewMovements(filter) : onGoToFacturas();
  const reviewDocuments = onReviewDocuments ?? onGoToFacturas;
  const tasks = [
    ...(ambiguous ? [{key: 'ambiguous', title: `${ambiguous} ${ambiguous === 1 ? 'movimiento necesita' : 'movimientos necesitan'} que elijas una relación`, detail: 'Hay varias coincidencias posibles, o una factura coincide con más de un movimiento. Compara los datos antes de elegir.', action: 'Revisar coincidencias', onClick: () => reviewMovements('ambiguo')}] : []),
    ...(withoutDocument ? [{key: 'without-document', title: `${withoutDocument} ${withoutDocument === 1 ? 'movimiento está' : 'movimientos están'} sin documento vinculado`, detail: 'Puede faltar un documento o puede haber uno cuyos datos no coinciden. Abre el movimiento para conocer la causa.', action: 'Ver movimientos sin documento', onClick: () => reviewMovements('discrepancia')}] : []),
    ...(paused ? [{key: 'paused', title: `${paused} ${paused === 1 ? 'búsqueda está pausada' : 'búsquedas están pausadas'}`, detail: 'La búsqueda automática está pausada para esos movimientos. Puedes volver a buscar desde cada movimiento.', action: 'Ver movimientos con búsqueda pausada', onClick: () => reviewMovements('discrepancia')}] : []),
    ...(provisional ? [{key: 'provisional', title: `${provisional} ${provisional === 1 ? 'gasto anotado' : 'gastos anotados'} sin factura XML`, detail: 'Son registros provisionales. Si ya tienes su factura XML, puedes agregarla; la anotación seguirá siendo provisional.', action: 'Ver mis documentos', onClick: reviewDocuments}] : []),
  ];

  return <div className="space-y-6">
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <section className={cardClass} aria-labelledby="movement-links-title">
        <h2 id="movement-links-title" className="text-lg font-semibold text-white">Movimientos con documento</h2>
        {total ? <>
          <p className="mt-4 text-3xl font-semibold text-white">{linked} <span className="text-lg font-normal text-slate-300">de {total}</span></p>
          <p className="mt-2 text-base leading-relaxed text-slate-300">Tienen un documento vinculado que puede explicar el dinero que entró o salió.</p>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">El sistema puede encontrar una relación automáticamente. Comprueba sus datos; tener un documento vinculado no confirma su estado en el SAT.</p>
          <button type="button" onClick={() => reviewMovements('all')} className={`${actionClass} mt-4`}><FileCheck2 size={18} />Ver movimientos y sus documentos</button>
        </> : <>
          <p className="mt-4 text-base leading-relaxed text-slate-300">Aún no agregaste movimientos del banco. Cuando los cargues, aquí verás cuáles tienen un documento vinculado.</p>
          {cfdis.length > 0 && <p className="mt-3 text-sm leading-relaxed text-slate-300">Tus {cfdis.length} {cfdis.length === 1 ? 'documento ya está guardado' : 'documentos ya están guardados'}. Agregar movimientos permite compararlos.</p>}
          <button type="button" onClick={onAddMovements ?? (() => reviewMovements('all'))} className={`${actionClass} mt-4`}>Agregar movimientos<ArrowRight size={18} /></button>
        </>}
      </section>
      <section className={cardClass} aria-labelledby="review-tasks-title">
        <h2 id="review-tasks-title" className="flex items-center gap-2 text-lg font-semibold text-white"><Search size={20} className="text-teal-200" />Lo que puedes revisar</h2>
        {tasks.length ? <ul className="mt-4 space-y-4">{tasks.map(task => <li key={task.key} className="rounded-xl border border-slate-700 bg-slate-950 p-4">
          <h3 className="text-base font-semibold text-white">{task.title}</h3><p className="mt-2 text-sm leading-relaxed text-slate-300">{task.detail}</p><button type="button" onClick={task.onClick} className={`${actionClass} mt-3`}>{task.action}<ArrowRight size={16} /></button>
        </li>)}</ul> : <p className="mt-4 text-base leading-relaxed text-slate-300">{total ? 'Los movimientos cargados tienen un documento vinculado. Puedes abrirlos para revisar las relaciones encontradas.' : 'Agrega documentos y movimientos para encontrar relaciones entre ellos. Todavía no hay datos suficientes para revisar esas relaciones.'}</p>}
      </section>
    </div>

    <section aria-labelledby="loaded-invoices-title" className="space-y-4">
      <div><h2 id="loaded-invoices-title" className="text-lg font-semibold text-white">Lo que dicen tus facturas</h2><p className="mt-1 text-sm leading-relaxed text-slate-300">Importes de las facturas XML cargadas, separados por moneda. Una factura no confirma que el dinero ya se pagó o se recibió.</p></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[{key: 'received', title: 'Facturas que recibiste', count: invoices.counts.received, totals: invoices.received, empty: 'Aún no hay facturas recibidas en estos datos.', detail: 'El RFC del perfil aparece como quien recibió la factura. Pueden documentar tus compras.'}, {key: 'issued', title: 'Facturas que emitiste', count: invoices.counts.issued, totals: invoices.issued, empty: 'Aún no hay facturas emitidas en estos datos.', detail: 'El RFC del perfil aparece como quien emitió la factura. Pueden documentar tus ventas.'}].map(card => <section key={card.key} className={cardClass}>
          <h3 className="flex items-center gap-2 text-base font-semibold text-white"><Files size={18} className="text-teal-200" />{card.title} ({card.count})</h3><Amounts totals={card.totals} empty={card.empty} /><p className="mt-3 text-sm leading-relaxed text-slate-300">{card.detail}</p>
        </section>)}
      </div>
      {invoices.counts.unclassified > 0 && <section className={cardClass}><h3 className="text-base font-semibold text-white">Facturas cuya relación con tu perfil no está clara ({invoices.counts.unclassified})</h3><Amounts totals={invoices.unclassified} empty="Sin importes disponibles" /><p className="mt-3 text-sm leading-relaxed text-slate-300">No se pueden clasificar como emitidas o recibidas con el RFC disponible. Consulta quién emitió y recibió cada documento.</p></section>}
      {(documents.creditNoteCount > 0 || documents.paymentCount > 0) && <section className={`${cardClass} space-y-4`}>
        {documents.creditNoteCount > 0 && <div><h3 className="text-base font-semibold text-white">Notas de crédito ({documents.creditNoteCount})</h3><Amounts totals={documents.creditNoteTotals} empty="Sin importes disponibles" /><p className="mt-2 text-sm leading-relaxed text-slate-300">Registran un ajuste en documentos. Estos importes se muestran aparte: no descuentan dinero de los movimientos del banco ni de las otras facturas.</p></div>}
        {documents.paymentCount > 0 && <div><h3 className="text-base font-semibold text-white">Documentos de pagos ({documents.paymentCount})</h3><p className="mt-2 text-sm leading-relaxed text-slate-300">Abre cada documento para ver qué pago y qué saldo registra. Cargarlo no agrega movimientos del banco ni calcula cuánto se debe actualmente.</p></div>}
        <button type="button" onClick={reviewDocuments} className={actionClass}>Ver mis documentos<ArrowRight size={16} /></button>
      </section>}
      <p className="text-sm leading-relaxed text-slate-300">Estos totales excluyen facturas canceladas, gastos provisionales y otros tipos de documento. No se calculan impuestos ni deducciones.</p>
      {unverifiedXml > 0 && <details className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300"><summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300">Sobre el estado de tus facturas en el SAT</summary><p className="mt-3 leading-relaxed">{unverifiedXml} {unverifiedXml === 1 ? 'documento XML no tiene' : 'documentos XML no tienen'} su estado confirmado. Puedes solicitar una consulta en el detalle de cada XML de tu cuenta. La demostración usa estados de ejemplo.</p><button type="button" onClick={reviewDocuments} className={`${actionClass} mt-3`}>Ver mis documentos</button></details>}
    </section>
  </div>;
};
