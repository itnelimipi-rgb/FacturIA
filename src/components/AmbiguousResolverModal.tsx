'use client';

import React from 'react';
import { BankTransaction, CfdiRecord } from '../lib/types';
import { HelpCircle, Check, X, ShieldCheck, Calendar, FileText } from 'lucide-react';

interface AmbiguousResolverModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: BankTransaction | null;
  candidates: CfdiRecord[];
  onResolve: (transactionId: string, selectedCfdiId: string) => void;
}

export const AmbiguousResolverModal: React.FC<AmbiguousResolverModalProps> = ({
  isOpen,
  onClose,
  transaction,
  candidates,
  onResolve
}) => {
  if (!isOpen || !transaction) return null;

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN'
    }).format(Math.abs(val));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-[oklch(0.18_0.02_260)] rounded-2xl border border-[oklch(0.30_0.03_260)] shadow-2xl max-w-2xl w-full overflow-hidden text-[oklch(0.97_0.01_240)]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[oklch(0.30_0.03_260)] flex items-center justify-between bg-[oklch(0.80_0.16_75/0.1)]">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-[oklch(0.80_0.16_75/0.2)] text-[oklch(0.80_0.16_75)]">
              <HelpCircle className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-sora font-bold text-base text-white">
                Resolución Rápida de Conciliación Ambigua
              </h3>
              <p className="text-xs text-[oklch(0.68_0.03_250)]">
                Múltiples CFDIs con coincidencia exacta de monto en ventana de ±3 días
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[oklch(0.68_0.03_250)] hover:text-white hover:bg-[oklch(0.24_0.028_260)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Detalle del movimiento bancario */}
        <div className="p-6">
          <div className="rounded-xl p-4 bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] mb-5">
            <div className="text-[11px] font-semibold uppercase text-[oklch(0.68_0.03_250)] tracking-wider mb-1">
              Movimiento Bancario por Conciliar
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-white">
                  {transaction.description}
                </div>
                <div className="text-xs text-[oklch(0.68_0.03_250)] flex items-center gap-2 mt-0.5">
                  <span className="font-mono">Fecha: {transaction.date}</span>
                  <span>•</span>
                  <span className="font-mono text-[oklch(0.78_0.15_195)]">Cuenta BBVA *4421</span>
                </div>
              </div>
              <div className="text-lg font-mono font-bold text-rose-400">
                {formatCurrency(transaction.amount)}
              </div>
            </div>
          </div>

          <div className="text-xs font-semibold text-[oklch(0.68_0.03_250)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <span>Comprobantes CFDI Candidatos ({candidates.length})</span>
            <span className="text-[11px] lowercase text-[oklch(0.68_0.03_250)] font-normal">
              — Selecciona el correspondiente con 1 clic
            </span>
          </div>

          {/* Lista de Candidatos */}
          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {candidates.map((cfdi) => (
              <div
                key={cfdi.id}
                className="group p-4 rounded-xl border border-[oklch(0.30_0.03_260)] hover:border-[oklch(0.78_0.15_195)] bg-[oklch(0.21_0.025_260)] hover:bg-[oklch(0.24_0.028_260)] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[oklch(0.18_0.02_260)] text-[oklch(0.78_0.15_195)]">
                      {cfdi.rfcEmisor}
                    </span>
                    <span className="text-xs font-bold text-white">
                      {cfdi.nombreEmisor || 'Emisor CFDI'}
                    </span>
                  </div>

                  <div className="text-xs text-[oklch(0.68_0.03_250)] flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-1 font-mono">
                      <Calendar className="w-3.5 h-3.5" />
                      {cfdi.fechaEmision.slice(0, 10)}
                    </span>
                    <span className="flex items-center gap-1 font-mono">
                      <FileText className="w-3.5 h-3.5" />
                      Subtotal: ${cfdi.subtotal.toFixed(2)} + IVA 16%: ${cfdi.iva.toFixed(2)}
                    </span>
                  </div>

                  {cfdi.conceptos && cfdi.conceptos.length > 0 && (
                    <div className="text-xs text-[oklch(0.90_0.01_240)] italic line-clamp-1">
                      Concepto: {cfdi.conceptos[0].descripcion}
                    </div>
                  )}

                  <div className="font-mono text-[10px] text-[oklch(0.68_0.03_250)] truncate">
                    UUID: {cfdi.uuidSat}
                  </div>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 flex-shrink-0">
                  <div className="font-mono text-base font-bold text-white">
                    {formatCurrency(cfdi.total)}
                  </div>
                  <button
                    type="button"
                    onClick={() => onResolve(transaction.id, cfdi.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-sora font-bold rounded-lg bg-gradient-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] shadow-glow hover:brightness-105 transition-all"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Vincular y Conciliar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-[oklch(0.21_0.025_260)] border-t border-[oklch(0.30_0.03_260)] flex items-center justify-between text-xs text-[oklch(0.68_0.03_250)]">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-[oklch(0.72_0.17_155)]" />
            La vinculación actualiza el estado a 🟢 Conciliado y recalcula tu Escudo Fiscal
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1 text-[oklch(0.68_0.03_250)] hover:text-white font-medium"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};
