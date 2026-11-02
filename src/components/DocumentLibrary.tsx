'use client';

import React, {useId, useState} from 'react';
import type {BankTransaction, CfdiRecord} from '../lib/types';
import {counterpartName, documentCardLabel} from '../lib/reconciliationPresentation';
import {documentAmountText} from '../lib/documentSummary';
import {formatDay} from '../lib/format';
import {searchable} from '../lib/text';
import {ChevronRight, FileText, Link2, Search, UploadCloud} from 'lucide-react';
import {ui} from './ui';

interface DocumentLibraryProps {
  cfdis: CfdiRecord[];
  onOpenCfdiDetail: (cfdi: CfdiRecord) => void;
  profileRfc?: string;
  transactions?: BankTransaction[];
  onUpload?: () => void;
}

const normalizeSearch = searchable;

/** Search the displayed document metadata without changing or interpreting its source. */
export function searchDocumentRecords(records: CfdiRecord[], query: string, profileRfc?: string): CfdiRecord[] {
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return records;
  return records.filter(record => {
    const writtenDate = record.fechaEmision.slice(0, 10);
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(writtenDate);
    const dateAlternative = parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : '';
    const text = normalizeSearch([
      record.nombreEmisor ?? '', record.rfcEmisor, record.nombreReceptor ?? '', record.rfcReceptor,
      record.uuidSat, writtenDate, dateAlternative, documentCardLabel(record, profileRfc), record.total.toFixed(2),
      ...(record.conceptos?.map(concept => concept.descripcion) ?? []),
    ].join(' '));
    return terms.every(term => text.includes(term));
  });
}

function documentNote(record: CfdiRecord, linked: boolean): {text: string; linked?: boolean; alert?: boolean} {
  if (['manual', 'pdf', 'image'].includes(record.sourceType ?? '')) return {text: 'Gasto sin factura XML'};
  if (record.statusSat === 'cancelado') return {text: 'Cancelada', alert: true};
  if (record.isEfos) return {text: 'Proveedor con alerta: revísala antes de usarla', alert: true};
  if (record.tipoComprobante === 'E') return {text: 'Ajuste a una factura; no cambia tus movimientos'};
  if (record.tipoComprobante === 'P') return {text: 'Registra un pago; no cambia tus movimientos'};
  if (record.tipoComprobante !== 'I') return {text: 'Se conserva como referencia'};
  return linked ? {text: 'Vinculada a un movimiento', linked: true} : {text: 'Sin movimiento vinculado'};
}

export function DocumentLibrary({cfdis, onOpenCfdiDetail, profileRfc, transactions = [], onUpload}: DocumentLibraryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const searchId = useId();
  const linkedIds = new Set(transactions.flatMap(transaction => transaction.status === 'conciliado' && transaction.matchedCfdiId ? [transaction.matchedCfdiId] : []));
  const records = searchDocumentRecords(cfdis, searchTerm, profileRfc).toSorted((left, right) => right.fechaEmision.localeCompare(left.fechaEmision));

  return <section id="workspace-documents" tabIndex={-1} aria-labelledby="workspace-documents-title" className="space-y-4 scroll-mt-24 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200">
    <h2 id="workspace-documents-title" className="sr-only">Documentos cargados ({cfdis.length})</h2>
    {cfdis.length > 0 && <div className="space-y-2">
      <label htmlFor={searchId} className="relative block sm:max-w-md">
        <span className="sr-only">Buscar un documento</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
        <input id={searchId} type="search" placeholder="Buscar por nombre, RFC, fecha o descripción" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className={`${ui.input} mt-0 pl-9 text-sm`} />
      </label>
      {searchTerm.trim() && <p role="status" className="text-sm text-slate-300">Mostrando {records.length} de {cfdis.length}. <button type="button" onClick={() => setSearchTerm('')} className={ui.link}>Limpiar búsqueda</button></p>}
    </div>}
    {cfdis.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 p-6 text-slate-300">
      <h3 className="font-semibold text-white">Aún no hay documentos</h3>
      <p className="mt-1 text-sm">Sube tus facturas XML o la foto de un ticket.</p>
      {onUpload && <button type="button" onClick={onUpload} className={`${ui.primary} mt-4`}><UploadCloud aria-hidden="true" className="h-4 w-4" />Subir archivos</button>}
    </div> : records.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 p-6 text-slate-300">
      <h3 className="font-semibold text-white">No encontramos documentos con esa búsqueda</h3>
      <p className="mt-1 text-sm">Prueba con el nombre de quien la emitió, su RFC, una fecha o la descripción.</p>
    </div> : <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">{records.map(record => {
      const note = documentNote(record, linkedIds.has(record.id));
      return <li key={record.id}>
        <button type="button" onClick={() => onOpenCfdiDetail(record)} className={`${ui.card} flex w-full min-w-0 items-start gap-3 p-4 text-left transition hover:border-cyan-300/40 ${ui.focus}`}>
          <FileText aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-start justify-between gap-x-3">
              <span className="min-w-0 break-words font-semibold text-white">{counterpartName(record, profileRfc)}</span>
              <span className="shrink-0 font-mono font-semibold text-white">{documentAmountText(record)}</span>
            </span>
            <span className="block text-sm text-slate-400">{documentCardLabel(record, profileRfc)} · {formatDay(record.fechaEmision)}</span>
            {record.conceptos?.[0]?.descripcion && <span className="mt-1 block break-words text-sm text-slate-300">{record.conceptos[0].descripcion}</span>}
            <span className={`mt-1.5 inline-flex items-center gap-1 text-xs ${note.linked ? 'text-emerald-300' : note.alert ? 'text-rose-200' : 'text-slate-400'}`}>{note.linked && <Link2 aria-hidden="true" className="h-3.5 w-3.5" />}{note.text}</span>
          </span>
          <ChevronRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        </button>
      </li>;
    })}</ul>}
  </section>;
}
