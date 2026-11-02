'use client';

import React from 'react';
import {ArrowDownLeft, ArrowRight, ArrowUpRight, CheckCircle2, FileCode2, FileSpreadsheet, HelpCircle, Link2, RotateCcw, UploadCloud} from 'lucide-react';
import {buildHomeSummary, type PendingItem} from '../lib/homeSummary';
import {describeLoadedDates} from '../lib/dashboardPresentation';
import {pendingExplanation} from '../lib/reconciliationPresentation';
import {formatDay, formatMoney, formatSignedMoney} from '../lib/format';
import type {BankTransaction, CfdiRecord} from '../lib/types';
import {ui} from './ui';

const MAX_PENDING_ON_HOME = 5;

function PendingRow({item, explanation, busy, onChoose, onUpload, onResume}: {item: PendingItem; explanation: string; busy: boolean; onChoose: () => void; onUpload: () => void; onResume: () => void}) {
  const {transaction, action} = item;
  return <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      <p className="break-words font-semibold text-white">{transaction.description}</p>
      <p className="mt-0.5 text-sm text-slate-400">{formatDay(transaction.date)} · <span className={transaction.amount > 0 ? 'text-emerald-300' : 'text-slate-200'}>{formatSignedMoney(transaction.amount, transaction.currency)}</span></p>
      <p className="mt-1 text-sm text-slate-300">{explanation}</p>
    </div>
    <div className="shrink-0">
      {action === 'choose' && <button type="button" onClick={onChoose} className={ui.choose}><HelpCircle aria-hidden="true" className="h-4 w-4" />Elegir factura</button>}
      {action === 'upload' && <button type="button" onClick={onUpload} className={ui.secondary}><UploadCloud aria-hidden="true" className="h-4 w-4" />Subir factura</button>}
      {action === 'resume' && <button type="button" disabled={busy} onClick={onResume} className={ui.secondary}><RotateCcw aria-hidden="true" className="h-4 w-4" />Volver a buscar</button>}
    </div>
  </li>;
}

