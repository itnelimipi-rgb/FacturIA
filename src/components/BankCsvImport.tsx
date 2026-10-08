'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud } from 'lucide-react';
import { BankTransaction } from '../lib/types';
import { BankCsvResult, MAX_BANK_CSV_BYTES, parseBankCsv } from '../lib/bankCsvParser';

interface BankCsvImportProps {
  userId: string;
  accountId: string;
  onTransactionsImported: (transactions: BankTransaction[]) => void | Promise<void>;
}

export const BankCsvImport: React.FC<BankCsvImportProps> = props => <BankCsvImportSession key={JSON.stringify([props.userId, props.accountId])} {...props} />;

const BankCsvImportSession: React.FC<BankCsvImportProps> = ({ userId, accountId, onTransactionsImported }) => {
  const [preview, setPreview] = useState<BankCsvResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ success: boolean; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => () => { requestId.current++; }, []);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const currentRequest = ++requestId.current;
    setPreview(null);
    setFileName(file.name);
    setMessage(null);
    setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('Selecciona un archivo .csv.');
      if (file.size > MAX_BANK_CSV_BYTES) throw new Error('El archivo supera el límite de 2 MB.');
      const text = await file.text();
      if (currentRequest === requestId.current) setPreview(parseBankCsv(text, { userId, accountId }));
    } catch (error) {
      if (currentRequest === requestId.current) setMessage({ success: false, text: error instanceof Error ? error.message : 'No se pudo leer el archivo.' });
    } finally {
      if (currentRequest === requestId.current) setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const confirmImport = async () => {
    if (!preview?.transactions.length || preview.errors.length || busy) return;
    const count = preview.transactions.length;
    const currentRequest = ++requestId.current;
    setBusy(true);
    setMessage(null);
    try {
      await onTransactionsImported(preview.transactions);
      if (currentRequest === requestId.current) {
        setPreview(null);
        setMessage({ success: true, text: `Importación completada: ${count} filas procesadas. Los movimientos ya existentes se omiten.` });
      }
    } catch (error) {
      if (currentRequest === requestId.current) setMessage({ success: false, text: error instanceof Error ? error.message : 'No se pudieron guardar los movimientos. Intenta nuevamente.' });
    } finally {
      if (currentRequest === requestId.current) setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[oklch(0.30_0.03_260)] bg-[oklch(0.18_0.02_260)] p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-sora font-bold text-sm flex items-center gap-2 text-white"><FileSpreadsheet className="w-4 h-4 text-[oklch(0.78_0.15_195)]" /> Importar movimientos bancarios</h2>
          <p className="text-xs text-[oklch(0.68_0.03_250)] mt-1">CSV UTF-8, hasta 5,000 filas y 2 MB. Cuenta: <span className="font-mono">{accountId}</span></p>
        </div>
        <button type="button" disabled={busy || !userId || !accountId} onClick={() => inputRef.current?.click()} className="px-3 py-2 rounded-xl border border-[oklch(0.30_0.03_260)] text-xs text-white hover:bg-[oklch(0.24_0.028_260)] disabled:opacity-50 flex items-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />} Seleccionar CSV
        </button>
        <input ref={inputRef} type="file" accept=".csv,text/csv" aria-label="Archivo CSV de movimientos bancarios" className="hidden" onChange={event => void readFile(event.target.files?.[0])} />
      </div>
      <div className="text-xs text-[oklch(0.68_0.03_250)] leading-relaxed">
        <p>Encabezados: <code className="text-[oklch(0.78_0.15_195)]">fecha,descripcion,monto,moneda</code>. Moneda es opcional (MXN). Acepta coma o punto y coma entre columnas.</p>
        <p>Fecha: AAAA-MM-DD o DD-MM-AAAA. Monto: punto decimal y sin separadores de miles; cargos negativos y depósitos positivos.</p>
        <pre className="mt-2 rounded-lg bg-[oklch(0.21_0.025_260)] p-2 overflow-x-auto text-[11px]">{'fecha,descripcion,monto,moneda\n2026-10-08,Pago proveedor,-12400.00,MXN'}</pre>
      </div>
      {preview && (
        <div className="space-y-3">
          <p className="text-xs text-white break-all">{fileName}</p>
          {preview.errors.length > 0 ? (
            <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/30 p-3 text-xs text-rose-200">
              <p className="font-semibold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Corrige {preview.errors.length} error(es) antes de importar. No se guardó ninguna fila.</p>
              <ul className="mt-2 list-disc pl-4 space-y-1">{preview.errors.slice(0, 8).map((error, index) => <li key={`${error.row}-${index}`}>Línea {error.row}: {error.message}</li>)}</ul>
              {preview.errors.length > 8 && <p className="mt-2">Se muestran los primeros 8 errores.</p>}
            </div>
          ) : (
            <>
              <p className="text-xs text-[oklch(0.72_0.17_155)]">{preview.transactions.length} movimientos válidos. Vista previa de los primeros 5:</p>
              <div className="overflow-x-auto rounded-xl border border-[oklch(0.30_0.03_260)]">
                <table className="w-full text-xs text-left">
                  <thead className="text-[oklch(0.68_0.03_250)] bg-[oklch(0.21_0.025_260)]"><tr><th className="p-2">Fecha</th><th className="p-2">Descripción</th><th className="p-2 text-right">Monto</th></tr></thead>
                  <tbody>{preview.transactions.slice(0, 5).map(transaction => <tr key={transaction.id} className="border-t border-[oklch(0.30_0.03_260)] text-white"><td className="p-2 whitespace-nowrap">{transaction.date}</td><td className="p-2 max-w-sm break-words">{transaction.description}</td><td className="p-2 text-right whitespace-nowrap font-mono">{transaction.amount.toFixed(2)} {transaction.currency}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" disabled={busy} onClick={() => { setPreview(null); setFileName(''); }} className="px-3 py-2 text-xs text-[oklch(0.68_0.03_250)] disabled:opacity-50">Cancelar</button>
                <button type="button" disabled={busy} onClick={() => void confirmImport()} className="px-3 py-2 rounded-xl bg-[oklch(0.78_0.15_195)] text-[oklch(0.15_0.03_260)] font-bold text-xs disabled:opacity-50 flex items-center gap-2">{busy && <Loader2 className="w-3 h-3 animate-spin" />} Importar {preview.transactions.length} movimientos</button>
              </div>
            </>
          )}
        </div>
      )}
      {message && <p role={message.success ? 'status' : 'alert'} className={`flex items-start gap-2 text-xs ${message.success ? 'text-[oklch(0.72_0.17_155)]' : 'text-rose-300'}`}>{message.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}{message.text}</p>}
    </section>
  );
};
