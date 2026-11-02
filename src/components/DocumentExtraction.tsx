'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { AlertCircle, Loader2, ScanText, Sparkles } from 'lucide-react';
import { createProvisionalDocument, parseDocumentAmount, suggestDocumentFields } from '../lib/documentExtraction';
import { extractDocumentInBrowser } from '../lib/documentExtractionBrowser';
import type { DocumentDraft, DocumentSource } from '../lib/documentExtraction';
import type { ExtractionProgress } from '../lib/documentExtractionBrowser';
import type { CfdiRecord } from '../lib/types';
import { formatMoney } from '../lib/format';
import { ui } from './ui';

export type ProvisionalDocumentHandler = (document: CfdiRecord, source: DocumentSource, file: File) => void | Promise<void>;

type Reading = {draft: DocumentDraft; total: string; concept: string; method: 'ai' | 'pdf-text' | 'ocr'; notice?: string};

async function readWithAi(file: File, signal: AbortSignal): Promise<Reading> {
  const body = new FormData();
  body.set('file', file);
  const response = await fetch('/api/ai/extract', {method: 'POST', body, signal});
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.draft) throw new Error(typeof data?.error === 'string' ? data.error : 'No se pudo leer con IA.');
  const notice = data.foreignCurrency ? `El comprobante está en ${data.foreignCurrency}. Por ahora sólo se guardan gastos en pesos (MXN).`
    : data.isReceipt === false ? 'Este archivo no parece un ticket o comprobante. Revisa los datos antes de guardar.' : undefined;
  return {draft: data.draft, total: data.total ?? '', concept: data.concept ?? '', method: 'ai', notice};
}

async function readInBrowser(file: File, signal: AbortSignal, onProgress: (value: ExtractionProgress) => void): Promise<Reading> {
  const result = await extractDocumentInBrowser(file, {signal, onProgress});
  const fields = suggestDocumentFields(result.text);
  return {draft: fields.draft, total: fields.detectedTotal, concept: '', method: result.method};
}

/** With exactly one breakdown value missing, the written total determines it; nothing else is assumed. */
function completeBreakdown(draft: DocumentDraft, total: string): DocumentDraft {
  const known = parseDocumentAmount(total);
  if (known === null) return draft;
  const values = {subtotal: parseDocumentAmount(draft.subtotal), iva: parseDocumentAmount(draft.iva), retenciones: parseDocumentAmount(draft.retenciones)};
  const missing = (Object.keys(values) as Array<keyof typeof values>).filter(key => values[key] === null);
  if (missing.length !== 1) return draft;
  const cents = (value: string | null) => Math.round(Number(value) * 100);
  const [field] = missing;
  const result = field === 'subtotal' ? cents(known) - cents(values.iva) + cents(values.retenciones)
    : field === 'iva' ? cents(known) - cents(values.subtotal) + cents(values.retenciones)
    : cents(values.subtotal) + cents(values.iva) - cents(known);
  return result >= 0 ? {...draft, [field]: (result / 100).toFixed(2)} : draft;
}