/** Inicio answers "what do I do now": pending movements first, then the totals of what was uploaded. */
export function HomeOverview({transactions, documents, profileRfc, businessName, demoMode, busyMovementId, onUpload, onChoose, onUploadFor, onResume, onShowMovements, onShowDocuments}: {
  transactions: BankTransaction[]; documents: CfdiRecord[]; profileRfc: string; businessName: string; demoMode: boolean;
  busyMovementId?: string | null;
  onUpload: () => void; onChoose: (transaction: BankTransaction) => void; onUploadFor: (transaction: BankTransaction) => void;
  onResume: (transaction: BankTransaction) => void; onShowMovements: (filter: 'all' | 'pending') => void; onShowDocuments: () => void;
}) {
  const summary = buildHomeSummary(transactions, documents, profileRfc);
  const greeting = demoMode ? 'Demo con datos de ejemplo' : `Hola, ${businessName}`;

  if (summary.stage === 'empty') return <section aria-labelledby="home-title" className="space-y-6">
    <div className={`${ui.card} overflow-hidden p-6 sm:p-10`}>
      <p className="text-sm font-medium text-cyan-200">{greeting}</p>
      <h1 id="home-title" className="mt-2 max-w-2xl font-sora text-2xl font-bold text-white sm:text-3xl">Sube tus facturas y tu estado de cuenta. Nosotros juntamos cada pago con su factura.</h1>
      <ol className="mt-6 grid max-w-3xl grid-cols-1 gap-4 text-sm sm:grid-cols-3">
        {[['1', 'Sube tus archivos', 'Facturas XML y el CSV de tu banco, todos a la vez.'], ['2', 'Los juntamos', 'Cada factura se vincula al movimiento con el mismo importe y fecha.'], ['3', 'Resuelve lo pendiente', 'Sólo te pedimos ayuda cuando hay dudas o falta una factura.']].map(([step, title, text]) =>
          <li key={step} className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-300/15 font-semibold text-cyan-100">{step}</span><span><strong className="block text-white">{title}</strong><span className="text-slate-400">{text}</span></span></li>)}
      </ol>
      <button type="button" onClick={onUpload} className={`${ui.primary} mt-8 px-6 text-base`}><UploadCloud aria-hidden="true" className="h-5 w-5" />Subir archivos</button>
    </div>
  </section>;

  const linkedShare = summary.totalMovements ? Math.round((summary.linked / summary.totalMovements) * 100) : 0;
  const pendingShown = summary.pending.slice(0, MAX_PENDING_ON_HOME);

  return <section aria-labelledby="home-title" className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-cyan-200">{greeting}</p>
        <h1 id="home-title" className="mt-1 font-sora text-2xl font-bold text-white">
          {summary.stage === 'documents-only' ? 'Falta tu estado de cuenta'
            : summary.stage === 'movements-only' ? 'Faltan tus facturas'
            : summary.pending.length ? `${summary.pending.length} ${summary.pending.length === 1 ? 'movimiento necesita' : 'movimientos necesitan'} tu atención`
            : 'Todo al día'}
        </h1>
      </div>
    </div>

    {summary.totalMovements > 0 && <div className="grid grid-cols-3 gap-2 sm:gap-4">
      <div className={`${ui.card} min-w-0 p-3 sm:p-5`}>
        <p className="flex items-center gap-1.5 text-xs text-slate-300 sm:gap-2 sm:text-sm"><ArrowDownLeft aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-300" />Entró</p>
        {summary.totals.map(total => <p key={total.currency} className="mt-1 break-words font-mono text-sm font-semibold text-emerald-300 sm:mt-2 sm:text-2xl">{formatMoney(total.incoming, total.currency)}</p>)}
      </div>
      <div className={`${ui.card} min-w-0 p-3 sm:p-5`}>
        <p className="flex items-center gap-1.5 text-xs text-slate-300 sm:gap-2 sm:text-sm"><ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0" />Salió</p>
        {summary.totals.map(total => <p key={total.currency} className="mt-1 break-words font-mono text-sm font-semibold text-white sm:mt-2 sm:text-2xl">{formatMoney(total.outgoing, total.currency)}</p>)}
      </div>
      <button type="button" onClick={() => onShowMovements('all')} className={`${ui.card} min-w-0 p-3 text-left transition hover:border-cyan-300/40 sm:p-5 ${ui.focus}`}>
        <p className="flex items-center gap-1.5 text-xs text-slate-300 sm:gap-2 sm:text-sm"><Link2 aria-hidden="true" className="h-4 w-4 shrink-0 text-cyan-200" />Con factura</p>
        <p className="mt-1 font-mono text-sm font-semibold text-white sm:mt-2 sm:text-2xl">{summary.linked} <span className="text-xs font-normal text-slate-400 sm:text-base">de {summary.totalMovements}</span></p>
        <span className="mt-3 block h-2 overflow-hidden rounded-full bg-white/10" aria-hidden="true"><span className="block h-full rounded-full bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.72_0.17_155)]" style={{width: `${linkedShare}%`}} /></span>
      </button>
    </div>}
    {summary.totalMovements > 0 && <p className="-mt-2 text-xs text-slate-400">{describeLoadedDates(summary.dateRange)}. Calculado con los archivos que subiste; no es el saldo de tu banco.{summary.totals.length > 1 ? ' Cada moneda se suma por separado.' : ''}</p>}

    {summary.stage === 'documents-only' && <div className={`${ui.card} flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between`}>
      <p className="flex items-start gap-3 text-slate-200"><FileSpreadsheet aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" />Ya tienes {summary.documentCount} {summary.documentCount === 1 ? 'documento' : 'documentos'}. Sube el estado de cuenta de tu banco (CSV) para saber qué pagos ya tienen factura.</p>
      <button type="button" onClick={onUpload} className={ui.primary}>Subir estado de cuenta</button>
    </div>}
    {summary.stage === 'movements-only' && <div className={`${ui.card} flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between`}>
      <p className="flex items-start gap-3 text-slate-200"><FileCode2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" />Sube las facturas XML de tus compras y ventas. Las juntamos con tus movimientos automáticamente.</p>
      <button type="button" onClick={onUpload} className={ui.primary}>Subir facturas</button>
    </div>}
    {summary.stage === 'ready' && summary.matchableInvoices === 0 && <p className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-4 text-sm text-amber-100">Para juntar facturas con tus movimientos necesitas facturas XML. Los tickets, notas de crédito y comprobantes de pago se guardan, pero no se vinculan solos.</p>}

    {summary.totalMovements > 0 && <section aria-labelledby="pending-title" className={`${ui.card} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pending-title" className="text-lg font-semibold text-white">Pendientes</h2>
        {summary.pending.length > MAX_PENDING_ON_HOME && <button type="button" onClick={() => onShowMovements('pending')} className={ui.quiet}>Ver los {summary.pending.length}<ArrowRight aria-hidden="true" className="h-4 w-4" /></button>}
      </div>
      {pendingShown.length ? <ul className="mt-1 divide-y divide-white/10">{pendingShown.map(item => <PendingRow key={item.transaction.id} item={item} explanation={pendingExplanation(item.transaction, transactions, documents)}
        busy={busyMovementId === item.transaction.id} onChoose={() => onChoose(item.transaction)} onUpload={() => onUploadFor(item.transaction)} onResume={() => onResume(item.transaction)} />)}</ul>
        : <p className="mt-3 flex items-center gap-2 text-slate-200"><CheckCircle2 aria-hidden="true" className="h-5 w-5 text-emerald-300" />Todos tus movimientos tienen factura.</p>}
    </section>}

    {summary.documentCount > 0 && <section aria-labelledby="invoices-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="invoices-title" className="text-lg font-semibold text-white">Tus facturas</h2>
        <button type="button" onClick={onShowDocuments} className={ui.quiet}>Ver documentos<ArrowRight aria-hidden="true" className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[{key: 'received', title: 'Recibidas (compras)', count: summary.invoices.counts.received, totals: summary.invoices.received}, {key: 'issued', title: 'Emitidas (ventas)', count: summary.invoices.counts.issued, totals: summary.invoices.issued}].map(card =>
          <div key={card.key} className={`${ui.card} p-5`}>
            <p className="text-sm text-slate-300">{card.title} · {card.count}</p>
            {card.totals.length ? card.totals.map(([currency, amount]) => <p key={currency} className="mt-2 break-words font-mono text-xl font-semibold text-white">{formatMoney(amount, currency)}</p>) : <p className="mt-2 text-slate-400">Ninguna todavía</p>}
          </div>)}
      </div>
      {(summary.creditNotes > 0 || summary.payments > 0 || summary.provisional > 0) && <p className="text-sm text-slate-400">También tienes {[
        summary.creditNotes && `${summary.creditNotes} ${summary.creditNotes === 1 ? 'nota de crédito' : 'notas de crédito'}`,
        summary.payments && `${summary.payments} ${summary.payments === 1 ? 'comprobante de pago' : 'comprobantes de pago'}`,
        summary.provisional && `${summary.provisional} ${summary.provisional === 1 ? 'gasto sin factura XML' : 'gastos sin factura XML'}`,
      ].filter(Boolean).join(', ')}. Se muestran aparte y no cambian estos totales.</p>}
    </section>}
  </section>;
}
