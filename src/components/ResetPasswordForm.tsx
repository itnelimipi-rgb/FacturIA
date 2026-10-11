'use client';
import Link from 'next/link';
import {useEffect, useState, type FormEvent} from 'react';

export default function ResetPasswordForm() {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token') ?? '';
    // Keep the secret only in component memory and out of subsequent referrers/history.
    window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(value.length <= 200 ? value : '');
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy || !token) return;
    const fields = new FormData(event.currentTarget);
    const newPassword = fields.get('password');
    if (newPassword !== fields.get('confirm')) {setMessage('Las contraseñas no coinciden.'); return;}
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/auth/reset-password', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token, newPassword})});
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || 'El enlace es inválido o ha expirado. Solicita otro enlace de recuperación.');
      setToken(''); setComplete(true);
    } catch (error) {setMessage(error instanceof Error ? error.message : 'No se pudo restablecer la contraseña.');}
    finally {setBusy(false);}
  };
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
    <section className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 p-7">
      <h1 className="text-2xl font-semibold">Restablecer contraseña</h1>
      {complete ? <p role="status">Contraseña actualizada. Inicia sesión de nuevo; las sesiones anteriores se cerraron.</p> : !token ? <p>Abre el enlace vigente que recibiste por correo para continuar.</p> : <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">Nueva contraseña<input name="password" required type="password" minLength={12} maxLength={128} autoComplete="new-password" className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 p-2" /></label>
        <label className="block text-sm">Confirmar contraseña<input name="confirm" required type="password" minLength={12} maxLength={128} autoComplete="new-password" className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 p-2" /></label>
        <button disabled={busy} className="rounded-lg bg-cyan-300 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
      </form>}
      {message && <p role="alert" className="text-sm text-red-300">{message}</p>}
      <Link href="/workspace" className="block text-sm text-cyan-300 underline">Volver a Mi espacio</Link>
    </section>
  </main>;
}
