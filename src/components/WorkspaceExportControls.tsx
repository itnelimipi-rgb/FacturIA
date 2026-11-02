'use client';

import {useState, type ReactNode} from 'react';
import {Download} from 'lucide-react';
import {serializeWorkspaceBackup, serializeTransactionsCsv, serializeDocumentsCsv} from '../lib/workspaceExport';
import type {Profile, BankTransaction, CfdiRecord} from '../lib/types';

type Snapshot = {profile: Profile; transactions: BankTransaction[]; cfdis: CfdiRecord[]};
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  // Keep the URL alive until the browser has started consuming the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WorkspaceExportControls({mode, snapshot}: {mode: 'demo' | 'workspace'; snapshot: Snapshot}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const downloadBackup = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      let blob: Blob;
      if (mode === 'workspace') {
        const response = await fetch('/api/workspace/export', {cache: 'no-store'});
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'No se pudo descargar el respaldo.');
        }
        blob = await response.blob();
      } else blob = new Blob([serializeWorkspaceBackup(snapshot, {mode})], {type: 'application/json;charset=utf-8'});
      if (blob.size > MAX_DOWNLOAD_BYTES) throw new Error('El respaldo supera el límite de descarga de 25 MB.');
      saveDownload(blob, `facturia-${mode}-respaldo-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'No se pudo exportar el respaldo.');}
    finally {setBusy(false);}
  };
  const downloadCsv = () => {
    setError('');
    try {
      saveDownload(new Blob([serializeTransactionsCsv(snapshot)], {type: 'text/csv;charset=utf-8'}), `facturia-${mode}-movimientos.csv`);
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'No se pudo exportar el CSV.');}
  };
  const downloadDocuments = () => {
    setError('');
    try {saveDownload(new Blob([serializeDocumentsCsv(snapshot)], {type:'text/csv;charset=utf-8'}), `facturia-${mode}-comprobantes.csv`);}
    catch (reason) {setError(reason instanceof Error ? reason.message : 'No se pudo exportar el reporte documental.');}
  };
  const button = 'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200';
  const row = (title: string, detail: string, onClick: () => void, disabled: boolean, label: ReactNode = 'Descargar') => <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
    <div><p className="font-semibold text-white">{title}</p><p className="text-sm text-slate-400">{detail}</p></div>
    <button type="button" disabled={disabled} onClick={onClick} aria-label={`Descargar ${title.toLowerCase()}`} className={button}><Download aria-hidden="true" className="h-4 w-4" />{label}</button>
  </li>;
  return <div className="space-y-2">
    <ul className="divide-y divide-white/10">
      {row('Movimientos en Excel', 'Archivo CSV con cada movimiento y su factura, para tu contador.', downloadCsv, busy || snapshot.transactions.length === 0)}
      {row('Facturas y documentos en Excel', 'Archivo CSV con tus documentos e importes.', downloadDocuments, busy || snapshot.cfdis.length === 0)}
      {row('Copia de seguridad', mode === 'demo' ? 'Copia de los ejemplos de la demo; no se puede usar en una cuenta.' : 'Tus registros y XML originales (.json). Los PDF y fotos se descargan desde cada documento.', () => void downloadBackup(), busy, busy ? 'Preparando…' : 'Descargar')}
    </ul>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
  </div>;
}
