'use client';

import React, { useState } from 'react';
import { CFDI_USE_CODES, calculateTaxSavings, TaxSavingsResult } from '../lib/taxOptimizer';
import { CfdiRecord } from '../lib/types';
import { X, Sparkles, AlertCircle, CheckCircle2, Calculator } from 'lucide-react';

interface RegisterInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvoiceCreated: (cfdi: CfdiRecord) => void;
}

export const RegisterInvoiceModal: React.FC<RegisterInvoiceModalProps> = ({
  isOpen,
  onClose,
  onInvoiceCreated
}) => {
  const [issuer, setIssuer] = useState('');
  const [subtotal, setSubtotal] = useState('');
  const [cfdiUse, setCfdiUse] = useState('G03');
  const [paymentForm, setPaymentForm] = useState('03');
  const [result, setResult] = useState<TaxSavingsResult | null>(null);

  if (!isOpen) return null;

  const handleCalculateAndSave = () => {
    const numSubtotal = parseFloat(subtotal);
    if (!numSubtotal || numSubtotal <= 0) {
      setResult({
        eligible: false,
        category: null,
        rate: 0,
        estimated_savings: 0,
        reason: 'Por favor ingresa un subtotal válido mayor a $0.'
      });
      return;
    }

    const res = calculateTaxSavings({
      cfdi_use: cfdiUse,
      payment_form: paymentForm,
      subtotal: numSubtotal
    });

    setResult(res);

    // Calcular IVA 16% determinista
    const iva = Math.round(numSubtotal * 0.16 * 100) / 100;
    const total = Math.round((numSubtotal + iva) * 100) / 100;

    const newCfdi: CfdiRecord = {
      id: `cfdi-manual-${Date.now()}`,
      userId: 'usr-resico-001',
      uuidSat: `MAN-${Date.now().toString(16).toUpperCase()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
      rfcEmisor: issuer.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'PROV120101XYZ',
      nombreEmisor: issuer || 'Proveedor General',
      rfcReceptor: 'GARM900101XYZ',
      nombreReceptor: 'GARCÍA MARTÍNEZ TECH & CONSULTING',
      total,
      subtotal: numSubtotal,
      iva,
      retenciones: 0,
      fechaEmision: new Date().toISOString(),
      tipoComprobante: 'E',
      statusSat: 'vigente',
      isEfos: false,
      conceptos: [
        {
          descripcion: `Gasto registrado: ${issuer || 'Insumo'} (${cfdiUse})`,
          importe: numSubtotal
        }
      ],
      sourceType: 'image'
    };

    setTimeout(() => {
      onInvoiceCreated(newCfdi);
      onClose();
    }, 1100);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-[oklch(0.18_0.02_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl w-full max-w-md p-6 shadow-2xl text-[oklch(0.97_0.01_240)]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[oklch(0.30_0.03_260)]">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-[oklch(0.78_0.15_195/0.16)] text-[oklch(0.78_0.15_195)]">
              <Calculator className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-sora font-bold text-base">Registrar Comprobante</h3>
              <p className="text-xs text-[oklch(0.68_0.03_250)]">
                Simula la extracción automática por WhatsApp
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[oklch(0.68_0.03_250)] hover:text-white hover:bg-[oklch(0.24_0.028_260)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Formulario */}
        <div className="mt-4 space-y-3.5 text-xs">
          <div>
            <label className="block font-semibold text-[oklch(0.68_0.03_250)] mb-1">
              Emisor / Negocio
            </label>
            <input
              type="text"
              placeholder="Ej. Farmacia San Pablo, Telmex, Office Depot"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              className="w-full bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[oklch(0.78_0.15_195)]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[oklch(0.68_0.03_250)] mb-1">
              Subtotal antes de IVA (MXN)
            </label>
            <input
              type="number"
              placeholder="1250.00"
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
              className="w-full bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-[oklch(0.78_0.15_195)]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[oklch(0.68_0.03_250)] mb-1">
              Uso de CFDI (SAT)
            </label>
            <select
              value={cfdiUse}
              onChange={(e) => setCfdiUse(e.target.value)}
              className="w-full bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-[oklch(0.78_0.15_195)]"
            >
              {CFDI_USE_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-[oklch(0.68_0.03_250)] mb-1">
              Forma de Pago
            </label>
            <select
              value={paymentForm}
              onChange={(e) => setPaymentForm(e.target.value)}
              className="w-full bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-[oklch(0.78_0.15_195)]"
            >
              <option value="01">01 — Efectivo (Alerta: no deducible personal)</option>
              <option value="03">03 — Transferencia electrónica (SPEI)</option>
              <option value="04">04 — Tarjeta de crédito</option>
              <option value="28">28 — Tarjeta de débito</option>
              <option value="02">02 — Cheque nominativo</option>
            </select>
          </div>

          {/* Resultado de la optimización fiscal */}
          {result && (
            <div
              className={`p-3.5 rounded-xl border text-xs leading-relaxed animate-fade-in ${
                result.eligible
                  ? 'bg-[oklch(0.72_0.17_155/0.1)] border-[oklch(0.72_0.17_155/0.35)] text-[oklch(0.72_0.17_155)]'
                  : 'bg-[oklch(0.65_0.22_25/0.08)] border-[oklch(0.65_0.22_25/0.3)] text-rose-300'
              }`}
            >
              <div className="font-mono text-base font-bold mb-0.5">
                {result.eligible
                  ? `+$${result.estimated_savings.toFixed(2)} MXN ahorro estimado`
                  : '⚠️ Gasto no deducible'}
              </div>
              <p className="opacity-90">{result.reason}</p>
            </div>
          )}
        </div>

        {/* Acciones */}
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-[oklch(0.30_0.03_260)] hover:bg-[oklch(0.24_0.028_260)] text-xs font-semibold transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleCalculateAndSave}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] font-sora font-bold text-xs shadow-glow hover:brightness-105 transition-all flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Calcular y Guardar
          </button>
        </div>
      </div>
    </div>
  );
};
