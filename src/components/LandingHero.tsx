'use client';

import React from 'react';
import { ArrowRight, Sparkles, Shield, Zap, MessageSquare, Check, Star } from 'lucide-react';

interface LandingHeroProps {
  onEnterDemo: () => void;
}

export const LandingHero: React.FC<LandingHeroProps> = ({ onEnterDemo }) => {
  const scrollToSteps = () => {
    document.getElementById('steps-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="relative overflow-hidden text-[oklch(0.97_0.01_240)] max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
      {/* Orbes de brillo */}
      <div
        className="absolute w-[600px] h-[400px] -top-36 left-1/2 -translate-x-1/2 rounded-full pointer-events-none blur-[70px] -z-10"
        style={{ background: 'oklch(0.78 0.15 195 / 0.16)' }}
      />
      <div
        className="absolute w-[360px] h-[360px] top-10 right-0 rounded-full pointer-events-none blur-[65px] -z-10"
        style={{ background: 'oklch(0.65 0.20 295 / 0.14)' }}
      />

      {/* Nav de Landing */}
      <nav className="flex items-center justify-between pb-10">
        <div className="font-sora font-extrabold text-2xl tracking-tight">
          <span className="bg-gradient-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] bg-clip-text text-transparent">
            factur
          </span>
          <span className="text-[oklch(0.78_0.15_195)]">IA</span>
        </div>
        <button
          onClick={onEnterDemo}
          className="px-4 py-2 rounded-xl border border-[oklch(0.30_0.03_260)] hover:bg-[oklch(0.24_0.028_260)] text-xs font-semibold flex items-center gap-1.5 transition-all"
        >
          Ver demo →
        </button>
      </nav>

      {/* Hero */}
      <div className="text-center py-8 sm:py-12 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[oklch(0.78_0.15_195/0.12)] border border-[oklch(0.78_0.15_195/0.35)] text-[oklch(0.78_0.15_195)] text-xs font-semibold mb-6">
          <span>✦</span> Extrae · Optimiza · Timbra — en 3 segundos
        </div>

        <h1 className="font-sora font-extrabold text-3xl sm:text-5xl lg:text-6xl tracking-tight leading-[1.1] mb-6">
          Automatiza tu contabilidad.<br />
          <span className="bg-gradient-to-r from-[oklch(0.72_0.17_155)] to-[oklch(0.78_0.15_195)] bg-clip-text text-transparent">
            Paga menos impuestos.
          </span>
        </h1>

        <p className="text-sm sm:text-base text-[oklch(0.68_0.03_250)] max-w-xl mx-auto leading-relaxed mb-8">
          Toma una foto de cualquier factura — la IA extrae los datos, calcula tu ahorro ISR automáticamente y la manda a conciliar. Sin captura manual.
        </p>

        {/* Botones de acción */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
          <button
            onClick={onEnterDemo}
            className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] font-sora font-bold text-sm shadow-glow hover:brightness-105 transition-all flex items-center gap-2"
          >
            🚀 Entrar a la demo
          </button>
          <button
            onClick={scrollToSteps}
            className="px-6 py-3.5 rounded-xl border border-[oklch(0.30_0.03_260)] hover:bg-[oklch(0.24_0.028_260)] text-sm font-semibold transition-all"
          >
            Ver cómo funciona ↓
          </button>
        </div>

        {/* Badges de confianza */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-[oklch(0.68_0.03_250)]">
          <span className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] px-3 py-1 rounded-full">
            ✓ Sin tarjeta de crédito
          </span>
          <span className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] px-3 py-1 rounded-full">
            ✓ 10 facturas gratis/mes
          </span>
          <span className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] px-3 py-1 rounded-full">
            ✓ Cancela cuando quieras
          </span>
        </div>
      </div>

      {/* Grid de 4 Características */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 my-14">
        <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-5 hover:border-[oklch(0.78_0.15_195/0.5)] transition-all">
          <div className="w-10 h-10 rounded-xl bg-[oklch(0.78_0.15_195/0.16)] text-[oklch(0.78_0.15_195)] flex items-center justify-center text-lg mb-3">
            ✦
          </div>
          <b className="font-sora text-sm block mb-1">OCR con IA & XML Nativo</b>
          <p className="text-xs text-[oklch(0.68_0.03_250)] leading-relaxed">
            Extrae emisor, RFC, totales y Uso de CFDI en 0 tokens para XML y pocos segundos en tickets.
          </p>
        </div>

        <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-5 hover:border-[oklch(0.72_0.17_155/0.5)] transition-all">
          <div className="w-10 h-10 rounded-xl bg-[oklch(0.72_0.17_155/0.16)] text-[oklch(0.72_0.17_155)] flex items-center justify-center text-lg mb-3">
            🛡
          </div>
          <b className="font-sora text-sm block mb-1">Escudo Fiscal ISR</b>
          <p className="text-xs text-[oklch(0.68_0.03_250)] leading-relaxed">
            Calcula tu ahorro fiscal en cada factura según el Art. 151 LISR y RESICO, en tiempo real.
          </p>
        </div>

        <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-5 hover:border-[oklch(0.65_0.20_295/0.5)] transition-all">
          <div className="w-10 h-10 rounded-xl bg-[oklch(0.65_0.20_295/0.16)] text-[oklch(0.65_0.20_295)] flex items-center justify-center text-lg mb-3">
            🏷
          </div>
          <b className="font-sora text-sm block mb-1">Conciliación en 1 Clic</b>
          <p className="text-xs text-[oklch(0.68_0.03_250)] leading-relaxed">
            Motor determinista puro con tolerancia de ±3 días y resolución instantánea de ambigüedades.
          </p>
        </div>

        <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-5 hover:border-[oklch(0.80_0.16_75/0.5)] transition-all">
          <div className="w-10 h-10 rounded-xl bg-[oklch(0.80_0.16_75/0.16)] text-[oklch(0.80_0.16_75)] flex items-center justify-center text-lg mb-3">
            💬
          </div>
          <b className="font-sora text-sm block mb-1">WhatsApp Inbound</b>
          <p className="text-xs text-[oklch(0.68_0.03_250)] leading-relaxed">
            Tus clientes o tú mandan la foto del comprobante por WhatsApp y entra directo al sistema.
          </p>
        </div>
      </div>

      {/* Ticker de Métricas SAT */}
      <div className="border-y border-[oklch(0.30_0.03_260)] py-6 my-12 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
        <div>
          <div className="font-mono text-2xl sm:text-3xl font-bold text-[oklch(0.78_0.15_195)]">9.5M</div>
          <div className="text-xs text-[oklch(0.68_0.03_250)] mt-1">CFDIs emitidos/día en México</div>
        </div>
        <div>
          <div className="font-mono text-2xl sm:text-3xl font-bold text-[oklch(0.78_0.15_195)]">4.2M</div>
          <div className="text-xs text-[oklch(0.68_0.03_250)] mt-1">PyMEs con obligación CFDI</div>
        </div>
        <div>
          <div className="font-mono text-2xl sm:text-3xl font-bold text-[oklch(0.78_0.15_195)]">$4,800M</div>
          <div className="text-xs text-[oklch(0.68_0.03_250)] mt-1">TAM anual MXN</div>
        </div>
        <div>
          <div className="font-mono text-2xl sm:text-3xl font-bold text-[oklch(0.78_0.15_195)]">3 seg</div>
          <div className="text-xs text-[oklch(0.68_0.03_250)] mt-1">Tiempo promedio de extracción</div>
        </div>
      </div>

      {/* Pasos */}
      <div id="steps-section" className="text-center py-10">
        <h2 className="font-sora font-bold text-2xl sm:text-3xl mb-2">¿Cómo funciona?</h2>
        <p className="text-xs sm:text-sm text-[oklch(0.68_0.03_250)] mb-10">
          Tres pasos. Sin configuración complicada.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-left">
          <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-6">
            <div className="w-9 h-9 rounded-full bg-[oklch(0.78_0.15_195)] text-[oklch(0.15_0.03_260)] font-mono font-bold flex items-center justify-center mb-4">
              1
            </div>
            <b className="font-sora text-sm block mb-1.5">Sube o fotografía</b>
            <p className="text-xs text-[oklch(0.68_0.03_250)] leading-relaxed">
              Arrastra el XML, PDF o foto del ticket con la cámara de tu smartphone.
            </p>
          </div>

          <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-6">
            <div className="w-9 h-9 rounded-full bg-[oklch(0.65_0.20_295)] text-white font-mono font-bold flex items-center justify-center mb-4">
              2
            </div>
            <b className="font-sora text-sm block mb-1.5">La IA lee y calcula</b>
            <p className="text-xs text-[oklch(0.68_0.03_250)] leading-relaxed">
              Extrae datos del CFDI y calcula con precisión determinista cuánto ISR ahorras.
            </p>
          </div>

          <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-6">
            <div className="w-9 h-9 rounded-full bg-[oklch(0.72_0.17_155)] text-[oklch(0.15_0.03_260)] font-mono font-bold flex items-center justify-center mb-4">
              3
            </div>
            <b className="font-sora text-sm block mb-1.5">Concilia y descansa</b>
            <p className="text-xs text-[oklch(0.68_0.03_250)] leading-relaxed">
              El motor vincula tus movimientos de banco automáticamente. Tu contador lo ve en tiempo real.
            </p>
          </div>
        </div>
      </div>

      {/* Testimonial */}
      <div className="my-10 bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl p-6 sm:p-8 max-w-2xl mx-auto">
        <div className="text-3xl font-sora text-[oklch(0.78_0.15_195)] leading-none mb-3">“</div>
        <p className="text-sm sm:text-base italic leading-relaxed text-[oklch(0.90_0.01_240)] mb-4">
          Antes pasaba 3 horas al día capturando facturas en Excel. Con FacturIA lo hago en 15 minutos — y encima me dice exactamente cuánto ISR e IVA puedo deducir cada mes.
        </p>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[oklch(0.78_0.15_195/0.15)] flex items-center justify-center text-lg">
            👩‍💼
          </div>
          <div>
            <b className="text-xs sm:text-sm block font-sora">Ana García Ramírez</b>
            <span className="text-[11px] text-[oklch(0.68_0.03_250)]">
              Contadora · García & Asociados S.C., CDMX
            </span>
          </div>
        </div>
      </div>

      {/* CTA Box */}
      <div className="my-12 rounded-3xl p-8 text-center border border-[oklch(0.72_0.17_155/0.4)] bg-gradient-to-r from-[oklch(0.32_0.10_165)] to-[oklch(0.24_0.08_165)] max-w-xl mx-auto shadow-2xl">
        <h3 className="font-sora font-extrabold text-2xl text-white mb-2">
          Comienza hoy — es gratis
        </h3>
        <p className="text-xs text-[oklch(0.90_0.08_155)] mb-6">
          10 facturas al mes sin costo. Sin tarjeta. Sin letra chica.
        </p>
        <button
          onClick={onEnterDemo}
          className="px-6 py-3 rounded-xl bg-[oklch(0.72_0.17_155)] text-[oklch(0.12_0.03_165)] font-sora font-bold text-xs sm:text-sm hover:brightness-105 transition-all shadow-md"
        >
          🛡 Activar mi Escudo Fiscal
        </button>
      </div>

      {/* Footer */}
      <footer className="pt-8 border-t border-[oklch(0.30_0.03_260)] flex flex-wrap items-center justify-between gap-4 text-xs text-[oklch(0.68_0.03_250)]">
        <div className="font-sora font-bold">
          factur<span className="text-[oklch(0.78_0.15_195)]">IA</span>
        </div>
        <div className="flex gap-4">
          <span className="hover:text-white cursor-pointer">Privacidad</span>
          <span className="hover:text-white cursor-pointer">Términos</span>
          <span className="hover:text-white cursor-pointer">Soporte SAT</span>
        </div>
        <span>© 2026 FacturIA · Hecho en México 🇲🇽</span>
      </footer>
    </div>
  );
};
