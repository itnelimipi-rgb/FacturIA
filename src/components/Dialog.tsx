'use client';

import React, {useCallback, useId} from 'react';
import {X} from 'lucide-react';
import {useDialogFocus} from '../lib/useDialogFocus';

/** Modal dialog: bottom sheet on phones, centered card on larger screens. */
export function Dialog({title, description, onClose, busy = false, closeLabel = 'Cerrar', width = 'max-w-2xl', footer, children}: {
  title: React.ReactNode; description?: React.ReactNode; onClose: () => void; busy?: boolean;
  closeLabel?: string; width?: string; footer?: React.ReactNode; children: React.ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  const dialogRef = useDialogFocus(true, close);
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-xs sm:items-center sm:p-4">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}
      className={`flex max-h-[94vh] w-full ${width} flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[oklch(0.18_0.02_260)] text-slate-100 shadow-2xl sm:rounded-2xl`}>
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="font-sora text-lg font-bold text-white">{title}</h2>
          {description && <p id={descriptionId} className="mt-1 text-sm text-slate-300">{description}</p>}
        </div>
        <button type="button" onClick={close} disabled={busy} aria-label={closeLabel}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-cyan-200">
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      {footer && <div className="border-t border-white/10 bg-[oklch(0.16_0.02_260)] px-5 py-4">{footer}</div>}
    </div>
  </div>;
}
