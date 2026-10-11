'use client';
import {useEffect, useState, type FormEvent} from 'react';

export function AccountEmailControls({onLogin}: {onLogin?: () => void}) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState<'reset' | 'verify' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/account/features', {cache: 'no-store', signal: controller.signal})
      .then(response => response.json()).then(data => setEnabled(data.emailDeliveryEnabled === true)).catch(() => {});
    return () => controller.abort();
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy || !open || !enabled) return;
    const email = new FormData(event.currentTarget).get('email');
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/auth/${open === 'reset' ? 'request-password-reset' : 'send-verification-email'}`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(open === 'reset'
          ? {email, redirectTo: `${window.location.origin}/reset-password`}
          : {email, callbackURL: `${window.location.origin}/workspace`}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : data?.message || 'No se pudo solicitar el correo.');
      setMessage('Si la cuenta existe y necesita esta acción, recibirá un enlace por correo. Revisa también la carpeta de spam.');
    } catch (error) {setMessage(error instanceof Error ? error.message : 'Revisa tu conexión e intenta nuevamente.');}
    finally {setBusy(false);}
  };
  return <div className="space-y-3 text-sm">
    {enabled ? <div className="flex flex-wrap gap-3">
      <button type="button" onClick={() => {setOpen('reset'); setMessage('');}} className="underline">Olvidé mi contraseña</button>
      <button type="button" onClick={() => {setOpen('verify'); setMessage('');}} className="underline">Verificar mi correo</button>
    </div> : <p className="text-xs text-slate-400">La recuperación de contraseña y verificación de correo necesitan habilitar el servicio de correo del entorno.</p>}
    {open && <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-600 p-3">
      <p>{open === 'reset' ? 'Solicitar un enlace de recuperación' : 'Solicitar verificación de correo'}</p>
      <label className="block">Correo<input required type="email" name="email" autoComplete="email" maxLength={254} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 p-2" /></label>
      <button disabled={busy} className="rounded-lg bg-cyan-300 px-3 py-2 text-slate-950 disabled:opacity-50">{busy ? 'Solicitando…' : 'Solicitar enlace'}</button>
      <button type="button" disabled={busy} onClick={() => {setOpen(null); setMessage(''); onLogin?.();}} className="ml-3 underline">Volver</button>
    </form>}
    {message && <p role="status" className="text-xs text-slate-300">{message}</p>}
  </div>;
}
