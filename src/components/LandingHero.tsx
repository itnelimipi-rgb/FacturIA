'use client';

import React from 'react';

interface LandingHeroProps { onEnterDemo: () => void }

const capabilities = [
  {icon: '📄', title: 'XML originales', text: 'Importa CFDI 3.3 y 4.0 y revisa sus datos e importes. La consulta de vigencia SAT aún está pendiente.'},
  {icon: '🏦', title: 'Movimientos CSV', text: 'Revisa una vista previa e importa movimientos bancarios sin duplicar el mismo registro.'},
  {icon: '🔗', title: 'Conciliación documental', text: 'Compara RFC, dirección, moneda, monto y fecha; decide cuando hay varias coincidencias.'},
  {icon: '💬', title: 'Resúmenes de tus datos', text: 'El asistente por reglas explica los registros disponibles. La integración de IA se añadirá después.'},
];

export const LandingHero: React.FC<LandingHeroProps> = ({onEnterDemo}) => (
  <div className="relative overflow-hidden text-[oklch(0.97_0.01_240)] max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
    <div className="absolute w-[600px] h-[400px] -top-36 left-1/2 -translate-x-1/2 rounded-full pointer-events-none blur-[70px] -z-10" style={{background: 'oklch(0.78 0.15 195 / 0.16)'}} />
    <nav className="flex items-center justify-between pb-10">
      <div className="font-sora font-extrabold text-2xl tracking-tight">factur<span className="text-[oklch(0.78_0.15_195)]">IA</span></div>
      <button onClick={onEnterDemo} className="px-4 py-2 rounded-xl border border-[oklch(0.30_0.03_260)] hover:bg-[oklch(0.24_0.028_260)] text-xs font-semibold">Volver a la aplicación →</button>
    </nav>
    <div className="text-center py-8 sm:py-12 max-w-3xl mx-auto">
      <span className="inline-block px-4 py-1.5 rounded-full bg-[oklch(0.78_0.15_195/0.12)] text-[oklch(0.78_0.15_195)] text-xs font-semibold mb-6">Sprint 1 · piloto en preparación</span>
      <h1 className="font-sora font-extrabold text-3xl sm:text-5xl leading-tight mb-6">Tus movimientos y comprobantes,<br /><span className="bg-linear-to-r from-[oklch(0.72_0.17_155)] to-[oklch(0.78_0.15_195)] bg-clip-text text-transparent">en un mismo lugar.</span></h1>
      <p className="text-sm sm:text-base text-[oklch(0.68_0.03_250)] leading-relaxed mb-8">FacturIA te ayuda a identificar movimientos documentados y pendientes. La demo usa ejemplos; el espacio personal guarda los registros de cada cuenta cuando se habilita el piloto.</p>
      <button onClick={onEnterDemo} className="px-6 py-3.5 rounded-xl bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] font-sora font-bold text-sm shadow-glow hover:brightness-105">Abrir la aplicación</button>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 py-8">
      {capabilities.map(item => <div key={item.title} className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-5"><div className="text-2xl mb-3">{item.icon}</div><h2 className="font-sora font-bold text-sm mb-2">{item.title}</h2><p className="text-xs text-[oklch(0.68_0.03_250)] leading-relaxed">{item.text}</p></div>)}
    </div>
    <section className="my-10 rounded-3xl p-6 sm:p-8 border border-[oklch(0.72_0.17_155/0.4)] bg-linear-to-r from-[oklch(0.32_0.10_165)] to-[oklch(0.24_0.08_165)]">
      <h2 className="font-sora font-bold text-xl mb-3">Lo que sigue</h2>
      <p className="text-sm leading-relaxed text-[oklch(0.90_0.01_240)]">Primero probaremos cuentas y persistencia en un entorno separado. Después conectaremos OCR, IA, consultas oficiales SAT/EFOS, bancos y WhatsApp. Los cálculos fiscales requieren reglas revisadas antes de habilitarse.</p>
    </section>
    <footer className="pt-8 border-t border-[oklch(0.30_0.03_260)] text-xs text-[oklch(0.68_0.03_250)]">© 2026 FacturIA · Demostración y piloto de conciliación documental</footer>
  </div>
);
