'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import type { BankTransaction, CfdiRecord } from '../lib/types';
import type { MovementFilter } from '../lib/workspaceNavigation';
import { counterpartName, movementState, pendingExplanation } from '../lib/reconciliationPresentation';
import { formatDay, formatSignedMoney } from '../lib/format';
import { searchable } from '../lib/text';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, FileText, HelpCircle, RotateCcw, Search, Unlink, UploadCloud } from 'lucide-react';
import { toneClasses, ui } from './ui';

interface TreasuryInboxProps {
  transactions: BankTransaction[];
  cfdis: CfdiRecord[];
  profileRfc?: string;
  onOpenResolver: (tx: BankTransaction) => void;
  onOpenCfdiDetail: (cfdi: CfdiRecord) => void;
  onUnmatch: (txId: string) => void | Promise<void>;
  onResumeReconciliation?: (txId: string) => void | Promise<void>;
  onRequestUploadForDiscrepancy: (tx: BankTransaction) => void;
  onUpload?: () => void;
  initialFilter?: MovementFilter;
  reviewRequest?: {filter: MovementFilter; request: number};
  notice?: string;
}

export interface MovementView {
  filter: MovementFilter;
  query: string;
  handledRequest?: number;
  clearedSearch?: boolean;
}

/** Only a new explicit review request replaces the user's current search/filter. */
export function applyMovementReviewRequest(view: MovementView, request?: TreasuryInboxProps['reviewRequest']): MovementView {
  if (!request || request.request === view.handledRequest) return view;
  return {filter: request.filter, query: '', handledRequest: request.request, ...(view.query.trim() ? {clearedSearch: true} : {})};
}

const filterLabels: Record<MovementFilter, string> = {all: 'Todos', pending: 'Pendientes', conciliado: 'Con factura'};
const matchesFilter = (transaction: BankTransaction, filter: MovementFilter) =>
  filter === 'all' || (filter === 'pending' ? transaction.status !== 'conciliado' : transaction.status === 'conciliado');
const normalize = searchable;

