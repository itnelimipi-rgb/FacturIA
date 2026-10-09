'use client';

import {useId, useRef, useState, type ChangeEvent} from 'react';
import {Upload} from 'lucide-react';
import {MAX_WORKSPACE_EXPORT_BYTES} from '../lib/workspaceExport';
import type {Profile, BankTransaction, CfdiRecord} from '../lib/types';

type Snapshot = {profile: Profile; transactions: BankTransaction[]; cfdis: CfdiRecord[]};
type RestorePreview = {
  rfc: string;
  documents: number;
  transactions: number;
  lockedTransactions: number;
  matchedTransactions: number;
};

export function WorkspaceRestoreControls({profile, occupied, onRestored}: {
  profile: Profile;
  occupied: boolean;
  onRestored: (snapshot: Snapshot) => void;
}) {
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [backup, setBackup] = useState<unknown>(null);
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const clearSelection = () => {
    setBackup(null); setFilename(''); setPreview(null); setWarning('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    if (inFlight.current || occupied) return;
    const file = event.target.files?.[0];
    setBackup(null); setFilename(''); setPreview(null); setWarning(''); setError(''); setSuccess('');
    if (!file) return;
    inFlight.current = true; setBusy(true);
    try {
      if (file.size > MAX_WORKSPACE_EXPORT_BYTES) throw new Error('El respaldo supera el límite de 25 MiB.');
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); }
      catch { throw new Error('Selecciona un archivo JSON válido de respaldo de FacturIA.'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Selecciona un archivo JSON válido de respaldo de FacturIA.');
      }
      setBackup(parsed); setFilename(file.name);
    } catch (reason) {
      if (fileInput.current) fileInput.current.value = '';
      setError(reason instanceof Error ? reason.message : 'No se pudo leer el respaldo.');
    } finally { inFlight.current = false; setBusy(false); }
  };

  const submit = async (action: 'preview' | 'restore') => {
    if (inFlight.current || occupied || !backup || (action === 'restore' && !preview)) return;
    inFlight.current = true; setBusy(true); setError(''); setSuccess('');
    if (action === 'preview') { setPreview(null); setWarning(''); }
    try {
      const response = await fetch('/api/workspace/restore', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action, backup}), cache: 'no-store',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'No se pudo restaurar el respaldo.';
        if (response.status === 409) {
          clearSelection();
          let refreshed = false;
          try {
            const current = await fetch('/api/workspace', {cache: 'no-store'});
            const snapshot = await current.json().catch(() => null);
            if (current.ok && snapshot?.profile && Array.isArray(snapshot.transactions) && Array.isArray(snapshot.cfdis)) {
              onRestored(snapshot);
              refreshed = true;
            }
          } catch { /* The conflict still needs to be shown if refreshing fails. */ }
          throw new Error(refreshed ? message : `${message} Recarga tu espacio para consultar su estado actual.`);
        }
        throw new Error(message);
      }
      if (action === 'preview') {
        if (!data?.preview || typeof data.warning !== 'string') throw new Error('No se pudo preparar la vista previa.');
        setPreview(data.preview); setWarning(data.warning);
      } else {
        if (!data?.profile || !Array.isArray(data.transactions) || !Array.isArray(data.cfdis)) {
          throw new Error('No se pudo confirmar la restauración. Recarga tu espacio para consultar su estado.');
        }
        onRestored(data);
        clearSelection();
        setSuccess('Respaldo restaurado en tu espacio. Tus datos ya están guardados.');
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo restaurar el respaldo.'); }
    finally { inFlight.current = false; setBusy(false); }
  };

  return <section aria-labelledby={`${inputId}-heading`} aria-busy={busy} className="rounded-xl border border-slate-700 p-4 space-y-3 text-xs">
    <h2 id={`${inputId}-heading`} className="font-semibold text-slate-200">Restaurar respaldo JSON</h2>
    {success && <p role="status" className="text-emerald-300">{success}</p>}
    {occupied ? !success && <p className="text-slate-400">La restauración requiere un espacio vacío; tus datos actuales se conservan.</p> : <>
      <p id={`${inputId}-help`} className="text-slate-400">Selecciona un respaldo de Mi espacio con el RFC {profile.rfc}, de hasta 25 MiB. Tu perfil actual se conserva. Revisa la vista previa antes de restaurarlo.</p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={inputId} className="font-medium text-slate-200">Archivo de respaldo</label>
        <input ref={fileInput} id={inputId} type="file" accept=".json,application/json" disabled={busy} onChange={selectFile} aria-describedby={`${inputId}-help`} className="min-w-0 max-w-full text-slate-300 file:mr-3 file:rounded-lg file:border file:border-slate-600 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200 disabled:opacity-50" />
        <button type="button" disabled={busy || !backup} onClick={() => submit('preview')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2 hover:bg-slate-800 disabled:opacity-50"><Upload className="h-3.5 w-3.5" />{busy ? 'Revisando respaldo…' : 'Ver vista previa'}</button>
        {backup !== null && <button type="button" disabled={busy} onClick={() => { clearSelection(); setError(''); }} className="rounded-lg border border-slate-600 px-3 py-2 hover:bg-slate-800 disabled:opacity-50">Cancelar</button>}
      </div>
      {preview && <div className="rounded-lg bg-slate-800/70 p-3 space-y-3">
        <p className="break-all text-slate-300">Vista previa de {filename}</p>
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div><dt className="text-slate-400">RFC</dt><dd className="font-mono text-slate-100">{preview.rfc}</dd></div>
          <div><dt className="text-slate-400">Comprobantes</dt><dd className="font-semibold">{preview.documents}</dd></div>
          <div><dt className="text-slate-400">Movimientos</dt><dd className="font-semibold">{preview.transactions}</dd></div>
          <div><dt className="text-slate-400">Conciliados</dt><dd className="font-semibold">{preview.matchedTransactions}</dd></div>
          <div><dt className="text-slate-400">Pausados</dt><dd className="font-semibold">{preview.lockedTransactions}</dd></div>
        </dl>
        <p className="text-amber-200">{warning}</p>
        <p className="text-slate-400">Sólo se restaura en un espacio vacío. Los XML se vuelven a validar; la vigencia SAT y la lista EFOS oficial no están verificadas.</p>
        <button type="button" disabled={busy} onClick={() => submit('restore')} className="rounded-lg bg-emerald-300 px-3 py-2 font-semibold text-slate-950 hover:bg-emerald-200 disabled:opacity-50">{busy ? 'Restaurando…' : 'Restaurar en mi espacio'}</button>
      </div>}
    </>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </section>;
}
