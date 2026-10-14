'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import type { BankTransaction, CfdiRecord, ReconciliationStatus } from '../lib/types';
import { formatDeclaredAmount } from '../lib/documentSummary';
import { documentCardLabel, reconciliationExplanation, reconciliationLabels } from '../lib/reconciliationPresentation';
import { CheckCircle2, HelpCircle, FileText, ArrowDownLeft, ArrowUpRight, ExternalLink, Search, Plus, Unlink } from 'lucide-react';

interface TreasuryInboxProps {
  transactions: BankTransaction[];
  cfdis: CfdiRecord[];
  onOpenResolver: (tx: BankTransaction) => void;
  onOpenCfdiDetail: (cfdi: CfdiRecord) => void;
  onUnmatch: (txId: string) => void | Promise<void>;
  onResumeReconciliation?: (txId: string) => void | Promise<void>;
  onRequestUploadForDiscrepancy: (tx: BankTransaction) => void;
  onOpenRegisterModal?: () => void;
  initialFilter?: 'all' | ReconciliationStatus;
  focusSection?: 'movements' | 'documents';
  profileRfc?: string;
  notice?: string;
}

const money = (value: number, currency: string) => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2,
}).format(Math.abs(value));

export const TreasuryInbox: React.FC<TreasuryInboxProps> = ({
  transactions, cfdis, onOpenResolver, onOpenCfdiDetail, onUnmatch, onResumeReconciliation,
  onRequestUploadForDiscrepancy, onOpenRegisterModal, initialFilter = 'all', focusSection, profileRfc, notice,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | ReconciliationStatus>(initialFilter);
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingAction, setPendingAction] = useState<{id: string; kind: 'unmatch' | 'resume'} | null>(null);
  const [actionError, setActionError] = useState<{id: string; message: string} | null>(null);
  const pendingRef = useRef(false);
  const returnActionFocus = useRef(false);
  const movementsRef = useRef<HTMLElement>(null);
  const documentsRef = useRef<HTMLElement>(null);
  const searchId = useId();

  useEffect(() => {
    if (!focusSection) return;
    const section = focusSection === 'movements' ? movementsRef.current : documentsRef.current;
    section?.focus({preventScroll: true});
    section?.scrollIntoView({block: 'start', behavior: 'auto'});
  }, [focusSection]);

  useEffect(() => {
    if (!pendingAction && returnActionFocus.current) {
      returnActionFocus.current = false;
      if (document.activeElement === document.body) {
        movementsRef.current?.focus({preventScroll: true});
        movementsRef.current?.scrollIntoView({block: 'start', behavior: 'auto'});
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
  const filteredTransactions = transactions.filter(transaction => activeTab === 'all' || transaction.status === activeTab).filter(transaction => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    const linkedDocument = transaction.matchedCfdiId ? documents.get(transaction.matchedCfdiId) : undefined;
    return [transaction.description, transaction.amount.toString(), transaction.date, linkedDocument?.rfcEmisor ?? '', linkedDocument?.nombreEmisor ?? ''].some(value => value.toLowerCase().includes(term));
  });
  const filters: Array<'all' | ReconciliationStatus> = ['all', 'conciliado', 'ambiguo', 'discrepancia'];

  return <div className="w-full space-y-7">
    <section id="workspace-movements" ref={movementsRef} tabIndex={-1} aria-labelledby="workspace-movements-title" className="space-y-4 scroll-mt-24 rounded-xl focus-visible:outline-2 focus-visible:outline-teal-300 focus-visible:outline-offset-4">
      {notice && <p role="status" className="rounded-xl border border-teal-800 bg-teal-950/30 p-4 text-sm text-teal-100">{notice}</p>}
      <div>
        <h2 id="workspace-movements-title" className="font-sora text-lg font-bold text-white">Movimientos del banco ({transactions.length})</h2>
        <p className="mt-1 text-sm text-slate-300">Son las entradas y salidas que cargaste desde un archivo. Vincular un documento ayuda a explicar un movimiento; no confirma su estado ante el SAT.</p>
      </div>
      <div className="space-y-3 border-b border-slate-700 pb-4">
        <div role="group" aria-label="Filtrar movimientos por vínculo con un documento" className="flex flex-wrap gap-2">
          {filters.map(filter => <button key={filter} type="button" aria-pressed={activeTab === filter} onClick={() => setActiveTab(filter)} className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${activeTab === filter ? 'border-teal-300 bg-teal-300 text-slate-950' : 'border-slate-600 text-slate-200 hover:bg-slate-800'}`}>
            {filter === 'all' ? 'Todos' : reconciliationLabels[filter]} <span className="font-mono">({filter === 'all' ? transactions.length : transactions.filter(transaction => transaction.status === filter).length})</span>
          </button>)}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label htmlFor={searchId} className="min-w-0 flex-1 text-sm text-slate-300">Buscar un movimiento
            <span className="relative mt-1 block"><Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input id={searchId} type="search" placeholder="Descripción, importe, fecha o emisor" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-600 bg-slate-900 py-2 pl-10 pr-3 text-sm text-white placeholder:text-slate-400" /></span>
          </label>
          {onOpenRegisterModal && <button type="button" onClick={onOpenRegisterModal} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"><Plus aria-hidden="true" className="h-4 w-4" />Anotar un gasto sin factura</button>}
        </div>
      </div>

      {filteredTransactions.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-900/40 p-6 text-sm text-slate-300">
        {transactions.length === 0 ? <><h3 className="font-semibold text-white">Aún no cargaste movimientos</h3><p className="mt-1">Agrega un archivo de movimientos bancarios para ver las entradas y salidas aquí. Puedes cargar documentos antes o después.</p></> : searchTerm.trim() ? <><h3 className="font-semibold text-white">No encontramos movimientos con esa búsqueda</h3><p className="mt-1">Prueba otra descripción, importe o fecha.</p><button type="button" onClick={() => setSearchTerm('')} className="mt-3 min-h-11 rounded-lg border border-slate-600 px-3 py-2 text-white hover:bg-slate-800">Limpiar búsqueda</button></> : <><h3 className="font-semibold text-white">No hay movimientos en este filtro</h3><p className="mt-1">Los demás movimientos siguen disponibles.</p><button type="button" onClick={() => setActiveTab('all')} className="mt-3 min-h-11 rounded-lg border border-slate-600 px-3 py-2 text-white hover:bg-slate-800">Ver todos los movimientos</button></>}
      </div> : <div className="space-y-3">{filteredTransactions.map(transaction => {
        const linkedDocument = transaction.matchedCfdiId ? documents.get(transaction.matchedCfdiId) : undefined;
        const isEntry = transaction.amount > 0;
        const pending = pendingAction?.id === transaction.id;
        return <article key={transaction.id} className="rounded-2xl border border-slate-600 bg-slate-900/50 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-semibold text-white">{transaction.description}</h3><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${transaction.status === 'conciliado' ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200' : transaction.status === 'ambiguo' ? 'border-amber-800 bg-amber-950/30 text-amber-200' : 'border-slate-600 bg-slate-800 text-slate-200'}`}>
                {transaction.status === 'conciliado' ? <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> : transaction.status === 'ambiguo' ? <HelpCircle aria-hidden="true" className="h-3.5 w-3.5" /> : <FileText aria-hidden="true" className="h-3.5 w-3.5" />}{reconciliationLabels[transaction.status]}</span></div>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-300"><span>Fecha: {transaction.date}</span><span className="inline-flex items-center gap-1">{isEntry ? <ArrowDownLeft aria-hidden="true" className="h-4 w-4" /> : <ArrowUpRight aria-hidden="true" className="h-4 w-4" />}{isEntry ? 'Dinero que entró' : 'Dinero que salió'}</span></p>
              <p className="text-sm leading-relaxed text-slate-300">{reconciliationExplanation(transaction)}</p>
              {transaction.status === 'conciliado' && linkedDocument && <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onOpenCfdiDetail(linkedDocument)} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-left text-sm text-white hover:bg-slate-800"><FileText aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="min-w-0 break-words">Ver documento · {linkedDocument.nombreEmisor || linkedDocument.rfcEmisor}</span><ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /></button>
                <button type="button" disabled={pendingAction !== null} aria-busy={pending && pendingAction?.kind === 'unmatch'} onClick={() => void runAction(transaction.id, 'unmatch')} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"><Unlink aria-hidden="true" className="h-4 w-4" />{pending && pendingAction?.kind === 'unmatch' ? 'Quitando vínculo…' : 'Quitar vínculo'}</button>
                {linkedDocument.statusSat === 'no_verificado' && <span className="text-xs text-amber-200">Aún falta consultar su estado ante el SAT</span>}
              </div>}
              <details className="text-xs text-slate-400"><summary className="cursor-pointer py-1">Datos del archivo bancario</summary><p className="mt-1 break-all">Identificador de cuenta: {transaction.accountId}</p></details>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start">
              <p className="break-words font-mono text-lg font-bold text-white">{isEntry ? '+' : '-'}{money(transaction.amount, transaction.currency)}</p>
              {transaction.status === 'ambiguo' && <button type="button" onClick={() => onOpenResolver(transaction)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-200 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-100"><HelpCircle aria-hidden="true" className="h-4 w-4" />Revisar coincidencia</button>}
              {transaction.reconciliationLocked && onResumeReconciliation && <button type="button" disabled={pendingAction !== null} aria-busy={pending && pendingAction?.kind === 'resume'} onClick={() => void runAction(transaction.id, 'resume')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-teal-500 px-3 py-2 text-sm font-semibold text-teal-200 hover:bg-slate-800 disabled:opacity-50"><Search aria-hidden="true" className="h-4 w-4" />{pending && pendingAction?.kind === 'resume' ? 'Buscando…' : 'Volver a buscar'}</button>}
              {transaction.status === 'discrepancia' && !transaction.reconciliationLocked && <button type="button" onClick={() => onRequestUploadForDiscrepancy(transaction)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-teal-500 px-3 py-2 text-sm font-semibold text-teal-200 hover:bg-slate-800"><Plus aria-hidden="true" className="h-4 w-4" />Agregar comprobante</button>}
            </div>
          </div>
          {actionError?.id === transaction.id && <p role="alert" className="mt-3 rounded-lg border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-200">{actionError.message} No se confirmó el cambio; puedes volver a intentarlo.</p>}
        </article>;
      })}</div>}
    </section>

    <section id="workspace-documents" ref={documentsRef} tabIndex={-1} aria-labelledby="workspace-documents-title" className="space-y-3 scroll-mt-24 rounded-xl border-t border-slate-700 pt-5 focus-visible:outline-2 focus-visible:outline-teal-300 focus-visible:outline-offset-4">
      <h2 id="workspace-documents-title" className="font-sora text-lg font-bold text-white">Documentos cargados ({cfdis.length})</h2>
      <p className="text-sm text-slate-300">Estos importes vienen de los documentos. Cargarlos no agrega ni quita dinero en el banco. Abre un documento para revisar sus datos.</p>
      {cfdis.length === 0 ? <div className="rounded-xl border border-dashed border-slate-600 p-5 text-sm text-slate-300"><p className="font-semibold text-white">Aún no cargaste documentos</p><p className="mt-1">Agrega una factura XML, revisa un PDF o una foto, o anota un gasto mientras consigues su factura.</p></div> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{cfdis.map(record => <button key={record.id} type="button" onClick={() => onOpenCfdiDetail(record)} className="flex min-w-0 gap-3 rounded-xl border border-slate-600 bg-slate-900/50 p-4 text-left hover:border-teal-400">
        <FileText aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-teal-300" /><span className="min-w-0 flex-1 space-y-1.5">
          <span className="block text-sm font-semibold text-white">{documentCardLabel(record, profileRfc)}</span>
          <span className="block break-words text-sm text-slate-300">Emitido por: {record.nombreEmisor || record.rfcEmisor}</span>
          <span className="block text-sm text-slate-300">Fecha: {record.fechaEmision.slice(0, 10)}</span>
          <span className="block break-words text-sm font-semibold text-white">{record.tipoComprobante === 'P' ? record.paymentComplement ? `Pagos indicados en este documento: ${formatDeclaredAmount(record.paymentComplement.totalPaymentsMxn, 'MXN')}` : 'Consulta el importe del pago en el archivo XML' : `Importe del documento: ${money(record.total, record.currency || 'MXN')}`}</span>
          {record.metodoPago && <span className="block text-xs text-slate-300">Forma indicada en la factura: {record.metodoPago === 'PUE' ? 'pago de una sola vez' : 'pago posterior o en partes'}</span>}
          {record.relatedCfdis?.length ? <span className="block text-xs text-slate-300">Hace referencia a otros documentos. Puedes verlos en el detalle.</span> : null}
          {(record.tipoComprobante === 'E' || record.tipoComprobante === 'P') && <span className="block text-xs text-slate-300">Se conserva como referencia; no se vincula automáticamente a un movimiento.</span>}
          <span className={`block text-xs ${record.statusSat === 'cancelado' ? 'text-rose-200' : 'text-slate-300'}`}>{record.sourceType === 'manual' || record.sourceType === 'pdf' || record.sourceType === 'image' ? 'Anotación pendiente de la factura XML' : record.statusSat === 'no_verificado' ? 'Estado ante el SAT: pendiente de consultar' : record.statusSat === 'cancelado' ? 'Estado registrado: cancelado' : 'Estado registrado: vigente'}</span>
          <span className="block break-all text-xs text-slate-400">{record.uuidSat ? `Identificador del documento: ${record.uuidSat}` : 'Este registro no tiene un identificador fiscal'}</span>
        </span><ExternalLink aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
      </button>)}</div>}
    </section>
  </div>;
};
