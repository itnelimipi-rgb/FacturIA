'use client';

import React from 'react';
import { CashFlowMetrics, CfdiRecord } from '../lib/types';
import { buildAiSuggestions } from '../lib/taxOptimizer';
import { TrendingUp, Award, DollarSign, HeartPulse, Briefcase, Lightbulb, ArrowUpRight } from 'lucide-react';

interface FiscalDashboardPanelProps {
  metrics: CashFlowMetrics;
  cfdis: CfdiRecord[];
  onGoToFacturas: () => void;
}

export const FiscalDashboardPanel: React.FC<FiscalDashboardPanelProps> = ({
  metrics,
  cfdis,
  onGoToFacturas
}) => {
  const goal = 15000;
  // Ahorro proyectado: retenciones acreditables + IVA deducible recuperado + ahorro ISR
  const totalSavings = Math.round((metrics.projectedRetentionsResico + (metrics.totalIncome * 0.05)) * 100) / 100;
  const pct = Math.min(100, Math.round((totalSavings / goal) * 100));
  const circumference = 352;
  const strokeDashoffset = circumference - (circumference * pct) / 100;

  const tips = buildAiSuggestions(
    cfdis.map((c) => ({
      cfdi_use: c.conceptos?.[0]?.claveProdServ?.startsWith('80') ? 'G03' : 'D01',
      payment_form: '03',
      subtotal: c.subtotal
    }))
  );

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2
    }).format(val);
  };

  return (
    <div className="space-y-6">
      {/* Top Grid: Gauge + Sugerencias */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Panel Gauge: Ahorro fiscal acumulado */}
        <div className="lg:col-span-6 bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-sora text-xs font-bold uppercase tracking-wider text-[oklch(0.68_0.03_250)]">
              Ahorro Fiscal Acumulado
            </h2>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[oklch(0.72_0.17_155/0.15)] text-[oklch(0.72_0.17_155)] border border-[oklch(0.72_0.17_155/0.3)]">
              Meta 2026
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-6">
            {/* Medidor Circular */}
            <div className="relative w-32 h-32 flex-shrink-0">
              <svg width="128" height="128" viewBox="0 0 132 132" className="-rotate-90">
                <circle
                  cx="66"
                  cy="66"
                  r="56"
                  fill="none"
                  stroke="oklch(0.30 0.03 260)"
                  strokeWidth="12"
                />
                <circle
                  cx="66"
                  cy="66"
                  r="56"
                  fill="none"
                  stroke="url(#g1)"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray="352"
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-1000 ease-out"
                />
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="oklch(0.78 0.15 195)" />
                    <stop offset="100%" stopColor="oklch(0.65 0.20 295)" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="font-mono text-xl font-bold text-white">{pct}%</span>
                <span className="text-[10px] text-[oklch(0.68_0.03_250)]">de tu meta</span>
              </div>
            </div>

            {/* Mini estadísticas */}
            <div className="flex-1 w-full space-y-3 text-xs border-t sm:border-t-0 sm:border-l border-[oklch(0.30_0.03_260)] pt-3 sm:pt-0 sm:pl-6">
              <div className="flex items-center justify-between">
                <span className="text-[oklch(0.68_0.03_250)]">Ahorro estimado (ISR / IVA)</span>
                <span className="font-mono font-bold text-sm text-[oklch(0.72_0.17_155)]">
                  {formatCurrency(totalSavings)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[oklch(0.68_0.03_250)]">Comprobantes procesados</span>
                <span className="font-mono font-bold text-sm text-white">{cfdis.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[oklch(0.68_0.03_250)]">Movimientos conciliados</span>
                <span className="font-mono font-bold text-sm text-[oklch(0.78_0.15_195)]">
                  {metrics.conciliadoCount} / {metrics.conciliadoCount + metrics.ambiguoCount + metrics.discrepanciaCount}
                </span>
              </div>
              <div className="pt-2 border-t border-[oklch(0.30_0.03_260)] flex justify-end">
                <button
                  onClick={onGoToFacturas}
                  className="text-[11px] text-[oklch(0.78_0.15_195)] hover:underline flex items-center gap-1"
                >
                  Ver comprobantes →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Panel Sugerencias del Asistente */}
        <div className="lg:col-span-6 bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-sora text-xs font-bold uppercase tracking-wider text-[oklch(0.68_0.03_250)] flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-400" />
                Sugerencias de tu Asistente Fiscal
              </h2>
              <span className="text-[10px] text-[oklch(0.68_0.03_250)]">Reglas LISR SAT</span>
            </div>

            <div className="space-y-2.5">
              {tips.map((tip, idx) => (
                <div
                  key={idx}
                  className="bg-[oklch(0.18_0.02_260)] border border-[oklch(0.30_0.03_260)] rounded-xl p-3 text-xs leading-relaxed text-[oklch(0.90_0.01_240)] flex items-start gap-2.5"
                >
                  <span className="text-amber-400 mt-0.5">💡</span>
                  <span className="flex-1">{tip}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[oklch(0.30_0.03_260)] text-[11px] text-[oklch(0.68_0.03_250)] flex items-center justify-between">
            <span>Actualizado en tiempo real</span>
            <span className="text-[oklch(0.78_0.15_195)]">RESICO Art. 113-E a 113-J</span>
          </div>
        </div>
      </div>

      {/* Row de Estadísticas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[oklch(0.68_0.03_250)]">Total Facturado</span>
            <div className="w-8 h-8 rounded-lg bg-[oklch(0.78_0.15_195/0.14)] text-[oklch(0.78_0.15_195)] flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="font-mono text-2xl font-bold text-white">
            {formatCurrency(metrics.totalIncome)}
          </div>
          <div className="text-xs text-[oklch(0.68_0.03_250)] mt-1">
            Ingresos brutos acumulados este mes
          </div>
        </div>

        <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[oklch(0.68_0.03_250)]">Deducción Personal</span>
            <div className="w-8 h-8 rounded-lg bg-[oklch(0.72_0.17_155/0.14)] text-[oklch(0.72_0.17_155)] flex items-center justify-center">
              <HeartPulse className="w-4 h-4" />
            </div>
          </div>
          <div className="font-mono text-2xl font-bold text-[oklch(0.72_0.17_155)]">
            {formatCurrency(1430.00)}
          </div>
          <div className="text-xs text-[oklch(0.68_0.03_250)] mt-1">
            Gastos calificados Art. 151 LISR
          </div>
        </div>

        <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[oklch(0.68_0.03_250)]">Gasto de Negocio</span>
            <div className="w-8 h-8 rounded-lg bg-[oklch(0.65_0.20_295/0.14)] text-[oklch(0.65_0.20_295)] flex items-center justify-center">
              <Briefcase className="w-4 h-4" />
            </div>
          </div>
          <div className="font-mono text-2xl font-bold text-white">
            {formatCurrency(metrics.totalExpense)}
          </div>
          <div className="text-xs text-[oklch(0.68_0.03_250)] mt-1">
            Deducible e invertible para IVA
          </div>
        </div>
      </div>
    </div>
  );
};
