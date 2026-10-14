'use client';

import React, {useCallback, useId, useRef, useState} from 'react';
import type { BankTransaction, CfdiRecord } from '../lib/types';
import { candidateComparison, reconciliationExplanation } from '../lib/reconciliationPresentation';
import { useDialogFocus } from '../lib/useDialogFocus';
import { HelpCircle, Check, X } from 'lucide-react';

interface AmbiguousResolverModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: BankTransaction | null;
  candidates: CfdiRecord[];
  onResolve: (transactionId: string, selectedCfdiId: string) => void | Promise<void>;
}

export function AmbiguousResolverModal(props: AmbiguousResolverModalProps) {
  if (!props.isOpen || !props.transaction) return null;
  return <ResolverContent key={props.transaction.id} {...props} transaction={props.transaction} />;
}

function ResolverContent({onClose, transaction, candidates, onResolve}: Omit<AmbiguousResolverModalProps, 'transaction'> & {transaction: BankTransaction}) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<{id: string; message: string} | null>(null);
  const busyRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const close = useCallback(() => {if (!busyRef.current) onClose();}, [onClose]);
  const dialogRef = useDialogFocus(true, close);
  const formatCurrency = (value: number, currency: string) => new Intl.NumberFormat('es-MX', {style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2}).format(Math.abs(value));

  const resolve = async (documentId: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setResolvingId(documentId);
    setError(null);
    try {await onResolve(transaction.id, documentId);}
    catch (reason) {setError({id: documentId, message: reason instanceof Error ? reason.message : 'No se pudo guardar el vínculo. Inténtalo de nuevo.'});}
    finally {busyRef.current = false; setResolvingId(null);}
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-xs sm:p-5">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-600 bg-slate-900 text-slate-100 shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-4 sm:px-6">
        <div><h2 id={titleId} className="flex items-center gap-2 font-sora text-lg font-bold text-white"><HelpCircle aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-200" />Revisar coincidencia</h2><p id={descriptionId} className="mt-2 text-sm leading-relaxed text-slate-300">{reconciliationExplanation(transaction)}</p></div>
        <button type="button" disabled={resolvingId !== null} onClick={close} aria-label="Cerrar revisión de coincidencia" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button>
      </div>
      <div className="space-y-5 p-4 sm:p-6">
        <section aria-label="Movimiento que estás revisando" className="rounded-xl border border-slate-600 bg-slate-800/60 p-4">
          <p className="text-sm font-semibold text-slate-300">Movimiento del banco</p><h3 className="mt-1 break-words text-base font-semibold text-white">{transaction.description}</h3>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm"><p className="text-slate-300">Fecha: {transaction.date}</p><p className="font-mono font-semibold text-white">{transaction.amount > 0 ? 'Entró' : 'Salió'} {formatCurrency(transaction.amount, transaction.currency)}</p></div>
        </section>
        <section aria-label="Documentos posibles" className="space-y-3">
          <div><h3 className="text-base font-semibold text-white">{candidates.length === 1 ? 'Documento posible' : `Documentos posibles (${candidates.length})`}</h3><p className="mt-1 text-sm text-slate-300">Compara quién emitió el documento, las fechas y los importes. Elige sólo si corresponde a este movimiento.</p></div>
          {candidates.length === 0 && <p role="status" className="rounded-xl border border-slate-600 p-4 text-sm text-slate-300">No hay documentos disponibles para esta revisión. Cierra esta ventana y revisa los documentos cargados o agrega el que corresponda.</p>}
          {candidates.map(document => {
            const comparison = candidateComparison(transaction, document);
            return <article key={document.id} className="space-y-3 rounded-xl border border-slate-600 bg-slate-800/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 className="break-words text-base font-semibold text-white">{document.nombreEmisor || document.rfcEmisor}</h4><p className="mt-1 text-sm text-slate-300">Emitido el {document.fechaEmision.slice(0, 10)}</p></div><p className="font-mono font-semibold text-white">{formatCurrency(document.total, document.currency || 'MXN')}</p></div>
              <div className="space-y-1 text-sm text-slate-300"><p>{comparison.amount}</p><p>{comparison.date}</p>{document.conceptos?.[0]?.descripcion && <p className="break-words">Descripción: {document.conceptos[0].descripcion}</p>}</div>
              <details className="text-xs text-slate-400"><summary className="cursor-pointer py-1">Ver identificadores del documento</summary><p className="mt-1 break-all">RFC de quien lo emitió: {document.rfcEmisor}</p><p className="mt-1 break-all">Identificador del documento: {document.uuidSat}</p></details>
              <div className="flex flex-col gap-2 sm:items-end"><button type="button" disabled={resolvingId !== null} aria-busy={resolvingId === document.id} onClick={() => void resolve(document.id)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-200 disabled:opacity-50"><Check aria-hidden="true" className="h-4 w-4" />{resolvingId === document.id ? 'Guardando vínculo…' : 'Usar este documento'}</button>
                {error?.id === document.id && <p role="alert" className="w-full rounded-lg border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-200">{error.message} No se confirmó el vínculo; puedes volver a intentarlo.</p>}
              </div>
            </article>;
          })}
        </section>
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-700 bg-slate-800/40 px-4 py-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6"><p className="text-slate-300">Vincular sólo relaciona este movimiento y el documento. No mueve dinero ni confirma su estado ante el SAT.</p><button type="button" disabled={resolvingId !== null} onClick={close} className="min-h-11 shrink-0 rounded-lg border border-slate-600 px-3 py-2 text-white hover:bg-slate-800 disabled:opacity-50">{resolvingId !== null ? 'Guardando…' : 'Volver sin elegir'}</button></div>
    </div>
  </div>;
}
