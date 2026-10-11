'use client';

import React from 'react';
import { ShieldCheck, LoaderCircle } from 'lucide-react';
import type {BankTransaction, CfdiRecord, Profile, SatVerification} from '../lib/types';

export type SatWorkspaceSnapshot = {profile: Profile | null; transactions: BankTransaction[]; cfdis: CfdiRecord[]};
interface Props {
  document: CfdiRecord;
  demoMode: boolean;
  onSnapshotUpdated?: (snapshot: SatWorkspaceSnapshot) => void;
}

function consultationMessage(consultation: SatVerification): string {
  if (consultation.outcome === 'unavailable') return 'No se pudo consultar SAT. Se conservan las alertas previas; la vigencia no quedó confirmada.';
  if (consultation.outcome === 'not_found') return 'SAT respondió: comprobante no encontrado. La vigencia no quedó confirmada.';
  if (consultation.outcome === 'invalid_query') return 'SAT rechazó la expresión de consulta. La vigencia no quedó confirmada.';
  return `SAT respondió: ${consultation.status === 'vigente' ? 'vigente' : 'cancelado'}.`;
}

export function SatStatusControls({document, demoMode, onSnapshotUpdated}: Props) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [lastResult, setLastResult] = React.useState<SatVerification | null>(null);
  const consultation = lastResult ?? document.satVerification;
  if (demoMode || document.sourceType !== 'xml' || !document.uuidSat || !onSnapshotUpdated) return null;
  const consult = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/workspace/sat', {
        method: 'POST', cache: 'no-store', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({documentId: document.id}),
      });
      const body = await response.json() as {error?: string; snapshot?: SatWorkspaceSnapshot; consultation?: SatVerification};
      if (!response.ok || !body.snapshot || !body.consultation) throw new Error(body.error || 'No se pudo completar la consulta SAT.');
      setLastResult(body.consultation);
      onSnapshotUpdated(body.snapshot);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo completar la consulta SAT.');
    } finally { setBusy(false); }
  };
  return <section className="p-3.5 rounded-xl border border-[oklch(0.30_0.03_260)] bg-[oklch(0.21_0.025_260)] space-y-2">
    <h4 className="text-xs font-semibold text-white flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Consulta oficial SAT</h4>
    <p className="text-xs text-[oklch(0.68_0.03_250)]">Al consultar se envían el UUID, los RFC del emisor y receptor y el total al servicio del SAT. No requiere contraseña ni e.firma.</p>
    <button type="button" disabled={busy} onClick={() => void consult()} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-[oklch(0.78_0.15_195)] text-[oklch(0.15_0.02_260)] disabled:opacity-60">
      {busy && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}{busy ? 'Consultando SAT…' : 'Consultar estado SAT'}
    </button>
    {consultation && <div aria-live="polite" className="text-xs space-y-1 text-[oklch(0.90_0.01_240)]">
      <p>{consultationMessage(consultation)}</p>
      <p className="text-[oklch(0.68_0.03_250)]">Consulta: {new Intl.DateTimeFormat('es-MX', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(consultation.checkedAt))}.</p>
      {consultation.outcome === 'found' && <p>{consultation.efos === 'listed' ? 'SAT reportó una alerta EFOS para el emisor.' : consultation.efos === 'not_listed' ? 'SAT no reportó al emisor en su validación EFOS de esta consulta.' : 'La respuesta no incluyó una validación EFOS reconocida.'}</p>}
      {consultation.cancelability && <p>Cancelabilidad: {consultation.cancelability}.</p>}
      {consultation.cancellationStatus && <p>Cancelación: {consultation.cancellationStatus}.</p>}
      {document.isEfos && consultation.efos !== 'listed' && <p className="text-amber-300">Se conserva la alerta EFOS registrada anteriormente para su revisión.</p>}
    </div>}
    <p className="text-xs text-[oklch(0.68_0.03_250)]">Espera un minuto entre consultas de este comprobante.</p>
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    <p className="text-[10px] text-[oklch(0.68_0.03_250)]">Este resultado corresponde al momento de consulta. No verifica sellos, esquemas XSD ni deducibilidad.</p>
  </section>;
}
