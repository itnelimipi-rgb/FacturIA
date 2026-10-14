'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import FacturiaDashboard from './FacturiaDashboard';
import {AccountEmailControls} from './AccountEmailControls';
import type { Profile, BankTransaction, CfdiRecord } from '../lib/types';

type Snapshot = {profile: Profile | null; transactions: BankTransaction[]; cfdis: CfdiRecord[]};
export default function WorkspaceGate() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [state, setState] = useState<'loading' | 'login' | 'profile' | 'ready' | 'unavailable'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [register, setRegister] = useState(false);
  const [profileRegime, setProfileRegime] = useState('');

  const load = async () => {
    const response = await fetch('/api/workspace', {cache: 'no-store'});
    if (response.status === 401) {setSnapshot(null); setProfileRegime(''); setState('login'); return;}
    if (!response.ok) {setSnapshot(null); setState('unavailable'); return;}
    const data: Snapshot = await response.json();
    setSnapshot(data); if (!data.profile) setProfileRegime(''); setState(data.profile ? 'ready' : 'profile');
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
      setSnapshot(null); setRegister(false); setProfileRegime(''); setState('login');
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
      <h1 className="text-2xl font-semibold">{state === 'profile' ? '¿A nombre de quién están tus facturas?' : register ? 'Crea tu espacio de prueba' : 'Entra a tu espacio'}</h1>
      {state === 'loading' ? <p role="status">Cargando tu espacio…</p> : state === 'unavailable' ? <><p role="alert">No pudimos abrir tu espacio. Puedes intentar de nuevo o probar con los ejemplos.</p><button type="button" onClick={() => {setState('loading'); void load().catch(() => setState('unavailable'));}} className="rounded-lg border border-slate-500 px-4 py-2">Intentar de nuevo</button></> : <form key={state === 'profile' ? 'profile' : register ? 'register' : 'login'} onSubmit={submit} className="space-y-4">
        {state === 'profile' ? <>
          <p className="text-sm text-slate-300">Tu cuenta ya está creada. Estos datos permiten distinguir las facturas que recibes de las que emites.</p>
          <label className="block text-sm">Tu RFC<input required name="rfc" maxLength={13} autoCapitalize="characters" aria-describedby="profile-rfc-help" className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2" /></label>
          <p id="profile-rfc-help" className="text-sm text-slate-300">Copia tu identificador fiscal tal como aparece en tus facturas o constancia de situación fiscal. No necesitas contraseña del SAT.</p>
          <label className="block text-sm">Nombre que aparece en tus facturas<input required name="businessName" minLength={2} maxLength={200} className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2" /></label>
          <label className="block text-sm">Régimen registrado en el SAT<select required value={profileRegime} onChange={event => setProfileRegime(event.target.value)} name={profileRegime === 'other' ? 'regimeSelection' : 'regimeCode'} aria-describedby="profile-regime-help" className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2"><option value="" disabled>Selecciona el que aparece en tu constancia</option><option value="626">626 · Régimen Simplificado de Confianza (RESICO)</option><option value="612">612 · Actividad empresarial</option><option value="601">601 · General de ley personas morales</option><option value="605">605 · Sueldos y salarios</option><option value="other">Mi régimen no aparece en la lista</option></select></label>
          {profileRegime === 'other' && <label className="block text-sm">Código de tu régimen<input required name="regimeCode" pattern="[0-9]{3}" maxLength={3} inputMode="numeric" aria-describedby="profile-regime-help" placeholder="Copia el código de tres dígitos" className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2" /></label>}
          <p id="profile-regime-help" className="text-sm text-slate-300">Si no sabes cuál es, revisa tu constancia antes de elegir. No seleccionamos uno por ti. Por ahora se guarda como dato del perfil; FacturIA no calcula tus impuestos.</p>
        </> : <>
          {register && <label className="block text-sm">Nombre<input name="name" required minLength={2} autoComplete="name" className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2" /></label>}
          <label className="block text-sm">Correo<input name="email" type="email" required autoComplete="email" className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2" /></label>
          <label className="block text-sm">Contraseña<input name="password" type="password" required minLength={12} autoComplete={register ? 'new-password' : 'current-password'} className="block mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg p-2" /></label>
          <p className="text-sm text-slate-300">{register ? 'La contraseña debe tener al menos 12 caracteres. En este piloto usa documentos y datos de prueba.' : 'Tus documentos y movimientos se conservan al cerrar sesión. Puedes pegar tu contraseña desde tu gestor.'}</p>
        </>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <button disabled={busy} className="bg-cyan-300 text-slate-950 rounded-lg px-4 py-2 font-semibold disabled:opacity-50">{busy ? state === 'profile' ? 'Guardando tus datos…' : register ? 'Creando tu cuenta…' : 'Entrando…' : state === 'profile' ? 'Guardar datos y abrir mi espacio' : register ? 'Crear cuenta de prueba' : 'Iniciar sesión'}</button>
        {state === 'login' && <button type="button" onClick={() => {setRegister(!register); setError('');}} className="block text-sm underline">{register ? 'Ya tengo cuenta' : 'Crear cuenta de prueba'}</button>}
      </form>}
      {state === 'profile' && <button type="button" disabled={busy} onClick={signOut} className="block text-sm underline disabled:opacity-50">Cerrar sesión</button>}
      {state === 'login' && <AccountEmailControls onLogin={() => setRegister(false)} />}
      <Link href="/demo" className="inline-block text-sm underline text-slate-300">Abrir demostración</Link>
    </section>
  </main>;
}
