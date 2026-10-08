'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { CashFlowMetrics, BankTransaction, CfdiRecord, Profile } from '../lib/types';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
}

interface AssistantChatProps {
  mode: 'demo' | 'workspace';
  profile: Profile;
  metrics: CashFlowMetrics;
  transactions: BankTransaction[];
  cfdis: CfdiRecord[];
}

export const AssistantChat: React.FC<AssistantChatProps> = ({ mode, profile, metrics, transactions, cfdis }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const welcome: Message = { id: 'm-init', sender: 'assistant', text: `Hola, ${profile.businessName}. Puedo resumir tus movimientos y comprobantes registrados: hay ${metrics.conciliadoCount} movimiento(s) conciliados, ${metrics.ambiguoCount} ambiguos y ${metrics.discrepanciaCount} en discrepancia.\n\nEste asistente usa reglas y los datos de ${mode === 'demo' ? 'la demostración' : 'tu espacio de trabajo'}. La conexión con un modelo de IA y las consultas oficiales SAT están pendientes de configurar.` };
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const sendMessage = async (textToSend: string) => {
    const text = textToSend.trim();
    if (!text || text.length > 2000 || sendingRef.current) return;
    sendingRef.current = true;

    const userMsg: Message = {
      id: `u-${crypto.randomUUID()}`,
      sender: 'user',
      text
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          mode,
          ...(mode === 'demo' ? { snapshot: { profile, transactions, cfdis: cfdis.map(record => ({ ...record, rawXml: undefined })) } } : {})
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'No se pudo consultar el asistente.');
      if (typeof data.reply !== 'string' || !data.reply) throw new Error('El asistente devolvió una respuesta vacía.');

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${crypto.randomUUID()}`,
          sender: 'assistant',
          text: data.reply
        }
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${crypto.randomUUID()}`,
          sender: 'assistant',
          text: controller.signal.aborted ? 'La consulta se interrumpió o tardó demasiado. Intenta nuevamente.' : error instanceof Error ? error.message : 'No se pudo consultar el asistente. Intenta nuevamente.'
        }
      ]);
    } finally {
      clearTimeout(timeout);
      sendingRef.current = false;
      setIsTyping(false);
    }
  };

  const suggestions = [
    '¿Qué facturas me faltan por registrar?',
    'Resume mis movimientos bancarios',
    '¿Cuáles son mis retenciones documentadas?',
    '¿Qué verificaciones fiscales están disponibles?'
  ];

  return (
    <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl flex flex-col h-[580px] overflow-hidden shadow-2xl">
      {/* Head */}
      <div className="px-5 py-4 border-b border-[oklch(0.30_0.03_260)] bg-[oklch(0.18_0.02_260)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-linear-to-tr from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] flex items-center justify-center text-[oklch(0.15_0.03_260)] shadow-glow">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="font-sora font-bold text-sm text-[oklch(0.97_0.01_240)]">
              Asistente FacturIA
            </div>
            <div className="text-[11px] text-[oklch(0.72_0.17_155)] flex items-center gap-1.5 font-medium">
              <span className="w-2 h-2 rounded-full bg-[oklch(0.72_0.17_155)] animate-pulse"></span>
              Resumen de datos • Reglas configuradas
            </div>
          </div>
        </div>
        <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-[oklch(0.24_0.028_260)] border border-[oklch(0.30_0.03_260)] text-[oklch(0.68_0.03_250)]">
          IA pendiente
        </span>
      </div>

      {/* Body de Conversación */}
      <div ref={chatBodyRef} className="flex-1 overflow-y-auto p-5 space-y-4">
        {[welcome, ...messages].map((m) => (
          <div
            key={m.id}
            className={`flex items-start gap-2.5 max-w-[85%] ${
              m.sender === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'
            }`}
          >
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                m.sender === 'user'
                  ? 'bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)]'
                  : 'bg-[oklch(0.24_0.028_260)] border border-[oklch(0.30_0.03_260)] text-[oklch(0.78_0.15_195)]'
              }`}
            >
              {m.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div
              className={`px-4 py-3 rounded-2xl text-xs sm:text-[13px] leading-relaxed ${
                m.sender === 'user'
                  ? 'bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] font-medium rounded-br-none shadow-md'
                  : 'bg-[oklch(0.18_0.02_260)] border border-[oklch(0.30_0.03_260)] text-[oklch(0.97_0.01_240)] rounded-bl-none shadow-xs'
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{m.text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <React.Fragment key={index}>{part}</React.Fragment>)}</div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 mr-auto">
            <div className="w-7 h-7 rounded-lg bg-[oklch(0.24_0.028_260)] border border-[oklch(0.30_0.03_260)] text-[oklch(0.78_0.15_195)] flex items-center justify-center text-xs">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-[oklch(0.18_0.02_260)] border border-[oklch(0.30_0.03_260)] px-4 py-2.5 rounded-2xl rounded-bl-none flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[oklch(0.68_0.03_250)] typing-dot"></span>
              <span className="w-2 h-2 rounded-full bg-[oklch(0.68_0.03_250)] typing-dot"></span>
              <span className="w-2 h-2 rounded-full bg-[oklch(0.68_0.03_250)] typing-dot"></span>
            </div>
          </div>
        )}
      </div>

      {/* Sugerencias Rápidas */}
      <div className="px-5 py-2 flex items-center gap-2 overflow-x-auto scrollbar-none bg-[oklch(0.18_0.02_260)]/60 border-t border-[oklch(0.30_0.03_260)]">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            disabled={isTyping}
            onClick={() => void sendMessage(s)}
            className="text-[11px] whitespace-nowrap px-3 py-1.5 rounded-full bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] hover:border-[oklch(0.78_0.15_195)] hover:text-white text-[oklch(0.68_0.03_250)] transition-colors disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="p-3.5 bg-[oklch(0.18_0.02_260)] border-t border-[oklch(0.30_0.03_260)] flex items-center gap-2">
        <input
          type="text"
          placeholder="Pregunta por tus movimientos, comprobantes o pendientes..."
          aria-label="Pregunta para el asistente"
          maxLength={2000}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void sendMessage(input); }
          }}
          className="flex-1 bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-full px-4 py-2.5 text-xs sm:text-sm text-[oklch(0.97_0.01_240)] placeholder:text-[oklch(0.68_0.03_250)] focus:outline-hidden focus:border-[oklch(0.78_0.15_195)]"
        />
        <button
          type="button"
          aria-label="Enviar pregunta"
          disabled={isTyping || !input.trim()}
          onClick={() => void sendMessage(input)}
          className="w-10 h-10 rounded-full bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] flex items-center justify-center shrink-0 shadow-glow hover:brightness-105 transition-all disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
