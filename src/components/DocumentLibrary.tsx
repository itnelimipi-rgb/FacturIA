'use client';

import React, {useId, useState} from 'react';
import type {CfdiRecord} from '../lib/types';
import {formatDeclaredAmount} from '../lib/documentSummary';
import {documentCardLabel} from '../lib/reconciliationPresentation';
import {ExternalLink, FileText, Search} from 'lucide-react';

interface DocumentLibraryProps {
  cfdis: CfdiRecord[];
  onOpenCfdiDetail: (cfdi: CfdiRecord) => void;
  profileRfc?: string;
}

const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

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
      record.uuidSat, writtenDate, dateAlternative, documentCardLabel(record, profileRfc),
      ...(record.conceptos?.map(concept => concept.descripcion) ?? []),
    ].join(' '));
    return terms.every(term => text.includes(term));
  });
}

const money = (value: number, currency: string) => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2,
}).format(Math.abs(value));

export function DocumentLibrary({cfdis, onOpenCfdiDetail, profileRfc}: DocumentLibraryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const searchId = useId();
  const records = searchDocumentRecords(cfdis, searchTerm, profileRfc);

  return <section id="workspace-documents" tabIndex={-1} aria-labelledby="workspace-documents-title" className="space-y-4 scroll-mt-24 rounded-xl focus-visible:outline-2 focus-visible:outline-teal-300 focus-visible:outline-offset-4">
    <div><h2 id="workspace-documents-title" className="font-sora text-lg font-bold text-white">Documentos cargados ({cfdis.length})</h2><p className="mt-1 text-sm text-slate-300">Estos importes vienen de los documentos. Cargarlos no agrega ni quita dinero en el banco. Abre un documento para revisar sus datos.</p></div>
    {cfdis.length > 0 && <div className="space-y-2"><label htmlFor={searchId} className="block text-sm text-slate-300">Buscar un documento<span className="relative mt-1 block"><Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input id={searchId} type="search" placeholder="Nombre, RFC, identificador, fecha o descripción" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-600 bg-slate-900 py-2 pl-10 pr-3 text-sm text-white placeholder:text-slate-400" /></span></label>{searchTerm.trim() && <p role="status" className="text-sm text-slate-300">Mostrando {records.length} de {cfdis.length} documentos. <button type="button" onClick={() => setSearchTerm('')} className="min-h-11 rounded-lg px-2 py-2 text-teal-200 underline underline-offset-4 hover:bg-slate-800">Limpiar búsqueda</button></p>}</div>}
    {cfdis.length === 0 ? <div className="rounded-xl border border-dashed border-slate-600 p-5 text-sm text-slate-300"><p className="font-semibold text-white">Aún no cargaste documentos</p><p className="mt-1">Agrega una factura XML, revisa un PDF o una foto, o anota un gasto mientras consigues su factura.</p></div> : records.length === 0 ? <div className="rounded-xl border border-dashed border-slate-600 p-5 text-sm text-slate-300"><h3 className="font-semibold text-white">No encontramos documentos con esa búsqueda</h3><p className="mt-1">Prueba el nombre de quien lo emitió o recibió, su RFC, el identificador, una fecha o su descripción. Tus documentos siguen guardados.</p></div> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{records.map(record => <button key={record.id} type="button" onClick={() => onOpenCfdiDetail(record)} className="flex min-w-0 gap-3 rounded-xl border border-slate-600 bg-slate-900/50 p-4 text-left hover:border-teal-400">
      <FileText aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-teal-300" /><span className="min-w-0 flex-1 space-y-1.5">
        <span className="block text-sm font-semibold text-white">{documentCardLabel(record, profileRfc)}</span>
        <span className="block break-words text-sm text-slate-300">Emitido por: {record.nombreEmisor || record.rfcEmisor}</span>
        <span className="block break-words text-xs text-slate-300">Para: {record.nombreReceptor || record.rfcReceptor}</span>
        <span className="block text-sm text-slate-300">Fecha: {record.fechaEmision.slice(0, 10)}</span>
        {record.conceptos?.[0]?.descripcion && <span className="block break-words text-xs text-slate-300">Descripción: {record.conceptos[0].descripcion}</span>}
        <span className="block break-words text-sm font-semibold text-white">{record.tipoComprobante === 'P' ? record.paymentComplement ? `Pagos indicados en este documento: ${formatDeclaredAmount(record.paymentComplement.totalPaymentsMxn, 'MXN')}` : 'Consulta el importe del pago en el archivo XML' : `Importe del documento: ${money(record.total, record.currency || 'MXN')}`}</span>
        {record.metodoPago && <span className="block text-xs text-slate-300">Forma indicada en la factura: {record.metodoPago === 'PUE' ? 'pago de una sola vez' : 'pago posterior o en partes'}</span>}
        {record.relatedCfdis?.length ? <span className="block text-xs text-slate-300">Hace referencia a otros documentos. Puedes verlos en el detalle.</span> : null}
        {(record.tipoComprobante === 'E' || record.tipoComprobante === 'P') && <span className="block text-xs text-slate-300">Se conserva como referencia; no se vincula automáticamente a un movimiento.</span>}
        <span className={`block text-xs ${record.statusSat === 'cancelado' ? 'text-rose-200' : 'text-slate-300'}`}>{record.sourceType === 'manual' || record.sourceType === 'pdf' || record.sourceType === 'image' ? 'Anotación pendiente de la factura XML' : record.statusSat === 'no_verificado' ? 'Estado ante el SAT: pendiente de consultar' : record.statusSat === 'cancelado' ? 'Estado registrado: cancelado' : 'Estado registrado: vigente'}</span>
        <span className="block break-all text-xs text-slate-400">{record.uuidSat ? `Identificador del documento: ${record.uuidSat}` : 'Este registro no tiene un identificador fiscal'}</span>
      </span><ExternalLink aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
    </button>)}</div>}
  </section>;
}
