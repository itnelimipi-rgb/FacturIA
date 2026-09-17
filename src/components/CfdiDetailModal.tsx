'use client';

import React from 'react';
import { CfdiRecord } from '../lib/types';
import { FileCheck, X, ShieldAlert, CheckCircle2, Copy } from 'lucide-react';

interface CfdiDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  cfdi: CfdiRecord | null;
}

export const CfdiDetailModal: React.FC<CfdiDetailModalProps> = ({ isOpen, onClose, cfdi }) => {
  if (!isOpen || !cfdi) return null;

  const [copied, setCopied] = React.useState(false);

  const copyUuid = () => {
    navigator.clipboard?.writeText(cfdi.uuidSat);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN'
    }).format(val);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-[oklch(0.18_0.02_260)] rounded-2xl border border-[oklch(0.30_0.03_260)] shadow-2xl max-w-lg w-full overflow-hidden text-[oklch(0.97_0.01_240)]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[oklch(0.30_0.03_260)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-[oklch(0.78_0.15_195/0.14)] text-[oklch(0.78_0.15_195)]">
              <FileCheck className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-sora text-sm font-bold text-white">
                Comprobante Fiscal Digital (CFDI)
              </h3>
              <p className="text-xs text-[oklch(0.68_0.03_250)]">Comprobante validado ante el SAT</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[oklch(0.68_0.03_250)] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alerta si es EFOS */}
        {cfdi.isEfos && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-200 text-xs flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <div>
              <strong className="font-sora">ALERTA DE SEGURIDAD FISCAL (Art. 69-B CFF):</strong>
              <p className="mt-0.5">
                El RFC {cfdi.rfcEmisor} figura en la lista definitiva de Empresas que Facturan Operaciones Simuladas (EFOS). Esta factura NO es deducible y anula el acreditamiento de IVA.
              </p>
            </div>
          </div>
        )}

        {/* Contenido */}
        <div className="p-6 space-y-4">
          {/* UUID SAT */}
          <div className="p-3.5 rounded-xl bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)]">
            <div className="text-[10px] font-semibold uppercase text-[oklch(0.68_0.03_250)]">
              Folio Fiscal (UUID SAT)
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <span className="font-mono text-xs font-bold text-white break-all">
                {cfdi.uuidSat}
              </span>
              <button
                type="button"
                onClick={copyUuid}
                className="p-1.5 rounded-md hover:bg-[oklch(0.24_0.028_260)] text-[oklch(0.68_0.03_250)] hover:text-white"
                title="Copiar UUID"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-[oklch(0.72_0.17_155)]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Emisor y Receptor */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)]">
              <div className="text-[10px] font-semibold uppercase text-[oklch(0.68_0.03_250)]">Emisor</div>
              <div className="font-mono text-xs font-bold text-[oklch(0.78_0.15_195)] mt-0.5">
                {cfdi.rfcEmisor}
              </div>
              <div className="text-[11px] text-[oklch(0.68_0.03_250)] truncate mt-0.5">
                {cfdi.nombreEmisor || 'N/A'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)]">
              <div className="text-[10px] font-semibold uppercase text-[oklch(0.68_0.03_250)]">Receptor</div>
              <div className="font-mono text-xs font-bold text-white mt-0.5">
                {cfdi.rfcReceptor}
              </div>
              <div className="text-[11px] text-[oklch(0.68_0.03_250)] truncate mt-0.5">
                {cfdi.nombreReceptor || 'N/A'}
              </div>
            </div>
          </div>

          {/* Desglose Matemático Determinista */}
          <div className="p-4 rounded-xl bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] space-y-2">
            <div className="text-[11px] font-semibold uppercase text-[oklch(0.68_0.03_250)] mb-1">
              Desglose Determinista de Impuestos
            </div>
            <div className="flex justify-between text-xs text-[oklch(0.90_0.01_240)]">
              <span>Subtotal</span>
              <span className="font-mono">{formatCurrency(cfdi.subtotal)}</span>
            </div>
            <div className="flex justify-between text-xs text-[oklch(0.90_0.01_240)]">
              <span>IVA Trasladado (16%)</span>
              <span className="font-mono">{formatCurrency(cfdi.iva)}</span>
            </div>
            {cfdi.retenciones > 0 && (
              <div className="flex justify-between text-xs text-amber-400 font-medium">
                <span>Retenciones (ISR 1.25% RESICO)</span>
                <span className="font-mono">-{formatCurrency(cfdi.retenciones)}</span>
              </div>
            )}
            <div className="pt-2 border-t border-[oklch(0.30_0.03_260)] flex justify-between text-sm font-bold text-white">
              <span>Total Comprobante</span>
              <span className="font-mono text-[oklch(0.78_0.15_195)]">{formatCurrency(cfdi.total)}</span>
            </div>
          </div>

          {/* Conceptos */}
          {cfdi.conceptos && cfdi.conceptos.length > 0 && (
            <div className="text-xs text-[oklch(0.68_0.03_250)]">
              <span className="font-semibold text-white">Concepto principal: </span>
              {cfdi.conceptos[0].descripcion}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[oklch(0.21_0.025_260)] border-t border-[oklch(0.30_0.03_260)] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[oklch(0.24_0.028_260)] hover:bg-[oklch(0.30_0.03_260)] text-white transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
