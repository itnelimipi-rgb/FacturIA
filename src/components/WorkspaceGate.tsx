'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, FileCode2, Loader2, Shield, UploadCloud } from 'lucide-react';
import FacturiaDashboard from './FacturiaDashboard';
import { AccountEmailControls } from './AccountEmailControls';
import { XmlCfdiParser } from '../lib/xmlParser';
import { REGIME_OPTIONS, regimeLabel, suggestProfile, type ProfileCandidate } from '../lib/profileDetection';
import type { Profile, BankTransaction, CfdiRecord } from '../lib/types';
import { ui } from './ui';

type Snapshot = {profile: Profile | null; transactions: BankTransaction[]; cfdis: CfdiRecord[]};
type Detection = {candidates: ProfileCandidate[]; chosen: ProfileCandidate | null; xml: string[]; invalid: number};

const errorMessage = (data: unknown, fallback: string) => {
  const value = data as {error?: unknown; message?: unknown} | null;
  if (typeof value?.error === 'string') return value.error;
  if (value?.error && typeof (value.error as {message?: unknown}).message === 'string') return (value.error as {message: string}).message;
  return typeof value?.message === 'string' ? value.message : fallback;
};

function Shell({children}: {children: ReactNode}) {
  return <main className="flex min-h-screen items-center justify-center bg-[oklch(0.16_0.02_260)] px-4 py-10 text-slate-100">
    <div className="w-full max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-tr from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] shadow-glow"><Shield aria-hidden="true" className="h-5 w-5" /></span>
        <p className="font-sora text-xl font-extrabold tracking-tight">Factur<span className="text-[oklch(0.78_0.15_195)]">IA</span></p>
      </div>
      {children}
    </div>
  </main>;
}

