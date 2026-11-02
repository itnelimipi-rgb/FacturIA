'use client';

import React, {useEffect, useId, useRef, useState} from 'react';
import Link from 'next/link';
import {ChevronDown, Download, Info, LogIn, LogOut, RotateCcw} from 'lucide-react';
import type {Profile} from '../lib/types';
import {ui} from './ui';

/** Account actions that are rarely needed stay one click away instead of crowding every screen. */
export function AccountMenu({profile, demoMode, busy, onDownloads, onAbout, onReset, onSignOut}: {
  profile: Profile; demoMode: boolean; busy?: boolean;
  onDownloads: () => void; onAbout: () => void; onReset?: () => void; onSignOut?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!containerRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  const choose = (action?: () => void) => () => { setOpen(false); action?.(); };
  const item = `flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5 hover:text-white disabled:opacity-50 ${ui.focus}`;
  const initials = profile.businessName.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'FI';

  return <div ref={containerRef} className="relative">
    <button ref={buttonRef} type="button" aria-haspopup="true" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(value => !value)}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 py-1 pl-1 pr-3 text-sm text-white hover:bg-white/5 ${ui.focus}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-xs font-bold text-[oklch(0.15_0.03_260)]">{initials}</span>
      <span className="sr-only">Menú de la cuenta</span>
      <ChevronDown aria-hidden="true" className="h-4 w-4 text-slate-400" />
    </button>
    {open && <div id={menuId} className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-white/10 bg-[oklch(0.20_0.025_260)] p-2 shadow-2xl">
      <div className="border-b border-white/10 px-3 pb-3 pt-2">
        <p className="break-words font-semibold text-white">{profile.businessName}</p>
        <p className="font-mono text-xs text-slate-400">{demoMode ? 'Datos de ejemplo' : `RFC ${profile.rfc}`}</p>
      </div>
      <div className="space-y-0.5 pt-2">
        <button type="button" onClick={choose(onDownloads)} className={item}><Download aria-hidden="true" className="h-4 w-4" />Descargar mis datos</button>
        <button type="button" onClick={choose(onAbout)} className={item}><Info aria-hidden="true" className="h-4 w-4" />Acerca de FacturIA</button>
        {demoMode && onReset && <button type="button" onClick={choose(onReset)} className={item}><RotateCcw aria-hidden="true" className="h-4 w-4" />Reiniciar ejemplos</button>}
        {demoMode ? <Link href="/workspace" className={item}><LogIn aria-hidden="true" className="h-4 w-4" />Entrar o crear mi cuenta</Link>
          : <Link href="/demo" className={item}><Info aria-hidden="true" className="h-4 w-4" />Ver la demo con ejemplos</Link>}
        {!demoMode && onSignOut && <button type="button" disabled={busy} onClick={choose(onSignOut)} className={item}><LogOut aria-hidden="true" className="h-4 w-4" />{busy ? 'Cerrando sesión…' : 'Cerrar sesión'}</button>}
      </div>
    </div>}
  </div>;
}
