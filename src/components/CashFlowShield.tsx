'use client';

import React from 'react';
import { CashFlowMetrics } from '../lib/types';
import { Landmark, ShieldAlert, ReceiptText, TrendingUp, Info } from 'lucide-react';

interface CashFlowShieldProps {
  metrics: CashFlowMetrics;
}

export const CashFlowShield: React.FC<CashFlowShieldProps> = ({ metrics }) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  return (
    <section className="w-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-sora text-xs font-bold tracking-wider uppercase text-[oklch(0.68_0.03_250)]">
            Escudo de Flujo de Caja & Diagnóstico Fiscal
          </h2>
          <p className="text-xs text-[oklch(0.68_0.03_250)] opacity-80">
            Cálculo determinista en tiempo real • Cumplimiento SAT
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-[oklch(0.72_0.17_155/0.15)] text-[oklch(0.72_0.17_155)] border border-[oklch(0.72_0.17_155/0.3)]">
          <span className="w-2 h-2 rounded-full bg-[oklch(0.72_0.17_155)] animate-pulse"></span>
          Motor Determinista Activo
        </span>
      </div>

      {/* Grid de 3 Tarjetas Directas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* TARJETA 1: Saldo en Bancos */}
        <div className="relative overflow-hidden rounded-2xl border border-[oklch(0.30_0.03_260)] bg-[oklch(0.21_0.025_260)] p-5 shadow-sm hover:border-[oklch(0.78_0.15_195/0.4)] transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[oklch(0.68_0.03_250)]">
              Saldo en Bancos
            </span>
            <div className="p-2 rounded-xl bg-[oklch(0.78_0.15_195/0.14)] text-[oklch(0.78_0.15_195)]">
              <Landmark className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="font-mono text-2xl font-bold tracking-tight text-white">
              {formatCurrency(metrics.totalBankBalance)}
            </div>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-[oklch(0.68_0.03_250)]">
              <span className="text-[oklch(0.72_0.17_155)] font-medium flex items-center gap-0.5">
                <TrendingUp className="w-3 h-3" />
                Ingresos: {formatCurrency(metrics.totalIncome)}
              </span>
              <span>•</span>
              <span>Egresos: {formatCurrency(metrics.totalExpense)}</span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-[oklch(0.30_0.03_260)] flex items-center justify-between text-xs text-[oklch(0.68_0.03_250)]">
            <span>Fuente: Open Banking / Belvo</span>
            <span className="font-mono text-[11px] text-[oklch(0.78_0.15_195)]">Cuenta BBVA *4421</span>
          </div>
        </div>

        {/* TARJETA 2: Gasto no Deducible Detectado (Discrepancias) */}
        <div className="relative overflow-hidden rounded-2xl border border-[oklch(0.65_0.22_25/0.4)] bg-[oklch(0.65_0.22_25/0.08)] p-5 shadow-sm hover:border-[oklch(0.65_0.22_25/0.6)] transition-all">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-rose-300">
                Gasto No Deducible Detectado
              </span>
              <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-rose-900/60 text-rose-200">
                {metrics.discrepanciaCount} alerta
              </span>
            </div>
            <div className="p-2 rounded-xl bg-rose-950/60 text-rose-400">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="font-mono text-2xl font-bold tracking-tight text-rose-200">
              {formatCurrency(metrics.nonDeductibleExpenseDiscrepancies)}
            </div>
            <div className="mt-1.5 flex items-center gap-1 text-xs text-rose-300">
              <Info className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                Costo fiscal en riesgo: <strong className="font-semibold font-mono">{formatCurrency(metrics.nonDeductibleImpactEstimated)}</strong> (ISR 30% + IVA)
              </span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-[oklch(0.65_0.22_25/0.3)] flex items-center justify-between text-xs text-rose-300/80">
            <span>Sin comprobante o alerta EFOS</span>
            <span className="font-semibold text-rose-300">Requiere CFDI</span>
          </div>
        </div>

        {/* TARJETA 3: Retenciones Proyectadas */}
        <div className="relative overflow-hidden rounded-2xl border border-[oklch(0.30_0.03_260)] bg-[oklch(0.21_0.025_260)] p-5 shadow-sm hover:border-[oklch(0.80_0.16_75/0.4)] transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[oklch(0.68_0.03_250)]">
              Retenciones Proyectadas
            </span>
            <div className="p-2 rounded-xl bg-[oklch(0.80_0.16_75/0.14)] text-[oklch(0.80_0.16_75)]">
              <ReceiptText className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="font-mono text-2xl font-bold tracking-tight text-white">
              {formatCurrency(metrics.projectedRetentionsResico)}
            </div>
            <div className="mt-1.5 text-xs text-[oklch(0.68_0.03_250)]">
              Desglose acumulado de retenciones timbradas en CFDIs
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-[oklch(0.30_0.03_260)] flex items-center justify-between text-xs text-[oklch(0.68_0.03_250)]">
            <span>Régimen RESICO (Art. 113-J)</span>
            <span className="font-mono text-[oklch(0.72_0.17_155)] font-medium">Timbrado al 100%</span>
          </div>
        </div>
      </div>
    </section>
  );
};
