'use client';

import {useState} from 'react';
import {Download} from 'lucide-react';
import {serializeWorkspaceBackup, serializeTransactionsCsv} from '../lib/workspaceExport';
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
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button type="button" disabled={busy} onClick={downloadBackup} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600 hover:bg-slate-800 disabled:opacity-50"><Download className="h-3.5 w-3.5" />{busy ? 'Preparando respaldo…' : 'Descargar respaldo JSON'}</button>
      <button type="button" disabled={busy || snapshot.transactions.length === 0} onClick={downloadCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600 hover:bg-slate-800 disabled:opacity-50"><Download className="h-3.5 w-3.5" />Exportar movimientos CSV</button>
      <span className="text-slate-400">Guarda tus archivos en un lugar privado.</span>
    </div>
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </div>;
}
