'use client';

import React from 'react';
import { BankTransaction, CashFlowMetrics, CfdiRecord } from '../lib/types';
import { DollarSign, Briefcase, Lightbulb, FileCheck2 } from 'lucide-react';

interface FiscalDashboardPanelProps {
  metrics: CashFlowMetrics;
  cfdis: CfdiRecord[];
  transactions?: BankTransaction[];
  onGoToFacturas: () => void;
}

const formatCurrency = (value: number, currency = 'MXN') => new Intl.NumberFormat('es-MX', { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2 }).format(value);
const groupAmounts = (items: { amount: number; currency?: string }[]) => {
  const totals = new Map<string, number>();
  items.forEach(item => {
    const currency = item.currency || 'MXN';
    totals.set(currency, Math.round(((totals.get(currency) || 0) + item.amount) * 100) / 100);
  });
  return totals.size ? Array.from(totals.entries()) : [['MXN', 0] as [string, number]];
};

export const FiscalDashboardPanel: React.FC<FiscalDashboardPanelProps> = ({ metrics, cfdis, transactions, onGoToFacturas }) => {
  const totalTransactions = metrics.conciliadoCount + metrics.ambiguoCount + metrics.discrepanciaCount;
  const pct = totalTransactions ? Math.round(metrics.conciliadoCount / totalTransactions * 100) : 0;
  const strokeDashoffset = 352 - 352 * pct / 100;
  const manualCount = cfdis.filter(record => record.sourceType === 'manual').length;
  const unverifiedCount = cfdis.filter(record => record.statusSat === 'no_verificado').length;
  const xmlRecords = cfdis.filter(record => record.sourceType === 'xml' && record.statusSat !== 'cancelado' && record.uuidSat);
  const deposits = transactions
    ? groupAmounts(transactions.filter(transaction => transaction.amount > 0).map(transaction => ({ amount: transaction.amount, currency: transaction.currency })))
    : [['MXN', metrics.totalIncome] as [string, number]];
  const charges = transactions
    ? groupAmounts(transactions.filter(transaction => transaction.amount < 0).map(transaction => ({ amount: Math.abs(transaction.amount), currency: transaction.currency })))
    : [['MXN', metrics.totalExpense] as [string, number]];
  const invoiceTotals = groupAmounts(xmlRecords.map(record => ({ amount: record.total, currency: record.currency })));
  const tips = [
    totalTransactions ? `${metrics.conciliadoCount} de ${totalTransactions} movimientos tienen un comprobante vinculado. Revisa las coincidencias antes de cerrar el periodo.` : 'Importa tu primer CSV bancario y un XML para comenzar la conciliación.',
    metrics.ambiguoCount ? `${metrics.ambiguoCount} movimiento(s) requieren que selecciones el comprobante correcto.` : 'No hay coincidencias ambiguas pendientes.',
    unverifiedCount ? `${unverifiedCount} registro(s) tienen vigencia SAT sin verificar. Importar un XML no confirma su vigencia ni su deducibilidad.` : 'La verificación oficial de vigencia SAT y la consulta EFOS están pendientes de configurar.',
    manualCount ? `${manualCount} gasto(s) provisionales no cuentan con UUID fiscal. Solicita e importa su XML timbrado.` : 'Los cálculos de impuestos y deducciones requieren validar el régimen y los comprobantes antes de habilitarse.'
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-6 bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-6 shadow-xs">
          <div className="flex items-center justify-between mb-5"><h2 className="font-sora text-xs font-bold uppercase tracking-wider text-[oklch(0.68_0.03_250)]">Avance de conciliación</h2><span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[oklch(0.72_0.17_155/0.15)] text-[oklch(0.72_0.17_155)] border border-[oklch(0.72_0.17_155/0.3)]">Datos cargados</span></div>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="relative w-32 h-32 shrink-0">
              <svg width="128" height="128" viewBox="0 0 132 132" className="-rotate-90" aria-hidden="true"><circle cx="66" cy="66" r="56" fill="none" stroke="oklch(0.30 0.03 260)" strokeWidth="12" /><circle cx="66" cy="66" r="56" fill="none" stroke="url(#reconciliation-gradient)" strokeWidth="12" strokeLinecap="round" strokeDasharray="352" strokeDashoffset={strokeDashoffset} className="transition-all duration-1000 ease-out" /><defs><linearGradient id="reconciliation-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="oklch(0.78 0.15 195)" /><stop offset="100%" stopColor="oklch(0.65 0.20 295)" /></linearGradient></defs></svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center"><span className="font-mono text-xl font-bold text-white">{pct}%</span><span className="text-[10px] text-[oklch(0.68_0.03_250)]">vinculados</span></div>
            </div>
            <div className="flex-1 w-full space-y-3 text-xs border-t sm:border-t-0 sm:border-l border-[oklch(0.30_0.03_260)] pt-3 sm:pt-0 sm:pl-6">
              <div className="flex justify-between gap-2"><span className="text-[oklch(0.68_0.03_250)]">Comprobantes registrados</span><span className="font-mono font-bold text-sm text-white">{cfdis.length}</span></div>
              <div className="flex justify-between gap-2"><span className="text-[oklch(0.68_0.03_250)]">Movimientos conciliados</span><span className="font-mono font-bold text-sm text-[oklch(0.78_0.15_195)]">{metrics.conciliadoCount} / {totalTransactions}</span></div>
              <div className="flex justify-between gap-2"><span className="text-[oklch(0.68_0.03_250)]">Pendientes de revisión</span><span className="font-mono font-bold text-sm text-amber-300">{metrics.ambiguoCount + metrics.discrepanciaCount}</span></div>
              <div className="pt-2 border-t border-[oklch(0.30_0.03_260)] flex justify-end"><button type="button" onClick={onGoToFacturas} className="text-[11px] text-[oklch(0.78_0.15_195)] hover:underline">Ver comprobantes →</button></div>
            </div>
          </div>
        </div>
        <div className="lg:col-span-6 bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-6 shadow-xs">
          <h2 className="font-sora text-xs font-bold uppercase tracking-wider text-[oklch(0.68_0.03_250)] flex items-center gap-2 mb-4"><Lightbulb className="w-4 h-4 text-amber-400" /> Revisiones pendientes</h2>
          <div className="space-y-2.5">{tips.map((tip, index) => <div key={index} className="bg-[oklch(0.18_0.02_260)] border border-[oklch(0.30_0.03_260)] rounded-xl p-3 text-xs leading-relaxed text-[oklch(0.90_0.01_240)] flex items-start gap-2.5"><span className="text-amber-400">•</span><span>{tip}</span></div>)}</div>
          <p className="mt-4 pt-3 border-t border-[oklch(0.30_0.03_260)] text-[11px] text-[oklch(0.68_0.03_250)]">El panel resume los datos cargados. Los ahorros fiscales y las deducciones aún no se calculan.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[{ title: 'Depósitos bancarios', totals: deposits, icon: DollarSign, detail: 'Suma de movimientos positivos importados' }, { title: 'Cargos bancarios', totals: charges, icon: Briefcase, detail: 'Suma de movimientos negativos importados' }, { title: 'Importe de comprobantes', totals: invoiceTotals, icon: FileCheck2, detail: 'XML registrados; excluye cancelados y gastos provisionales' }].map(card => <div key={card.title} className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-5 shadow-xs"><div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-[oklch(0.68_0.03_250)]">{card.title}</span><div className="w-8 h-8 rounded-lg bg-[oklch(0.78_0.15_195/0.14)] text-[oklch(0.78_0.15_195)] flex items-center justify-center"><card.icon className="w-4 h-4" /></div></div><div className="font-mono text-xl font-bold text-white space-y-1">{card.totals.map(([currency, amount]) => <div key={currency}>{formatCurrency(amount, currency)}</div>)}</div><p className="text-xs text-[oklch(0.68_0.03_250)] mt-1">{card.detail}</p></div>)}
      </div>
    </div>
  );
};