/** Review a ticket or invoice PDF/photo before saving it as a provisional expense. */
export function DocumentExtraction({file, source, userId, rfcReceptor, demoMode, aiEnabled = false, onSave, onClose}: {
  file: File; source: DocumentSource; userId: string; rfcReceptor: string; demoMode: boolean; aiEnabled?: boolean;
  onSave: ProvisionalDocumentHandler; onClose: () => void;
}) {
  const [progress, setProgress] = useState<ExtractionProgress>({label: aiEnabled && !demoMode ? 'Leyendo con IA…' : 'Preparando lectura…', percent: 0});
  const [reading, setReading] = useState<Reading | null>(null);
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [total, setTotal] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const update = (value: ExtractionProgress) => { if (active) setProgress(value); };
    const read = async (): Promise<Reading> => {
      if (aiEnabled && !demoMode) {
        try { return await readWithAi(file, controller.signal); }
        catch (reason) {
          if (controller.signal.aborted) throw reason;
          const fallback = await readInBrowser(file, controller.signal, update);
          return {...fallback, notice: 'No se pudo usar la IA; leímos el archivo en tu dispositivo. Revisa los datos con más cuidado.'};
        }
      }
      return readInBrowser(file, controller.signal, update);
    };
    void read().then(result => {
      if (!active) return;
      setReading(result); setTotal(result.total); setDraft(completeBreakdown(result.draft, result.total));
    }).catch(reason => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'No se pudo leer el documento.');
      setDraft({rfcEmisor: '', nombreEmisor: '', fechaEmision: '', subtotal: '', iva: '', retenciones: '', currency: 'MXN'});
    });
    return () => { active = false; controller.abort(); };
  }, [file, aiEnabled, demoMode]);

  const change = (field: keyof DocumentDraft, value: string) => { setDraft(current => current ? {...current, [field]: value} : null); setError(''); };
  const amounts = draft ? [draft.subtotal, draft.iva, draft.retenciones].map(parseDocumentAmount) : [];
  const computed = amounts.length && amounts.every(value => value !== null)
    ? Math.round((Number(amounts[0]) + Number(amounts[1]) - Number(amounts[2])) * 100) / 100 : null;
  const save = async () => {
    if (!draft || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const document = createProvisionalDocument(draft, {userId, rfcReceptor}, `provisional-${crypto.randomUUID()}`);
      const written = parseDocumentAmount(total);
      if (total.trim() && (written === null || Math.abs(document.total - Number(written)) > 0.001)) {
        throw new Error('Subtotal + IVA − retenciones no da el total del comprobante. Revisa los importes.');
      }
      if (reading?.concept) document.conceptos = [{descripcion: reading.concept, importe: document.subtotal}];
      await onSave(document, source, file);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar el gasto.'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const field = (name: keyof DocumentDraft, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) =>
    <label className={ui.label}>{label}<input value={draft?.[name] ?? ''} onChange={event => change(name, name === 'rfcEmisor' ? event.target.value.toUpperCase() : event.target.value)} disabled={saving} className={ui.input} {...props} /></label>;

  return <section className="space-y-4" aria-label="Revisar datos del comprobante">
    <div className="flex items-start gap-3">
      <span className="rounded-xl bg-cyan-300/10 p-2 text-cyan-200"><ScanText aria-hidden="true" className="h-5 w-5" /></span>
      <div className="min-w-0"><h3 className="text-base font-semibold text-white">Revisa los datos del comprobante</h3><p className="break-all text-sm text-slate-400">{file.name}</p></div>
    </div>
    {!draft && <div role="status" className="space-y-3 py-4">
      <p className="flex items-center gap-2 text-sm text-cyan-200"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />{progress.label}</p>
      {progress.percent > 0 && <progress className="h-2 w-full accent-cyan-300" max="100" value={progress.percent} aria-label="Progreso de lectura" />}
      <button type="button" onClick={onClose} className={ui.quiet}>Cancelar</button>
    </div>}
    {draft && <>
      {reading && <p className="flex items-start gap-2 text-sm text-slate-300">{reading.method === 'ai' ? <Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" /> : null}
        {reading.method === 'ai' ? 'Llenamos los datos con IA. Compáralos con tu comprobante antes de guardar.' : 'Llenamos lo que pudimos leer. Completa o corrige lo que falte.'}</p>}
      {reading?.notice && <p className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-100">{reading.notice}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('nombreEmisor', 'Proveedor', {maxLength: 200, placeholder: 'Nombre del negocio'})}
        {field('rfcEmisor', 'RFC del proveedor', {maxLength: 13, autoComplete: 'off', placeholder: 'Aparece en el ticket', className: `${ui.input} font-mono uppercase`})}
        {field('fechaEmision', 'Fecha', {type: 'date'})}
        <label className={ui.label}>Total del comprobante<input value={total} onChange={event => { setTotal(event.target.value); setError(''); }} onBlur={() => draft && setDraft(completeBreakdown(draft, total))} inputMode="decimal" disabled={saving} maxLength={30} placeholder="0.00" className={`${ui.input} font-mono`} /></label>
      </div>
      <fieldset className="rounded-xl border border-white/10 p-3">
        <legend className="px-1 text-sm text-slate-300">Desglose que aparece en el comprobante</legend>
        <div className="grid grid-cols-3 gap-2">
          {field('subtotal', 'Subtotal', {inputMode: 'decimal', maxLength: 30, className: `${ui.input} font-mono`})}
          {field('iva', 'IVA', {inputMode: 'decimal', maxLength: 30, className: `${ui.input} font-mono`})}
          {field('retenciones', 'Retenciones', {inputMode: 'decimal', maxLength: 30, placeholder: '0', className: `${ui.input} font-mono`})}
        </div>
        <p className="mt-2 text-xs text-slate-400">{computed === null ? 'Escribe los importes tal como aparecen; usa 0 sólo si el comprobante no lo incluye.' : `Subtotal + IVA − retenciones = ${formatMoney(computed)}`}</p>
      </fieldset>
      <p className="text-xs text-slate-400">Se guarda como gasto sin factura XML. {demoMode ? 'En la demo se guardan los datos, no el archivo.' : 'El archivo original queda guardado en tu cuenta.'}</p>
    </>}
    {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200"><AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
    {draft && <div className="flex flex-wrap justify-end gap-2">
      <button type="button" disabled={saving} onClick={onClose} className={ui.quiet}>Descartar</button>
      <button type="button" disabled={saving} onClick={() => void save()} className={ui.primary}>{saving && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}{saving ? 'Guardando…' : 'Guardar gasto'}</button>
    </div>}
  </section>;
}
