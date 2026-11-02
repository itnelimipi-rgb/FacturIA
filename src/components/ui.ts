/** Shared class names so every screen uses the same buttons, cards and status colors. */
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200';

export const ui = {
  card: 'rounded-2xl border border-white/10 bg-[oklch(0.21_0.025_260)]',
  softCard: 'rounded-xl border border-white/10 bg-[oklch(0.18_0.02_260)]',
  primary: `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] px-4 py-2 text-sm font-semibold text-[oklch(0.15_0.03_260)] shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
  secondary: `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
  choose: `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-200 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-100 disabled:opacity-50 ${focus}`,
  quiet: `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white disabled:opacity-50 ${focus}`,
  link: `rounded text-sm font-semibold text-cyan-200 underline underline-offset-4 hover:text-cyan-100 ${focus}`,
  input: 'mt-1 block min-h-11 w-full rounded-xl border border-white/15 bg-[oklch(0.16_0.02_260)] px-3 py-2 text-base text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none disabled:opacity-60',
  label: 'block text-sm font-medium text-slate-200',
  muted: 'text-sm text-slate-400',
  focus,
};

export const toneClasses = {
  done: 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200',
  choose: 'border-amber-700/60 bg-amber-950/40 text-amber-200',
  missing: 'border-white/15 bg-white/5 text-slate-200',
  paused: 'border-sky-800/60 bg-sky-950/40 text-sky-200',
} as const;
