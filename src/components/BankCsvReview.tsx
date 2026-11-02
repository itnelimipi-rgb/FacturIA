'use client';

import React, {useMemo, useState} from 'react';
import {AlertCircle, CheckCircle2, Loader2, Trash2} from 'lucide-react';
import {revalidateBankCsv, type BankCsvContext, type BankCsvResult, type BankCsvRow, type BankCsvRowFields} from '../lib/bankCsvParser';
import {summarizeLoadedMovements, describeLoadedDates} from '../lib/dashboardPresentation';
import {formatDay, formatMoney, formatSignedMoney} from '../lib/format';
import type {BankTransaction} from '../lib/types';
import {ui} from './ui';

/** Preview of a bank file: rows with errors are fixed or removed here, never in another program. */
export function BankCsvReview({fileName, initial, context, busy, error, onConfirm, onCancel}: {
  fileName: string; initial: BankCsvResult; context: BankCsvContext; busy: boolean; error?: string;
  onConfirm: (transactions: BankTransaction[]) => void; onCancel: () => void;
}) {
  const [rows, setRows] = useState<BankCsvRow[]>(initial.rows);
  const [problemLines] = useState(() => initial.errors.filter(item => item.fields).map(item => item.row));
  const result = useMemo(() => rows === initial.rows ? initial : revalidateBankCsv(initial, rows, context), [rows, initial, context]);
  const errorsByLine = new Map(result.errors.map(item => [item.row, item.message]));
  const summary = summarizeLoadedMovements(result.validTransactions);
  const remaining = result.errors.length;
  const visibleProblems = problemLines.filter(line => rows.some(row => row.line === line));
  const removedCount = problemLines.length - visibleProblems.length;

  const edit = (line: number, field: keyof BankCsvRowFields, value: string) => setRows(current => current.map(row => row.line === line ? {...row, fields: {...row.fields, [field]: value}} : row));
  const remove = (line: number) => setRows(current => current.filter(row => row.line !== line));

  return <section aria-label="Revisar movimientos del banco" className="space-y-5">
    <div>
      <h3 className="text-base font-semibold text-white">Movimientos de {fileName}</h3>
      {result.layout && <p className="mt-1 text-sm text-slate-400">Columnas que usamos: {result.layout.columns.join(' · ')}</p>}
    </div>

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className={`${ui.softCard} p-4`}><p className="text-sm text-slate-400">Movimientos listos</p><p className="mt-1 font-mono text-2xl font-semibold text-white">{result.validTransactions.length}</p><p className="mt-1 text-xs text-slate-400">{summary.dateRange ? describeLoadedDates(summary.dateRange) : 'Sin fechas válidas todavía'}</p></div>
      {summary.totals.slice(0, 1).map(total => <React.Fragment key={total.currency}>
        <div className={`${ui.softCard} p-4`}><p className="text-sm text-slate-400">Entró</p><p className="mt-1 break-words font-mono text-lg font-semibold text-emerald-300">{formatMoney(total.incoming, total.currency)}</p></div>
        <div className={`${ui.softCard} p-4`}><p className="text-sm text-slate-400">Salió</p><p className="mt-1 break-words font-mono text-lg font-semibold text-white">{formatMoney(total.outgoing, total.currency)}</p></div>
      </React.Fragment>)}
    </div>
    {summary.totals.length > 1 && <p className="text-sm text-slate-400">También hay movimientos en {summary.totals.slice(1).map(total => total.currency).join(', ')}. Cada moneda se suma por separado.</p>}

    {visibleProblems.length > 0 && <div className="space-y-3 rounded-xl border border-amber-700/60 bg-amber-950/30 p-4">
      <p className="flex items-start gap-2 font-semibold text-amber-100"><AlertCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        {remaining ? `${remaining} ${remaining === 1 ? 'fila necesita' : 'filas necesitan'} una corrección. Corrígela aquí o quítala.` : 'Listo: corregiste las filas con error.'}</p>
      <ul className="space-y-3">{visibleProblems.map(line => {
        const row = rows.find(item => item.line === line)!;
        const message = errorsByLine.get(line);
        return <li key={line} className="rounded-xl border border-white/10 bg-[oklch(0.16_0.02_260)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-white">Fila {line}</p>
            {message ? <p className="text-sm text-amber-200">{message}</p> : <p className="inline-flex items-center gap-1 text-sm text-emerald-300"><CheckCircle2 aria-hidden="true" className="h-4 w-4" />Corregida</p>}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[9rem_1fr_9rem_auto] sm:items-end">
            <label className="text-xs text-slate-300">Fecha<input value={row.fields.date} disabled={busy} onChange={event => edit(line, 'date', event.target.value)} placeholder="AAAA-MM-DD" className={ui.input} /></label>
            <label className="text-xs text-slate-300">Descripción<input value={row.fields.description} disabled={busy} onChange={event => edit(line, 'description', event.target.value)} className={ui.input} /></label>
            <label className="text-xs text-slate-300">Importe<input value={row.fields.amount} inputMode="decimal" disabled={busy} onChange={event => edit(line, 'amount', event.target.value)} placeholder="-348.00" className={ui.input} /></label>
            <button type="button" disabled={busy} onClick={() => remove(line)} className={ui.quiet}><Trash2 aria-hidden="true" className="h-4 w-4" />Quitar fila</button>
          </div>
          {message?.includes('Moneda') && <label className="mt-2 block max-w-40 text-xs text-slate-300">Moneda<input value={row.fields.currency} disabled={busy} onChange={event => edit(line, 'currency', event.target.value.toUpperCase())} placeholder="MXN" className={ui.input} /></label>}
        </li>;
      })}</ul>
      <p className="text-xs text-amber-100/80">Usa signo negativo para el dinero que salió. Las filas quitadas no se guardan.</p>
    </div>}
    {removedCount > 0 && <p className="text-sm text-slate-400">{removedCount === 1 ? '1 fila quitada; no se guardará.' : `${removedCount} filas quitadas; no se guardarán.`}</p>}

    {result.validTransactions.length > 0 && <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Primeros movimientos que se guardarán</caption>
        <thead className="bg-white/5 text-slate-300"><tr><th scope="col" className="px-3 py-2 font-medium">Fecha</th><th scope="col" className="px-3 py-2 font-medium">Descripción</th><th scope="col" className="px-3 py-2 text-right font-medium">Importe</th></tr></thead>
        <tbody>{result.validTransactions.slice(0, 5).map(transaction => <tr key={transaction.id} className="border-t border-white/10">
          <td className="whitespace-nowrap px-3 py-2 text-slate-300">{formatDay(transaction.date)}</td>
          <td className="max-w-xs break-words px-3 py-2 text-white">{transaction.description}</td>
          <td className={`whitespace-nowrap px-3 py-2 text-right font-mono ${transaction.amount > 0 ? 'text-emerald-300' : 'text-white'}`}>{formatSignedMoney(transaction.amount, transaction.currency)}</td>
        </tr>)}</tbody>
      </table>
      {result.validTransactions.length > 5 && <p className="border-t border-white/10 px-3 py-2 text-xs text-slate-400">y {result.validTransactions.length - 5} más</p>}
    </div>}

    {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200"><AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{error} No se guardó ningún movimiento; puedes intentar de nuevo.</p>}
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-slate-400">Subir este archivo no conecta tu banco ni mueve dinero.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={busy} onClick={onCancel} className={ui.quiet}>No guardar</button>
        <button type="button" disabled={busy || remaining > 0 || result.validTransactions.length === 0} onClick={() => onConfirm(result.transactions)} className={ui.primary}>
          {busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
          {busy ? 'Guardando…' : remaining > 0 ? `Corrige ${remaining === 1 ? 'la fila' : `${remaining} filas`} para guardar` : `Guardar ${result.validTransactions.length} ${result.validTransactions.length === 1 ? 'movimiento' : 'movimientos'}`}
        </button>
      </div>
    </div>
  </section>;
}
