'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bot, Send, Sparkles, User } from 'lucide-react';
import type { BankTransaction, CfdiRecord, Profile } from '../lib/types';
import { buildHomeSummary } from '../lib/homeSummary';
import { ui } from './ui';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  ai?: boolean;
}

interface AssistantChatProps {
  visible?: boolean;
  mode: 'demo' | 'workspace';
  profile: Profile;
  transactions: BankTransaction[];
  cfdis: CfdiRecord[];
  aiEnabled?: boolean;
}

const MAX_QUESTION_CHARS = 1200;
const suggestions = ['¿Qué tengo pendiente?', '¿Cuánto entró y salió?', '¿Cómo subo mi estado de cuenta?', '¿Qué significa «Elige la factura»?'];

// Remount for each account and mode, so private history cannot cross accounts.
export const AssistantChat: React.FC<AssistantChatProps> = props => <AssistantSession key={`${props.mode}:${props.profile.id}`} {...props} />;

const AssistantSession: React.FC<AssistantChatProps> = ({ mode, profile, transactions, cfdis, visible = true, aiEnabled = false }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const usesAi = aiEnabled && mode === 'workspace';
  const pending = buildHomeSummary(transactions, cfdis, profile.rfc).pending.length;
  const welcome = `Hola, ${profile.businessName}. Pregúntame qué tienes pendiente, cuánto entró o salió, o cómo hacer algo en FacturIA.${pending ? ` Ahora mismo ${pending === 1 ? 'hay 1 movimiento' : `hay ${pending} movimientos`} esperando tu atención.` : ''}`;

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => {
    if (visible && chatBodyRef.current?.getClientRects().length) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
  }, [messages, isTyping, visible]);

  const sendMessage = async (textToSend: string) => {
    const text = textToSend.trim();
    if (!text || text.length > MAX_QUESTION_CHARS || sendingRef.current) return;
    sendingRef.current = true;
    const history = messages.slice(-6).map(message => ({role: message.sender, text: message.text}));
    setMessages(previous => [...previous, {id: `u-${crypto.randomUUID()}`, sender: 'user', text}]);
    setInput('');
    setIsTyping(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST', signal: controller.signal, headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: text, mode, history,
          ...(mode === 'demo' ? {snapshot: {profile, transactions, cfdis: cfdis.map(record => ({...record, rawXml: undefined}))}} : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || typeof data?.reply !== 'string' || !data.reply) throw new Error(typeof data?.error === 'string' ? data.error : 'No se pudo consultar el asistente.');
      if (mountedRef.current) setMessages(previous => [...previous, {id: `a-${crypto.randomUUID()}`, sender: 'assistant', text: data.reply, ai: data.generatedByAI === true}]);
    } catch (error) {
      if (mountedRef.current) setMessages(previous => [...previous, {id: `a-${crypto.randomUUID()}`, sender: 'assistant',
        text: controller.signal.aborted ? 'La respuesta tardó demasiado. Intenta de nuevo.' : error instanceof Error ? error.message : 'No se pudo consultar el asistente. Intenta de nuevo.'}]);
    } finally {
      clearTimeout(timeout);
      sendingRef.current = false;
      if (mountedRef.current) setIsTyping(false);
    }
  };

  return <div className={`${ui.card} flex h-[70vh] min-h-[28rem] max-h-[52rem] flex-col overflow-hidden`}>
    <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[oklch(0.18_0.02_260)] px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-tr from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] shadow-glow"><Bot aria-hidden="true" className="h-5 w-5" /></span>
        <div><p className="font-sora text-sm font-bold text-white">Asistente FacturIA</p><p className="text-xs text-slate-400">{usesAi ? 'Con IA (Claude) y los datos de tu cuenta' : 'Respuestas con los datos que subiste'}</p></div>
      </div>
      {usesAi && <span className="inline-flex items-center gap-1 rounded-full border border-cyan-800/60 bg-cyan-950/40 px-2.5 py-1 text-xs text-cyan-100"><Sparkles aria-hidden="true" className="h-3.5 w-3.5" />IA</span>}
    </div>

    <div ref={chatBodyRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
      {[{id: 'welcome', sender: 'assistant' as const, text: welcome}, ...messages].map(message => <div key={message.id} className={`flex max-w-[88%] items-start gap-2.5 ${message.sender === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${message.sender === 'user' ? 'bg-cyan-200 text-slate-950' : 'border border-white/10 bg-white/5 text-cyan-200'}`}>{message.sender === 'user' ? <User aria-hidden="true" className="h-4 w-4" /> : <Bot aria-hidden="true" className="h-4 w-4" />}</span>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.sender === 'user' ? 'rounded-br-none bg-cyan-200 text-slate-950' : 'rounded-bl-none border border-white/10 bg-[oklch(0.18_0.02_260)] text-slate-100'}`}>
          <span className="sr-only">{message.sender === 'user' ? 'Tú: ' : 'Asistente: '}</span>
          <div className="whitespace-pre-wrap break-words">{message.text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <React.Fragment key={index}>{part}</React.Fragment>)}</div>
          {message.ai && <p className="mt-2 text-xs text-slate-400">Respuesta generada con IA; puede equivocarse.</p>}
        </div>
      </div>)}
      {isTyping && <p role="status" className="flex items-center gap-1.5 text-sm text-slate-400"><span className="typing-dot h-2 w-2 rounded-full bg-slate-400" /><span className="typing-dot h-2 w-2 rounded-full bg-slate-400" /><span className="typing-dot h-2 w-2 rounded-full bg-slate-400" /><span className="sr-only">El asistente está escribiendo</span></p>}
    </div>

    <div className="flex gap-2 overflow-x-auto border-t border-white/10 px-4 py-2">
      {suggestions.map(suggestion => <button key={suggestion} type="button" disabled={isTyping} onClick={() => void sendMessage(suggestion)}
        className={`shrink-0 whitespace-nowrap rounded-full border border-white/15 px-3 py-1.5 text-sm text-slate-300 transition hover:border-cyan-300 hover:text-white disabled:opacity-50 ${ui.focus}`}>{suggestion}</button>)}
    </div>
    <form className="flex items-center gap-2 border-t border-white/10 bg-[oklch(0.18_0.02_260)] p-3" onSubmit={event => { event.preventDefault(); void sendMessage(input); }}>
      <input type="text" value={input} onChange={event => setInput(event.target.value)} maxLength={MAX_QUESTION_CHARS} aria-label="Escribe tu pregunta"
        placeholder="Escribe tu pregunta…" className={`${ui.input} mt-0 flex-1 rounded-full`} />
      <button type="submit" aria-label="Enviar pregunta" disabled={isTyping || !input.trim()} className={`${ui.primary} h-11 w-11 rounded-full px-0`}><Send aria-hidden="true" className="h-4 w-4" /></button>
    </form>
  </div>;
};
