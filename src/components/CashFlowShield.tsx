'use client';

import React from 'react';
import type {BankTransaction, CashFlowMetrics} from '../lib/types';
import {ArrowDownLeft, ArrowUpRight, Landmark} from 'lucide-react';
import {describeLoadedDates, summarizeLoadedMovements, type MovementReviewFilter} from '../lib/dashboardPresentation';

interface CashFlowShieldProps {
  metrics: CashFlowMetrics;
  transactions?: BankTransaction[];
  onReviewMovements?: (filter: MovementReviewFilter) => void;
}

export const CashFlowShield: React.FC<CashFlowShieldProps> = ({metrics, transactions, onReviewMovements}) => {
  const loaded = transactions ? summarizeLoadedMovements(transactions) : null;
  const totalCount = loaded?.totalCount ?? metrics.conciliadoCount + metrics.ambiguoCount + metrics.discrepanciaCount;
  const totals = loaded?.totals ?? (totalCount ? [{currency: metrics.currency || 'MXN', incoming: metrics.totalIncome, outgoing: metrics.totalExpense, difference: metrics.totalBankBalance, unlinkedOutgoing: metrics.nonDeductibleExpenseDiscrepancies, unlinkedOutgoingCount: 0}] : []);
  const format = (amount: number, currency: string) => new Intl.NumberFormat('es-MX', {style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 2}).format(amount);

  return <section className="space-y-4" aria-labelledby="loaded-money-title">
    <div><h2 id="loaded-money-title" className="text-lg font-semibold text-white">El dinero en tus movimientos</h2><p className="mt-1 text-sm leading-relaxed text-slate-300">Fuente: movimientos que cargaste. {loaded && totalCount > 0 ? describeLoadedDates(loaded.dateRange) : 'Se muestran todos los movimientos disponibles.'}</p></div>
    {!totalCount ? <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-900 p-5 text-base leading-relaxed text-slate-300">Aún no hay movimientos cargados para calcular cuánto dinero entró o salió. Las facturas por sí solas no dan esa información.</div> : totals.map(total => <div key={total.currency} className="rounded-2xl border border-slate-700 bg-slate-900 p-5 sm:p-6">
      <h3 className="mb-4 text-base font-semibold text-white">Movimientos en {total.currency}</h3>
      <dl className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {[{label: 'Dinero que entró', amount: total.incoming, detail: 'Depósitos y otros movimientos positivos cargados.', icon: ArrowDownLeft}, {label: 'Dinero que salió', amount: total.outgoing, detail: 'Pagos y otros movimientos negativos cargados.', icon: ArrowUpRight}, {label: 'Diferencia entre entradas y salidas', amount: total.difference, detail: 'Dinero que entró menos dinero que salió en estos datos. No es el saldo disponible de tu cuenta bancaria.', icon: Landmark}].map(item => <div key={item.label} className="min-w-0">
          <dt className="flex items-start gap-2 text-sm font-medium text-slate-200"><item.icon className="mt-0.5 shrink-0 text-teal-200" size={18} />{item.label}</dt><dd className="mt-3 break-words font-mono text-xl font-semibold text-white">{format(item.amount, total.currency)}</dd><dd className="mt-2 text-sm leading-relaxed text-slate-300">{item.detail}</dd>
        </div>)}
      </dl>
      {total.unlinkedOutgoingCount > 0 && <div className="mt-5 border-t border-slate-700 pt-4"><p className="text-sm leading-relaxed text-slate-300">De ese dinero que salió, {format(total.unlinkedOutgoing, total.currency)} corresponde a {total.unlinkedOutgoingCount} {total.unlinkedOutgoingCount === 1 ? 'movimiento pendiente de revisar o vincular' : 'movimientos pendientes de revisar o vincular'}. Incluye las coincidencias por revisar y las búsquedas pausadas. No significa que sea un gasto rechazado por el SAT.</p>{onReviewMovements && <button type="button" onClick={() => onReviewMovements('all')} className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-teal-200 hover:border-teal-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300">Revisar movimientos y sus documentos</button>}</div>}
    </div>)}
    {totals.length > 1 && <p className="text-sm leading-relaxed text-slate-300">Cada moneda se muestra por separado. Los importes no se suman entre monedas ni se convierten a pesos.</p>}
    {totalCount > 0 && <details className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300"><summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300">Ver retenciones registradas en documentos vinculados</summary><p className="mt-3 font-mono text-base text-white">{format(metrics.projectedRetentionsResico, metrics.currency || 'MXN')}</p><p className="mt-2 leading-relaxed">Es un dato escrito en los documentos vinculados, en {metrics.currency || 'MXN'}. No es un cálculo de impuestos a pagar ni confirma una deducción.</p></details>}
  </section>;
};
