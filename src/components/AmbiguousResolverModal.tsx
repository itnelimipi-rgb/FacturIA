'use client';

import React, {useRef, useState} from 'react';
import type { BankTransaction, CfdiRecord } from '../lib/types';
import { candidateComparison, counterpartName, reconciliationExplanation } from '../lib/reconciliationPresentation';
import { formatDay, formatMoney, formatSignedMoney } from '../lib/format';
import { Check, Loader2 } from 'lucide-react';
import { Dialog } from './Dialog';
import { ui } from './ui';

interface AmbiguousResolverModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: BankTransaction | null;
  candidates: CfdiRecord[];
  profileRfc?: string;
  onResolve: (transactionId: string, selectedCfdiId: string) => void | Promise<void>;
}

export function AmbiguousResolverModal(props: AmbiguousResolverModalProps) {
  if (!props.isOpen || !props.transaction) return null;
  return <ResolverContent key={props.transaction.id} {...props} transaction={props.transaction} />;
}

function ResolverContent({onClose, transaction, candidates, profileRfc, onResolve}: Omit<AmbiguousResolverModalProps, 'transaction'> & {transaction: BankTransaction}) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<{id: string; message: string} | null>(null);
  const busyRef = useRef(false);

  const resolve = async (documentId: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setResolvingId(documentId);
    setError(null);
    try {await onResolve(transaction.id, documentId);}
    catch (reason) {setError({id: documentId, message: reason instanceof Error ? reason.message : 'No se pudo guardar. Inténtalo de nuevo.'});}
    finally {busyRef.current = false; setResolvingId(null);}
  };

  return <Dialog title="Elige la factura" description={reconciliationExplanation(transaction)} onClose={onClose} busy={resolvingId !== null} closeLabel="Cerrar sin elegir"
    footer={<div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-slate-400">Elegir sólo relaciona la factura con el movimiento; no mueve dinero.</p>
      <button type="button" disabled={resolvingId !== null} onClick={onClose} className={`${ui.secondary} shrink-0 whitespace-nowrap`}>Ninguna corresponde</button>
    </div>}>
    <div className="space-y-5">
      <section aria-label="Movimiento del banco" className={`${ui.softCard} p-4`}>
        <p className="text-sm text-slate-400">Movimiento del banco</p>
        <p className="mt-1 break-words font-semibold text-white">{transaction.description}</p>
        <p className="mt-1 text-sm text-slate-300">{formatDay(transaction.date)} · <span className="font-mono">{formatSignedMoney(transaction.amount, transaction.currency)}</span></p>
      </section>
      <section aria-label="Facturas posibles" className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">{candidates.length === 1 ? 'Factura posible' : `Facturas posibles (${candidates.length})`}</h3>
        {candidates.length === 0 && <p role="status" className="rounded-xl border border-white/10 p-4 text-sm text-slate-300">No hay facturas para elegir. Cierra y sube la factura que corresponde.</p>}
        {candidates.map(document => {
          const comparison = candidateComparison(transaction, document);
          return <article key={document.id} className={`${ui.card} space-y-3 p-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><h4 className="break-words font-semibold text-white">{counterpartName(document, profileRfc)}</h4><p className="text-sm text-slate-400">Emitida el {formatDay(document.fechaEmision)}</p></div>
              <p className="font-mono font-semibold text-white">{formatMoney(document.total, document.currency || 'MXN')}</p>
            </div>
            <ul className="space-y-1 text-sm text-slate-300"><li>{comparison.amount}</li><li>{comparison.date}</li>{document.conceptos?.[0]?.descripcion && <li className="break-words">Concepto: {document.conceptos[0].descripcion}</li>}</ul>
            <details className="text-xs text-slate-400"><summary className="cursor-pointer py-1">Ver RFC e identificador</summary><p className="mt-1 break-all">RFC de quien la emitió: {document.rfcEmisor}</p><p className="mt-1 break-all">Identificador: {document.uuidSat}</p></details>
            <div className="flex flex-col gap-2 sm:items-end">
              <button type="button" disabled={resolvingId !== null} aria-busy={resolvingId === document.id} onClick={() => void resolve(document.id)} className={ui.primary}>
                {resolvingId === document.id ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}{resolvingId === document.id ? 'Guardando…' : 'Usar esta factura'}
              </button>
              {error?.id === document.id && <p role="alert" className="w-full rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error.message} No se guardó; puedes intentar de nuevo.</p>}
            </div>
          </article>;
        })}
      </section>
    </div>
  </Dialog>;
}
