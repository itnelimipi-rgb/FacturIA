'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import FacturiaDashboard from './FacturiaDashboard';
import type { Profile, BankTransaction, CfdiRecord } from '../lib/types';

type Snapshot = {profile: Profile | null; transactions: BankTransaction[]; cfdis: CfdiRecord[]};
export default function WorkspaceGate() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [state, setState] = useState<'loading' | 'login' | 'profile' | 'ready' | 'unavailable'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [register, setRegister] = useState(false);

  const load = async () => {
    const response = await fetch('/api/workspace', {cache: 'no-store'});
    if (response.status === 401) {setSnapshot(null); setState('login'); return;}
    if (!response.ok) {setSnapshot(null); setState('unavailable'); return;}
    const data: Snapshot = await response.json();
    setSnapshot(data); setState(data.profile ? 'ready' : 'profile');
  };
  // Load the authenticated external server snapshot asynchronously.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {load().catch(() => setState('unavailable'));}, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = state === 'profile'
        ? await fetch('/api/workspace', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'profile', profile: fields})})
        : await fetch(register ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(fields)});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || (typeof data.error === 'string' ? data.error : null) || data.message || 'No se pudo completar la operación');
      await load();
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'Error de conexión');}
    finally {setBusy(false);}
  };

  const signOut = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/sign-out', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || (typeof data?.error === 'string' ? data.error : data?.error?.message) || 'No se pudo cerrar la sesión; inténtalo de nuevo.');
      }
      setSnapshot(null); setRegister(false); setState('login');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo cerrar la sesión; revisa tu conexión.');
    } finally {setBusy(false);}
  };

  if (state === 'ready' && snapshot?.profile) return <>
    <div className="bg-slate-900 px-6 py-2 text-right text-sm text-white">
      {error && <p role="alert" className="mb-1 text-red-300">{error}</p>}
      <button disabled={busy} onClick={signOut} className="disabled:opacity-50">{busy ? 'Cerrando sesión…' : 'Cerrar sesión'}</button>
    </div>
    <FacturiaDashboard mode="workspace" initialSnapshot={{...snapshot, profile: snapshot.profile}} />
  </>;
  return <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
    <section className="max-w-md w-full space-y-5 border border-slate-700 rounded-2xl p-7">
      <p className="text-sm text-cyan-300">FacturIA · Mi espacio</p>
      <h1 className="text-2xl font-semibold">{state === 'profile' ? 'Tu perfil fiscal' : 'Tus documentos y movimientos'}</h1>
      {state === 'loading' ? <p>Cargando tu espacio…</p> : state === 'unavailable' ? <p>El espacio de pruebas todavía no está activado. La demostración sigue disponible.</p> : <form onSubmit={submit} className="space-y-4">
        {state === 'profile' ? <>
          <label className="block text-sm">RFC<input required name="rfc" maxLength={13} autoCapitalize="characters" className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2" /></label>
          <label className="block text-sm">Nombre o razón social<input required name="businessName" minLength={2} maxLength={200} className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2" /></label>
          <label className="block text-sm">Régimen fiscal<select name="regimeCode" className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2"><option value="626">626 · RESICO</option><option value="612">612 · Actividad empresarial</option><option value="601">601 · General de ley personas morales</option><option value="605">605 · Sueldos y salarios</option></select></label>
          <p className="text-xs text-slate-400">El régimen se guarda como dato de tu perfil. Las reglas de cálculo de impuestos aún necesitan validación.</p>
        </> : <>
          {register && <label className="block text-sm">Nombre<input name="name" required minLength={2} autoComplete="name" className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2" /></label>}
          <label className="block text-sm">Correo<input name="email" type="email" required autoComplete="email" className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2" /></label>
          <label className="block text-sm">Contraseña<input name="password" type="password" required minLength={12} autoComplete={register ? 'new-password' : 'current-password'} className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2" /></label>
          <p className="text-xs text-slate-400">La creación de cuentas debe estar habilitada por el administrador del entorno de pruebas.</p>
        </>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <button disabled={busy} className="bg-cyan-300 text-slate-950 rounded-lg px-4 py-2 font-semibold disabled:opacity-50">{busy ? 'Guardando…' : state === 'profile' ? 'Guardar perfil' : register ? 'Crear cuenta de prueba' : 'Iniciar sesión'}</button>
        {state === 'login' && <button type="button" onClick={() => {setRegister(!register); setError('');}} className="block text-sm underline">{register ? 'Ya tengo cuenta' : 'Crear cuenta de prueba'}</button>}
      </form>}
      {state === 'profile' && <button type="button" disabled={busy} onClick={signOut} className="block text-sm underline disabled:opacity-50">Cerrar sesión</button>}
      <Link href="/demo" className="inline-block text-sm underline text-slate-300">Abrir demostración</Link>
    </section>
  </main>;
}