export const TreasuryInbox: React.FC<TreasuryInboxProps> = ({
  transactions, cfdis, profileRfc, onOpenResolver, onOpenCfdiDetail, onUnmatch, onResumeReconciliation,
  onRequestUploadForDiscrepancy, onUpload, initialFilter = 'all', reviewRequest, notice,
}) => {
  const [view, setView] = useState<MovementView>(() => ({filter: reviewRequest?.filter ?? initialFilter, query: '', handledRequest: reviewRequest?.request}));
  const requestedView = applyMovementReviewRequest(view, reviewRequest);
  if (requestedView !== view) setView(requestedView);
  const activeFilter = requestedView.filter;
  const searchTerm = requestedView.query;
  const setFilter = (filter: MovementFilter) => setView(current => ({...current, filter, clearedSearch: undefined}));
  const setSearchTerm = (query: string) => setView(current => ({...current, query, clearedSearch: undefined}));
  const [pendingAction, setPendingAction] = useState<{id: string; kind: 'unmatch' | 'resume'} | null>(null);
  const [actionError, setActionError] = useState<{id: string; message: string} | null>(null);
  const pendingRef = useRef(false);
  const returnActionFocus = useRef(false);
  const movementsRef = useRef<HTMLElement>(null);
  const searchId = useId();

  useEffect(() => {
    if (!pendingAction && returnActionFocus.current) {
      returnActionFocus.current = false;
      if (document.activeElement === document.body) {
        const section = movementsRef.current;
        // Mounted, hidden panels must not steal focus after an async action completes.
        if (section?.getClientRects().length) section.focus({preventScroll: true});
      }
    }
  }, [pendingAction]);

  const runAction = async (id: string, kind: 'unmatch' | 'resume') => {
    if (pendingRef.current || (kind === 'resume' && !onResumeReconciliation)) return;
    pendingRef.current = true;
    setPendingAction({id, kind});
    setActionError(null);
    try {
      if (kind === 'resume') await onResumeReconciliation?.(id);
      else await onUnmatch(id);
    } catch (reason) {
      setActionError({id, message: reason instanceof Error ? reason.message : 'No se pudo guardar el cambio. Inténtalo de nuevo.'});
    } finally {
      pendingRef.current = false;
      returnActionFocus.current = true;
      setPendingAction(null);
    }
  };

  const documents = new Map(cfdis.map(document => [document.id, document]));
  const terms = normalize(searchTerm).trim().split(/\s+/).filter(Boolean);
  const filteredTransactions = transactions.filter(transaction => matchesFilter(transaction, activeFilter)).filter(transaction => {
    if (!terms.length) return true;
    const linkedDocument = transaction.matchedCfdiId ? documents.get(transaction.matchedCfdiId) : undefined;
    const text = normalize([transaction.description, transaction.amount.toFixed(2), Math.abs(transaction.amount).toFixed(2), transaction.date, formatDay(transaction.date), linkedDocument?.rfcEmisor ?? '', linkedDocument?.nombreEmisor ?? '', linkedDocument?.nombreReceptor ?? ''].join(' '));
    return terms.every(term => text.includes(term));
  });
  const count = (filter: MovementFilter) => transactions.filter(transaction => matchesFilter(transaction, filter)).length;

  return <section id="workspace-movements" ref={movementsRef} tabIndex={-1} aria-labelledby="workspace-movements-title" className="space-y-4 scroll-mt-24 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200">
    <h2 id="workspace-movements-title" className="sr-only">Movimientos del banco ({transactions.length})</h2>
    {notice && <p role="status" className="rounded-xl border border-cyan-800/60 bg-cyan-950/30 p-4 text-sm text-cyan-50">{notice}</p>}
    {requestedView.clearedSearch && <p role="status" className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">Limpiamos tu búsqueda anterior para mostrar lo que pediste.</p>}
    {transactions.length > 0 && <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div role="group" aria-label="Filtrar movimientos" className="flex flex-wrap gap-2">
        {(['all', 'pending', 'conciliado'] as const).map(filter => <button key={filter} type="button" aria-pressed={activeFilter === filter} onClick={() => setFilter(filter)}
          className={`min-h-11 rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${ui.focus} ${activeFilter === filter ? 'border-cyan-200 bg-cyan-200 text-slate-950' : 'border-white/15 text-slate-200 hover:bg-white/5'}`}>
          {filterLabels[filter]} <span className="font-mono">({count(filter)})</span>
        </button>)}
      </div>
      <label htmlFor={searchId} className="relative block sm:w-72">
        <span className="sr-only">Buscar un movimiento</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
        <input id={searchId} type="search" placeholder="Buscar movimiento" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className={`${ui.input} mt-0 pl-9 text-sm`} />
      </label>
    </div>}

    {filteredTransactions.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 p-6 text-slate-300">
      {transactions.length === 0 ? <><h3 className="font-semibold text-white">Aún no hay movimientos</h3><p className="mt-1 text-sm">Sube el estado de cuenta de tu banco en CSV. Puedes subir tus facturas antes o después.</p>{onUpload && <button type="button" onClick={onUpload} className={`${ui.primary} mt-4`}><UploadCloud aria-hidden="true" className="h-4 w-4" />Subir archivos</button>}</>
        : terms.length ? <><h3 className="font-semibold text-white">No encontramos movimientos con esa búsqueda</h3><p className="mt-1 text-sm">Prueba con otra descripción, importe o fecha.</p><button type="button" onClick={() => setSearchTerm('')} className={`${ui.secondary} mt-3`}>Limpiar búsqueda</button></>
        : activeFilter === 'pending' ? <><h3 className="flex items-center gap-2 font-semibold text-white"><CheckCircle2 aria-hidden="true" className="h-5 w-5 text-emerald-300" />No hay pendientes</h3><p className="mt-1 text-sm">Todos tus movimientos tienen factura.</p><button type="button" onClick={() => setFilter('all')} className={`${ui.secondary} mt-3`}>Ver todos los movimientos</button></>
        : <><h3 className="font-semibold text-white">No hay movimientos en este filtro</h3><button type="button" onClick={() => setFilter('all')} className={`${ui.secondary} mt-3`}>Ver todos los movimientos</button></>}
    </div> : <ul className="space-y-3">{filteredTransactions.map(transaction => {
      const linkedDocument = transaction.status === 'conciliado' && transaction.matchedCfdiId ? documents.get(transaction.matchedCfdiId) : undefined;
      const isEntry = transaction.amount > 0;
      const pending = pendingAction?.id === transaction.id;
      const state = movementState(transaction);
      return <li key={transaction.id} className={`${ui.card} p-4 sm:p-5`}>
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isEntry ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-slate-300'}`} aria-hidden="true">{isEntry ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <h3 className="min-w-0 break-words font-semibold text-white">{transaction.description}</h3>
              <p className={`shrink-0 font-mono text-lg font-semibold ${isEntry ? 'text-emerald-300' : 'text-white'}`}>{formatSignedMoney(transaction.amount, transaction.currency)}</p>
            </div>
            <p className="text-sm text-slate-400">{formatDay(transaction.date)} · {isEntry ? 'Entró' : 'Salió'}</p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClasses[state.tone]}`}>
                  {state.tone === 'done' ? <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> : state.tone === 'choose' ? <HelpCircle aria-hidden="true" className="h-3.5 w-3.5" /> : state.tone === 'paused' ? <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" /> : <FileText aria-hidden="true" className="h-3.5 w-3.5" />}{state.label}
                </span>
                <p className="mt-1.5 text-sm text-slate-300">{linkedDocument ? `Factura de ${counterpartName(linkedDocument, profileRfc)}${linkedDocument.statusSat === 'cancelado' ? ' (cancelada)' : ''}.` : pendingExplanation(transaction, transactions, cfdis)}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {linkedDocument && <button type="button" onClick={() => onOpenCfdiDetail(linkedDocument)} className={ui.secondary}><FileText aria-hidden="true" className="h-4 w-4" />Ver factura</button>}
                {linkedDocument && <button type="button" disabled={pendingAction !== null} aria-busy={pending && pendingAction?.kind === 'unmatch'} onClick={() => void runAction(transaction.id, 'unmatch')} className={ui.quiet}><Unlink aria-hidden="true" className="h-4 w-4" />{pending && pendingAction?.kind === 'unmatch' ? 'Quitando…' : 'Quitar'}</button>}
                {transaction.status === 'ambiguo' && <button type="button" onClick={() => onOpenResolver(transaction)} className={ui.choose}><HelpCircle aria-hidden="true" className="h-4 w-4" />Elegir factura</button>}
                {transaction.reconciliationLocked && onResumeReconciliation && <button type="button" disabled={pendingAction !== null} aria-busy={pending && pendingAction?.kind === 'resume'} onClick={() => void runAction(transaction.id, 'resume')} className={ui.secondary}><RotateCcw aria-hidden="true" className="h-4 w-4" />{pending && pendingAction?.kind === 'resume' ? 'Buscando…' : 'Volver a buscar'}</button>}
                {transaction.status === 'discrepancia' && !transaction.reconciliationLocked && <button type="button" onClick={() => onRequestUploadForDiscrepancy(transaction)} className={ui.secondary}><UploadCloud aria-hidden="true" className="h-4 w-4" />Subir factura</button>}
              </div>
            </div>
            {actionError?.id === transaction.id && <p role="alert" className="mt-3 rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{actionError.message} No se guardó el cambio; puedes intentar de nuevo.</p>}
          </div>
        </div>
      </li>;
    })}</ul>}
  </section>;
};
