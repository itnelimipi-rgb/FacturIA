'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, ScanText, X } from 'lucide-react';
import { createProvisionalDocument, parseDocumentAmount, suggestDocumentFields } from '../lib/documentExtraction';
import { extractDocumentInBrowser } from '../lib/documentExtractionBrowser';
import type { DocumentDraft, DocumentSource, DocumentSuggestions } from '../lib/documentExtraction';
import type { ExtractionProgress, ExtractionResult } from '../lib/documentExtractionBrowser';
import type { CfdiRecord } from '../lib/types';

export type ProvisionalDocumentHandler = (document: CfdiRecord, source: DocumentSource, file: File) => void | Promise<void>;

export function DocumentExtraction({file, source, userId, rfcReceptor, demoMode, onSave, onClose}: {
  file: File; source: DocumentSource; userId: string; rfcReceptor: string; demoMode: boolean;
  onSave: ProvisionalDocumentHandler; onClose: () => void;
}) {
  const [progress, setProgress] = useState<ExtractionProgress>({label: 'Preparando lectura…', percent: 0});
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [suggestions, setSuggestions] = useState<DocumentSuggestions | null>(null);
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [reviewTotal, setReviewTotal] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void extractDocumentInBrowser(file, {signal: controller.signal, onProgress: value => { if (active) setProgress(value); }})
      .then(data => {
        if (!active) return;
        const fields = suggestDocumentFields(data.text);
        setResult(data); setSuggestions(fields); setDraft(fields.draft); setReviewTotal(fields.detectedTotal);
      }).catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'No se pudo leer el documento.');
      });
    return () => { active = false; controller.abort(); };
  }, [file]);

  const change = (field: keyof DocumentDraft, value: string) => { setDraft(current => current ? {...current, [field]: value} : null); setConfirmed(false); setError(''); };
  const total = draft && [draft.subtotal, draft.iva, draft.retenciones].every(value => parseDocumentAmount(value) !== null)
    ? Math.round((Number(parseDocumentAmount(draft.subtotal)) + Number(parseDocumentAmount(draft.iva)) - Number(parseDocumentAmount(draft.retenciones))) * 100) / 100 : null;
  const save = async () => {
    if (!draft || !confirmed || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const document = createProvisionalDocument(draft, {userId, rfcReceptor}, `provisional-${crypto.randomUUID()}`);
      if (reviewTotal && (parseDocumentAmount(reviewTotal) === null || Math.abs(document.total - Number(parseDocumentAmount(reviewTotal))) > 0.001)) {
        throw new Error('El total calculado no coincide con el total del comprobante. Revisa subtotal, impuestos y total.');
      }
      await onSave(document, source, file); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar el gasto provisional.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const inputClass = 'w-full mt-1 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-teal-300 focus:outline-none';

  return <section className="mt-4 rounded-2xl border border-slate-600 bg-slate-900 p-4 sm:p-5" aria-label="Revisar datos del documento">
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="flex items-center gap-2 font-semibold text-white"><ScanText size={18} className="text-teal-300" /> Revisar {source === 'pdf' ? 'PDF' : 'imagen'}</h3><p className="mt-1 break-all text-xs text-slate-400">{file.name}</p></div>
      <button type="button" aria-label={result ? 'Descartar documento' : 'Cancelar lectura'} disabled={saving} onClick={onClose} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 disabled:opacity-50"><X size={18} /></button>
    </div>
    <p className="mt-3 text-xs leading-relaxed text-slate-300">La lectura ocurre en tu navegador con herramientas open source. Revisa los datos antes de guardar. {demoMode ? 'La demo guarda únicamente los campos confirmados en este navegador.' : 'Al confirmar, los campos y el archivo original se guardan de forma privada en tu cuenta.'}</p>
    {!result && !error && <div className="my-5" role="status">
      <p className="flex items-center gap-2 text-sm text-teal-300"><Loader2 size={16} className="animate-spin" /> {progress.label}</p>
      <progress className="mt-3 h-2 w-full accent-teal-400" max="100" value={progress.percent} aria-label="Progreso de lectura" />
      <p className="mt-2 text-xs text-slate-400">Hasta 60 segundos. PDF: 10 páginas con texto o 3 escaneadas. Archivo: 5 MiB.</p>
      <button type="button" onClick={onClose} className="mt-3 text-xs text-slate-300 underline">Cancelar lectura</button>
    </div>}
    {draft && suggestions && result && <>
      <p className="mt-4 text-xs text-teal-300">{result.method === 'pdf-text' ? 'Texto extraído del PDF' : 'Texto reconocido con OCR'} · {result.pages} {result.pages === 1 ? 'página' : 'páginas'}</p>
      <details className="mt-3 text-xs text-slate-300"><summary className="cursor-pointer">Ver texto detectado</summary><textarea readOnly value={result.text} aria-label="Texto detectado" className={`${inputClass} h-36`} /></details>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-amber-200">{suggestions.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
      {suggestions.detectedRfcs.length > 0 && <div className="mt-3"><p className="text-xs text-slate-400">RFC encontrados. Selecciona sólo el emisor del gasto:</p><div className="mt-2 flex flex-wrap gap-2">{suggestions.detectedRfcs.map(rfc => <button key={rfc} type="button" disabled={saving} onClick={() => change('rfcEmisor', rfc)} className="rounded-md border border-slate-600 px-2 py-1 text-xs text-white hover:border-teal-300">{rfc}</button>)}</div></div>}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-300">RFC del emisor<input value={draft.rfcEmisor} onChange={event => change('rfcEmisor', event.target.value.toUpperCase())} className={inputClass} maxLength={13} autoComplete="off" disabled={saving} /></label>
        <label className="text-xs text-slate-300">Nombre del proveedor<input value={draft.nombreEmisor} onChange={event => change('nombreEmisor', event.target.value)} className={inputClass} maxLength={200} disabled={saving} /></label>
        <label className="text-xs text-slate-300">Fecha de emisión<input type="date" value={draft.fechaEmision} onChange={event => change('fechaEmision', event.target.value)} className={inputClass} disabled={saving} /></label>
        <label className="text-xs text-slate-300">Moneda<select value={draft.currency} onChange={event => change('currency', event.target.value)} className={inputClass} disabled={saving}><option value="">Confirma la moneda</option><option value="MXN">MXN — peso mexicano</option></select></label>
        <label className="text-xs text-slate-300">Subtotal<input inputMode="decimal" value={draft.subtotal} onChange={event => change('subtotal', event.target.value)} className={inputClass} maxLength={30} placeholder="Importe antes de impuestos" disabled={saving} /></label>
        <label className="text-xs text-slate-300">IVA trasladado<input inputMode="decimal" value={draft.iva} onChange={event => change('iva', event.target.value)} className={inputClass} maxLength={30} placeholder="0 sólo si lo confirmas" disabled={saving} /></label>
        <label className="text-xs text-slate-300">Retenciones totales<input inputMode="decimal" value={draft.retenciones} onChange={event => change('retenciones', event.target.value)} className={inputClass} maxLength={30} placeholder="0 sólo si lo confirmas" disabled={saving} /></label>
        <label className="text-xs text-slate-300">Total del comprobante (si aparece)<input inputMode="decimal" value={reviewTotal} onChange={event => { setReviewTotal(event.target.value); setConfirmed(false); setError(''); }} className={inputClass} maxLength={30} placeholder="Revisa el total detectado" disabled={saving} /></label>
      </div>
      <p className="mt-3 text-sm text-white">Total calculado: {total === null ? 'completa los importes' : `${total.toFixed(2)} MXN`}</p>
      <label className="mt-4 flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={saving} className="mt-0.5 accent-teal-400" /><span>Revisé proveedor, fecha e importes. Entiendo que este gasto provisional no sustituye un XML timbrado ni acredita una deducción.</span></label>
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={saving || !confirmed} onClick={() => void save()} className="rounded-lg bg-teal-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar gasto provisional'}</button><button type="button" disabled={saving} onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-white disabled:opacity-50">Descartar</button></div>
    </>}
    {error && <p role="alert" className="mt-4 flex items-start gap-2 text-xs text-rose-300"><AlertCircle size={16} className="shrink-0" />{error}</p>}
  </section>;
}