export default function WorkspaceGate() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [state, setState] = useState<'loading' | 'login' | 'profile' | 'ready' | 'unavailable'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [register, setRegister] = useState(false);
  const [signUpEnabled, setSignUpEnabled] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [manualProfile, setManualProfile] = useState(false);
  const [profileRegime, setProfileRegime] = useState('');
  const [detection, setDetection] = useState<Detection | null>(null);
  const [importing, setImporting] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

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
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/account/features', {cache: 'no-store', signal: controller.signal}).then(response => response.json())
      .then(data => setSignUpEnabled(data?.signUpEnabled !== false)).catch(() => {});
    return () => controller.abort();
  }, []);

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(register ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(fields)});
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(data, register ? 'No se pudo crear la cuenta.' : 'Correo o contraseña incorrectos.'));
      await load();
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'Revisa tu conexión e intenta de nuevo.');}
    finally {setBusy(false);}
  };

  const saveProfile = async (profile: {rfc: string; businessName: string; regimeCode: string}, xml: string[] = []) => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/workspace', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'profile', profile})});
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(data, 'No se pudieron guardar tus datos.'));
      for (const [index, rawXml] of xml.entries()) {
        setImporting(`Guardando tus facturas (${index + 1} de ${xml.length})…`);
        // A document of another RFC or a repeated one is skipped; the profile is already saved.
        await fetch('/api/workspace', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'xml', rawXml})}).catch(() => null);
      }
      await load();
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'Revisa tu conexión e intenta de nuevo.');}
    finally {setBusy(false); setImporting('');}
  };

  const detectFromFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter(file => file.name.toLowerCase().endsWith('.xml') && file.size <= 2 * 1024 * 1024);
    if (!list.length) { setError('Elige uno o varios archivos XML de tus facturas.'); return; }
    setError('');
    const parties = [];
    const xml: string[] = [];
    let invalid = 0;
    for (const file of list.slice(0, 50)) {
      const text = await file.text();
      const parsed = XmlCfdiParser.parse(text, 'profile-detection');
      if (parsed.success && parsed.parties) { parties.push(parsed.parties); xml.push(text); } else invalid++;
    }
    if (!parties.length) { setError('No encontramos facturas válidas en esos archivos. Revisa que sean XML de facturas (CFDI).'); return; }
    const suggestion = suggestProfile(parties);
    setDetection({candidates: suggestion.candidates.slice(0, 6), chosen: suggestion.detected ?? null, xml, invalid});
    setProfileRegime(suggestion.detected?.regime ?? '');
  };

  const signOut = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/sign-out', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null), 'No se pudo cerrar la sesión; inténtalo de nuevo.'));
      setSnapshot(null); setRegister(false); setDetection(null); setManualProfile(false); setProfileRegime(''); setState('login');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo cerrar la sesión; revisa tu conexión.');
    } finally {setBusy(false);}
  };

  if (state === 'ready' && snapshot?.profile) return <>
    {error && <p role="alert" className="bg-rose-950 px-6 py-2 text-center text-sm text-rose-100">{error}</p>}
    <FacturiaDashboard mode="workspace" initialSnapshot={{...snapshot, profile: snapshot.profile}} onSignOut={() => void signOut()} signingOut={busy} />
  </>;

  if (state === 'loading') return <Shell><p role="status" className="flex items-center gap-2 text-slate-300"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />Abriendo tu espacio…</p></Shell>;
  if (state === 'unavailable') return <Shell><div className={`${ui.card} space-y-4 p-6`}>
    <p role="alert" className="text-slate-200">No pudimos abrir tu espacio. Intenta de nuevo o prueba la demo con ejemplos.</p>
    <div className="flex flex-wrap gap-2"><button type="button" onClick={() => {setState('loading'); void load().catch(() => setState('unavailable'));}} className={ui.primary}>Intentar de nuevo</button><Link href="/demo" className={ui.secondary}>Ver la demo</Link></div>
  </div></Shell>;

  if (state === 'profile') {
    const chosen = detection?.chosen;
    return <Shell><div className={`${ui.card} space-y-5 p-6 sm:p-7`}>
      <div>
        <p className="text-sm text-cyan-200">Último paso</p>
        <h1 className="mt-1 font-sora text-2xl font-bold text-white">Configura tu negocio</h1>
        <p className="mt-2 text-sm text-slate-300">Necesitamos tu RFC para saber qué facturas emitiste y cuáles recibiste. No te pedimos contraseñas del SAT.</p>
      </div>

      {importing && <p role="status" className="flex items-center gap-2 text-cyan-100"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />{importing}</p>}

      {!manualProfile && !detection && <div className="space-y-3">
        <input ref={fileInput} type="file" accept=".xml" multiple className="hidden" aria-label="Elegir facturas XML" onChange={event => { void detectFromFiles(event.target.files); event.target.value = ''; }} />
        <button type="button" onClick={() => fileInput.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void detectFromFiles(event.dataTransfer.files); }}
          className={`flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/15 bg-[oklch(0.16_0.02_260)] p-6 text-center hover:border-cyan-300/60 ${ui.focus}`}>
          <UploadCloud aria-hidden="true" className="h-8 w-8 text-cyan-200" />
          <span className="font-semibold text-white">Sube algunas de tus facturas XML</span>
          <span className="text-sm text-slate-400">Tomamos tu RFC, nombre y régimen de ellas, y las guardamos en tu cuenta.</span>
        </button>
        <button type="button" onClick={() => setManualProfile(true)} className={ui.link}>Prefiero escribir mis datos</button>
      </div>}

      {!manualProfile && detection && !chosen && <fieldset className="space-y-3">
        <legend className="font-semibold text-white">¿Cuál de estos eres tú?</legend>
        <p className="text-sm text-slate-400">Aparecen en las facturas que subiste.</p>
        {detection.candidates.map(candidate => <button key={candidate.rfc} type="button" onClick={() => { setDetection({...detection, chosen: candidate}); setProfileRegime(candidate.regime); }}
          className={`${ui.softCard} flex w-full items-start gap-3 p-4 text-left hover:border-cyan-300/60 ${ui.focus}`}>
          <FileCode2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" />
          <span><span className="block font-semibold text-white">{candidate.name || candidate.rfc}</span><span className="block font-mono text-sm text-slate-400">{candidate.rfc}</span><span className="block text-xs text-slate-500">En {candidate.documents} de {detection.xml.length} {detection.xml.length === 1 ? 'factura' : 'facturas'}</span></span>
        </button>)}
        <button type="button" onClick={() => setDetection(null)} className={ui.quiet}>Elegir otras facturas</button>
      </fieldset>}

      {!manualProfile && chosen && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void saveProfile({rfc: chosen.rfc, businessName: new FormData(event.currentTarget).get('businessName') as string, regimeCode: profileRegime}, detection!.xml); }}>
        <div className={`${ui.softCard} p-4`}>
          <p className="text-sm text-emerald-300">Encontramos tus datos</p>
          <p className="mt-1 font-mono text-lg text-white">{chosen.rfc}</p>
        </div>
        <label className={ui.label}>Nombre de tu negocio<input name="businessName" required minLength={2} maxLength={200} defaultValue={chosen.name} className={ui.input} /></label>
        <label className={ui.label}>Régimen fiscal
          <select required value={profileRegime} onChange={event => setProfileRegime(event.target.value)} className={ui.input}>
            <option value="" disabled>Elige el de tu constancia de situación fiscal</option>
            {chosen.regime && !REGIME_OPTIONS.some(([code]) => code === chosen.regime) && <option value={chosen.regime}>{chosen.regime}</option>}
            {REGIME_OPTIONS.map(([code]) => <option key={code} value={code}>{regimeLabel(code)}</option>)}
          </select>
        </label>
        {chosen.regime && <p className="-mt-2 text-xs text-slate-400">Lo tomamos de tus facturas. Cámbialo si no corresponde.</p>}
        <p className="text-sm text-slate-300">Al continuar guardaremos {detection!.xml.length} {detection!.xml.length === 1 ? 'factura' : 'facturas'} en tu cuenta.{detection!.invalid ? ` ${detection!.invalid} ${detection!.invalid === 1 ? 'archivo no era' : 'archivos no eran'} una factura válida.` : ''}</p>
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} className={ui.primary}>{busy ? 'Guardando…' : 'Sí, son mis datos'}</button>
          <button type="button" disabled={busy} onClick={() => setDetection(detection!.candidates.length > 1 ? {...detection!, chosen: null} : null)} className={ui.quiet}>No soy yo</button>
        </div>
      </form>}

      {manualProfile && <form className="space-y-4" onSubmit={event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        void saveProfile({rfc: String(fields.get('rfc') ?? '').trim().toUpperCase(), businessName: String(fields.get('businessName') ?? ''), regimeCode: profileRegime === 'other' ? String(fields.get('regimeCode') ?? '') : profileRegime});
      }}>
        <label className={ui.label}>Tu RFC<input required name="rfc" maxLength={13} autoCapitalize="characters" autoComplete="off" className={`${ui.input} font-mono uppercase`} /></label>
        <p className="-mt-2 text-xs text-slate-400">Tal como aparece en tus facturas o en tu constancia de situación fiscal.</p>
        <label className={ui.label}>Nombre de tu negocio<input required name="businessName" minLength={2} maxLength={200} className={ui.input} /></label>
        <label className={ui.label}>Régimen fiscal
          <select required value={profileRegime} onChange={event => setProfileRegime(event.target.value)} className={ui.input}>
            <option value="" disabled>Elige el de tu constancia de situación fiscal</option>
            {REGIME_OPTIONS.map(([code]) => <option key={code} value={code}>{regimeLabel(code)}</option>)}
            <option value="other">Otro (escribir el código)</option>
          </select>
        </label>
        {profileRegime === 'other' && <label className={ui.label}>Código de tu régimen<input required name="regimeCode" pattern="[0-9]{3}" maxLength={3} inputMode="numeric" placeholder="Tres dígitos" className={ui.input} /></label>}
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} className={ui.primary}>{busy ? 'Guardando…' : 'Guardar y continuar'}</button>
          <button type="button" disabled={busy} onClick={() => { setManualProfile(false); setError(''); }} className={ui.quiet}>Mejor subir facturas</button>
        </div>
      </form>}

      {!chosen && !manualProfile && error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void signOut()} className={ui.link}>Cerrar sesión</button>
    </div></Shell>;
  }

  return <Shell><div className={`${ui.card} space-y-5 p-6 sm:p-7`}>
    <div>
      <h1 className="font-sora text-2xl font-bold text-white">{register ? 'Crea tu cuenta' : 'Entra a tu cuenta'}</h1>
      <p className="mt-2 text-sm text-slate-300">{register ? 'Guarda tus facturas y movimientos en un solo lugar.' : 'Tus facturas y movimientos te esperan.'} En este piloto usa datos de prueba.</p>
    </div>
    {signUpEnabled && <div role="tablist" aria-label="Entrar o crear cuenta" className="grid grid-cols-2 rounded-xl border border-white/10 p-1">
      {[{value: false, label: 'Entrar'}, {value: true, label: 'Crear cuenta'}].map(tab => <button key={tab.label} type="button" role="tab" aria-selected={register === tab.value}
        onClick={() => { setRegister(tab.value); setError(''); }}
        className={`min-h-10 rounded-lg text-sm font-semibold ${ui.focus} ${register === tab.value ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}>{tab.label}</button>)}
    </div>}
    <form key={register ? 'register' : 'login'} onSubmit={authenticate} className="space-y-4">
      {register && <label className={ui.label}>Tu nombre<input name="name" required minLength={2} autoComplete="name" className={ui.input} /></label>}
      <label className={ui.label}>Correo<input name="email" type="email" required autoComplete="email" className={ui.input} /></label>
      <label className={ui.label}>Contraseña
        <span className="relative block">
          <input name="password" type={showPassword ? 'text' : 'password'} required minLength={12} autoComplete={register ? 'new-password' : 'current-password'} className={`${ui.input} pr-12`} />
          <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} className="absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:text-white">{showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}</button>
        </span>
      </label>
      {register && <p className="-mt-2 text-xs text-slate-400">Mínimo 12 caracteres.</p>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <button disabled={busy} className={`${ui.primary} w-full`}>{busy ? (register ? 'Creando tu cuenta…' : 'Entrando…') : register ? 'Crear cuenta' : 'Entrar'}</button>
    </form>
    {!register && <AccountEmailControls onLogin={() => setRegister(false)} />}
    <p className="text-sm text-slate-400">¿Sólo quieres ver cómo funciona? <Link href="/demo" className={ui.link}>Abrir la demo</Link></p>
  </div></Shell>;
}
