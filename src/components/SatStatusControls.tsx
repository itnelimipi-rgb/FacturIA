'use client';

import React from 'react';
import { ShieldCheck, LoaderCircle } from 'lucide-react';
import type { BankTransaction, CfdiRecord, Profile, SatVerification } from '../lib/types';

export type SatWorkspaceSnapshot = { profile: Profile | null; transactions: BankTransaction[]; cfdis: CfdiRecord[] };
interface Props { document: CfdiRecord; demoMode: boolean; onSnapshotUpdated?: (snapshot: SatWorkspaceSnapshot) => void; }

function consultationMessage(consultation: SatVerification): string {
  if (consultation.outcome === 'unavailable') return 'No pudimos obtener una respuesta del SAT. El estado sigue sin confirmar; se conservan las alertas anteriores.';
  if (consultation.outcome === 'not_found') return 'El SAT respondió: documento no encontrado. Esta respuesta no confirma que esté vigente o cancelado.';
  if (consultation.outcome === 'invalid_query') return 'El SAT no pudo revisar estos datos. El estado sigue sin confirmar; revisa el identificador, los RFC y el total del XML.';
  return `El SAT respondió: documento ${consultation.status === 'vigente' ? 'vigente' : 'cancelado'} en la fecha de esta consulta.`;
}

export function SatStatusControls({ document, demoMode, onSnapshotUpdated }: Props) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [lastResult, setLastResult] = React.useState<SatVerification | null>(null);
  const consultation = lastResult ?? document.satVerification;
  if (document.sourceType !== 'xml' || !document.uuidSat) return null;
  if (demoMode) return <section className="rounded-xl border border-slate-600 bg-slate-800/50 p-4 text-sm leading-relaxed space-y-2"><h3 className="font-semibold text-white">Estado SAT de ejemplo</h3><p className="text-slate-300">{document.statusSat === 'no_verificado' ? 'Este ejemplo tiene el estado SAT sin confirmar.' : `Este ejemplo está marcado como ${document.statusSat}.`} La demo no consulta al SAT. En tu cuenta podrás consultar tus propios XML.</p></section>;
  const consult = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/workspace/sat', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: document.id }),
      });
      const body = await response.json() as { error?: string; snapshot?: SatWorkspaceSnapshot; consultation?: SatVerification };
      if (!response.ok || !body.snapshot || !body.consultation) throw new Error(body.error || 'No se pudo completar la consulta al SAT.');
      setLastResult(body.consultation);
      onSnapshotUpdated?.(body.snapshot);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo completar la consulta al SAT.');
    } finally { setBusy(false); }
  };
  return <section className="p-4 rounded-xl border border-[oklch(0.30_0.03_260)] bg-[oklch(0.21_0.025_260)] space-y-3 text-sm leading-relaxed">
    <h3 className="font-semibold text-white flex items-center gap-2"><ShieldCheck className="w-5 h-5" />Estado de este documento en el SAT</h3>
    <p className="text-slate-300">Al consultar se envían al SAT el identificador del documento (UUID), los RFC de quien lo emitió y recibió, y el total del XML. No se envía el archivo completo ni se solicita tu contraseña o e.firma.</p>
    {!consultation && <p className="text-amber-200">Sin consultar: guardar un XML no confirma su estado en el SAT.</p>}
    {onSnapshotUpdated && <button type="button" disabled={busy} onClick={() => void consult()} className="inline-flex items-center gap-2 min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-[oklch(0.78_0.15_195)] text-[oklch(0.15_0.02_260)] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-white">
      {busy && <LoaderCircle className="w-4 h-4 animate-spin" />}{busy ? 'Consultando el SAT…' : 'Consultar estado del documento en el SAT'}
    </button>}
    {consultation && <div aria-live="polite" className="space-y-2 text-slate-200">
      <p>{consultationMessage(consultation)}</p>
      <p className="text-slate-300">Fuente: servicio de consulta del SAT. Fecha: {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(consultation.checkedAt))}.</p>
      {consultation.outcome === 'found' && <p>{consultation.efos === 'listed' ? 'El SAT reportó una alerta sobre el emisor en su validación EFOS.' : consultation.efos === 'not_listed' ? 'El SAT no reportó al emisor en la validación EFOS de esta respuesta.' : 'La respuesta no confirmó la validación EFOS del emisor.'}</p>}
      {(consultation.cancelability || consultation.cancellationStatus) && <details className="text-slate-300"><summary className="min-h-11 cursor-pointer flex items-center">Ver datos de cancelación recibidos</summary>{consultation.cancelability && <p>Cancelabilidad: {consultation.cancelability}.</p>}{consultation.cancellationStatus && <p>Estado de cancelación: {consultation.cancellationStatus}.</p>}</details>}
      {document.isEfos && consultation.efos !== 'listed' && <p className="text-amber-200">La alerta anterior sobre el emisor se conserva para que la revises.</p>}
    </div>}
    {onSnapshotUpdated && <p className="text-slate-300">Espera un minuto antes de volver a consultar este documento.</p>}
    {error && <p role="alert" className="text-rose-200">{error} El XML guardado se conserva.</p>}
    <p className="text-slate-300">La respuesta corresponde al momento de consulta. Un estado vigente no confirma que el documento sea deducible ni que su contenido haya pasado todas las validaciones fiscales.</p>
  </section>;
}
