'use client';

import React from 'react';
import {ArrowRight, FileText, Landmark} from 'lucide-react';
import {getGettingStartedState} from '../lib/gettingStarted';
import type {BankTransaction, CfdiRecord} from '../lib/types';

export function GettingStarted({transactions, documents, demoMode, onAddDocuments, onAddMovements, onReview}: {
  transactions: BankTransaction[]; documents: CfdiRecord[]; demoMode: boolean;
  onAddDocuments: () => void; onAddMovements: () => void;
  onReview: (filter: 'all'|'ambiguo'|'discrepancia') => void;
}) {
  const state = getGettingStartedState(transactions, documents);
  return <section className="rounded-2xl border border-[oklch(0.30_0.03_260)] bg-[oklch(0.21_0.025_260)] p-5 sm:p-7 space-y-5" aria-labelledby="getting-started-title">
    <div>
      <p className="text-sm text-[oklch(0.78_0.15_195)] mb-2">{demoMode ? 'Prueba con los ejemplos' : 'Tu siguiente paso'}</p>
      <h1 id="getting-started-title" className="font-sora text-xl sm:text-2xl font-semibold text-white">{state.title}</h1>
      <p className="mt-3 text-base text-slate-300 max-w-3xl">FacturIA compara los movimientos que cargas del banco con tus documentos para encontrar cuáles corresponden entre sí.</p>
    </div>
    {state.transactionCount > 0 && <div className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Acciones para revisar tus movimientos">
      {state.review > 0 && <button type="button" onClick={() => onReview('ambiguo')} className="rounded-lg px-4 py-2.5 bg-cyan-200 text-slate-950 font-semibold text-sm">Revisar {state.review} coincidencia{state.review === 1 ? '' : 's'}</button>}
      {state.unlinked > 0 && <button type="button" onClick={() => onReview('discrepancia')} className="rounded-lg px-4 py-2.5 border border-slate-500 text-white font-semibold text-sm">Ver {state.unlinked} sin documento vinculado</button>}
      {state.review + state.unlinked === 0 && <button type="button" onClick={() => onReview('all')} className="rounded-lg px-4 py-2.5 border border-slate-500 text-white text-sm">Revisar los documentos vinculados</button>}
    </div>}
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-3 rounded-xl bg-[oklch(0.18_0.02_260)] p-4">
        <h2 className="font-semibold text-white flex gap-2 items-center"><FileText className="w-5 h-5 shrink-0" />Tus documentos</h2>
        <p className="text-sm text-slate-300">{state.documentCount ? `${state.documentCount} documentos cargados. Puedes agregar más o consultar sus datos.` : 'Agrega el XML de una factura, o revisa los datos de un PDF o una foto para anotar un gasto.'}</p>
        {state.documentCount > 0 && state.invoices === 0 && <p className="text-sm text-amber-200">Para buscar una relación con el banco necesitas facturas XML; los pagos, notas y gastos provisionales se consultan por separado.</p>}
        <button type="button" onClick={onAddDocuments} className="inline-flex gap-2 items-center text-sm font-semibold text-cyan-200 underline underline-offset-4">Agregar documentos<ArrowRight className="h-4 w-4" /></button>
      </div>
      <div className="space-y-3 rounded-xl bg-[oklch(0.18_0.02_260)] p-4">
        <h2 className="font-semibold text-white flex gap-2 items-center"><Landmark className="w-5 h-5 shrink-0" />Movimientos de tu banco</h2>
        <p className="text-sm text-slate-300">{state.transactionCount ? `${state.transactionCount} movimientos cargados; ${state.matched} tienen documento vinculado.` : 'Carga un archivo CSV con el dinero que entró y salió. Puedes descargar una plantilla para prepararlo.'}</p>
        <button type="button" onClick={onAddMovements} className="inline-flex gap-2 items-center text-sm font-semibold text-cyan-200 underline underline-offset-4">Agregar movimientos<ArrowRight className="h-4 w-4" /></button>
      </div>
    </div>
    <p className="text-sm text-slate-300">Puedes cargar los archivos en cualquier orden. Esta carga no conecta tu banco ni mueve dinero. Un documento vinculado todavía puede necesitar revisión.</p>
  </section>;
}
