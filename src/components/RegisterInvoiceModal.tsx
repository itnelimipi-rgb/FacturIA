'use client';

import React, { useState } from 'react';
import { CfdiRecord } from '../lib/types';
import { X, AlertCircle, Calculator, Loader2 } from 'lucide-react';
import { useDialogFocus } from '../lib/useDialogFocus';

interface RegisterInvoiceModalProps {
  isOpen: boolean;
  userId: string;
  receptorRfc: string;
  receptorName?: string;
  onClose: () => void;
  onInvoiceCreated: (cfdi: CfdiRecord) => void | Promise<void>;
}

const inputClass = 'w-full bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-xl px-3 py-2.5 text-sm focus:outline-hidden focus:border-[oklch(0.78_0.15_195)] disabled:opacity-50';
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const RegisterInvoiceModal: React.FC<RegisterInvoiceModalProps> = props => props.isOpen ? <ExpenseForm key={JSON.stringify([props.userId, props.receptorRfc])} {...props} /> : null;

const ExpenseForm: React.FC<RegisterInvoiceModalProps> = ({ isOpen, userId, receptorRfc, receptorName, onClose, onInvoiceCreated }) => {
  const [issuer, setIssuer] = useState('');
  const [issuerRfc, setIssuerRfc] = useState('');
  const [description, setDescription] = useState('');
  const [subtotal, setSubtotal] = useState('');
  const [iva, setIva] = useState('');
  const [retentions, setRetentions] = useState('');
  const [date, setDate] = useState(today);
  const [currency, setCurrency] = useState('MXN');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogFocus(isOpen, () => { if (!saving) onClose(); });

  if (!isOpen) return null;
  const asCents = (value: string) => Math.round(Number(value) * 100);
  const completeAmounts = [subtotal, iva, retentions].every(value => /^\d+(?:\.\d{1,2})?$/.test(value));
  const totalCents = completeAmounts ? asCents(subtotal) + asCents(iva) - asCents(retentions) : null;
  const total = totalCents !== null && Number.isFinite(totalCents) ? totalCents / 100 : null;

  const saveExpense = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setError('');
    const normalizedRfc = issuerRfc.trim().toUpperCase();
    if (!userId || !receptorRfc) { setError('Completa tu perfil fiscal antes de registrar gastos.'); return; }
    if (!issuer.trim() || !description.trim()) { setError('Ingresa el proveedor y la descripción del gasto.'); return; }
    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(normalizedRfc)) { setError('Ingresa el RFC real del proveedor (12 o 13 caracteres).'); return; }
    const monetaryValues = [subtotal, iva, retentions];
    if (monetaryValues.some(value => !/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) > 999999999.99) || Number(subtotal) <= 0 || total === null || total <= 0) {
      setError('Usa importes positivos o cero, con hasta dos decimales. El subtotal y el total deben ser mayores que cero.'); return;
    }
    const parsedDate = new Date(`${date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) { setError('Ingresa una fecha válida.'); return; }
    const record: CfdiRecord = {
      id: `manual-${crypto.randomUUID()}`,
      userId,
      uuidSat: '',
      rfcEmisor: normalizedRfc,
      nombreEmisor: issuer.trim(),
      rfcReceptor: receptorRfc.trim().toUpperCase(),
      nombreReceptor: receptorName?.trim(),
      total,
      subtotal: asCents(subtotal) / 100,
      iva: asCents(iva) / 100,
      retenciones: asCents(retentions) / 100,
      fechaEmision: date,
      tipoComprobante: 'I',
      statusSat: 'no_verificado',
      isEfos: false,
      conceptos: [{ descripcion: description.trim(), importe: asCents(subtotal) / 100 }],
      sourceType: 'manual',
      currency
    };
    setSaving(true);
    try {
      await onInvoiceCreated(record);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar el gasto. Intenta nuevamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fade-in">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="expense-modal-title" className="bg-[oklch(0.18_0.02_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 shadow-2xl text-[oklch(0.97_0.01_240)]">
        <div className="flex items-center justify-between pb-3 border-b border-[oklch(0.30_0.03_260)]">
          <div className="flex items-center gap-2"><span className="p-2 rounded-xl bg-[oklch(0.78_0.15_195/0.16)] text-[oklch(0.78_0.15_195)]"><Calculator className="w-5 h-5" /></span><div><h3 id="expense-modal-title" className="font-sora font-bold text-lg">Anotar un gasto sin factura</h3><p className="text-sm text-slate-300">Guarda una anotación provisional del gasto.</p></div></div>
          <button type="button" disabled={saving} onClick={onClose} aria-label="Cerrar registro de gasto" className="min-w-11 min-h-11 shrink-0 flex items-center justify-center rounded-lg text-slate-300 hover:text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-teal-300"><X className="w-5 h-5" /></button>
        </div>
        <p className="mt-4 p-3 rounded-xl border border-slate-600 bg-slate-800/40 text-sm text-slate-200 leading-relaxed">Esta anotación conserva los datos del gasto. No emite una factura, no confirma una deducción y no se vincula automáticamente con el banco. Pide la factura XML al proveedor y agrégala cuando la tengas.</p>
        <p className="mt-3 text-sm text-slate-300 leading-relaxed">Por ahora necesitas el RFC del proveedor y el desglose de importes. Si no conoces alguno, consúltalo en tu comprobante o pídelo al proveedor antes de guardar. No inventes el RFC ni los impuestos.</p>
        <form onSubmit={event => void saveExpense(event)} className="mt-4 space-y-4 text-sm">
          <label className="block"><span className="block font-semibold text-[oklch(0.68_0.03_250)] mb-1">Nombre del proveedor</span><input required maxLength={160} disabled={saving} value={issuer} onChange={event => setIssuer(event.target.value)} placeholder="Nombre o razón social" className={inputClass} /></label>
          <label className="block"><span className="block font-semibold text-[oklch(0.68_0.03_250)] mb-1">RFC del proveedor</span><input required minLength={12} maxLength={13} disabled={saving} value={issuerRfc} onChange={event => setIssuerRfc(event.target.value.toUpperCase())} placeholder="RFC real de 12 o 13 caracteres" className={`${inputClass} uppercase font-mono`} /></label>
          <label className="block"><span className="block font-semibold text-[oklch(0.68_0.03_250)] mb-1">Descripción del gasto</span><input required maxLength={500} disabled={saving} value={description} onChange={event => setDescription(event.target.value)} placeholder="Servicio o producto adquirido" className={inputClass} /></label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block"><span className="block font-semibold text-[oklch(0.68_0.03_250)] mb-1">Fecha del gasto</span><input required type="date" disabled={saving} value={date} onChange={event => setDate(event.target.value)} className={inputClass} /></label>
            <label className="block"><span className="block font-semibold text-[oklch(0.68_0.03_250)] mb-1">Moneda</span><select disabled={saving} value={currency} onChange={event => setCurrency(event.target.value)} className={inputClass}><option value="MXN">MXN</option></select></label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block"><span className="block font-semibold text-[oklch(0.68_0.03_250)] mb-1">Subtotal</span><input required inputMode="decimal" disabled={saving} value={subtotal} onChange={event => setSubtotal(event.target.value)} placeholder="0.00" className={`${inputClass} font-mono`} /></label>
            <label className="block"><span className="block font-semibold text-slate-300 mb-1">IVA del comprobante</span><input required inputMode="decimal" aria-describedby="expense-tax-help" disabled={saving} value={iva} onChange={event => setIva(event.target.value)} placeholder="Importe conocido" className={`${inputClass} font-mono`} /></label>
            <label className="block"><span className="block font-semibold text-slate-300 mb-1">Retenciones</span><input required inputMode="decimal" aria-describedby="expense-tax-help" disabled={saving} value={retentions} onChange={event => setRetentions(event.target.value)} placeholder="Importe conocido" className={`${inputClass} font-mono`} /></label>
          </div>
          <p id="expense-tax-help" className="text-slate-300">Escribe 0 sólo si confirmaste que el comprobante no incluye ese impuesto. Un dato desconocido debe quedar vacío; el formulario necesita esos importes para guardar.</p>
          <div aria-live="polite" className="flex flex-wrap justify-between gap-2 p-3 rounded-xl bg-[oklch(0.21_0.025_260)]"><span>Total de la anotación</span><span className="font-mono font-bold">{total === null ? 'Completa los tres importes' : `${total.toFixed(2)} ${currency}`}</span></div>
          {error && <div role="alert" className="p-3 rounded-xl border border-rose-800 bg-rose-950/30 text-rose-200 flex items-start gap-2"><AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span></div>}
          <div className="pt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[oklch(0.30_0.03_260)]"><button type="button" disabled={saving} onClick={onClose} className="min-h-11 px-3 py-2 text-slate-300 disabled:opacity-50">Cancelar</button><button type="submit" disabled={saving} className="min-h-11 px-4 py-2.5 rounded-xl bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] font-bold font-sora shadow-glow flex items-center gap-2 disabled:opacity-50">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{saving ? 'Guardando…' : 'Guardar anotación'}</button></div>
        </form>
      </div>
    </div>
  );
};
