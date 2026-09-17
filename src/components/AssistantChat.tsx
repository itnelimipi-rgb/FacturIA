'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, Sparkles, User, HelpCircle } from 'lucide-react';
import { CashFlowMetrics, BankTransaction, CfdiRecord } from '../lib/types';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
}

interface AssistantChatProps {
  metrics: CashFlowMetrics;
  transactions: BankTransaction[];
  cfdis: CfdiRecord[];
}

export const AssistantChat: React.FC<AssistantChatProps> = ({ metrics, transactions, cfdis }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'm-init',
      sender: 'assistant',
      text: `¡Hola María! 👋 Soy tu contador personal en FacturIA. Ya analicé tus movimientos y comprobantes: tienes un saldo disponible de **$${metrics.totalBankBalance.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN** y detecté **$${metrics.nonDeductibleExpenseDiscrepancies.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN** en riesgo fiscal por falta de factura.\n\n¿En qué te puedo asesorar hoy?`
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const sendMessage = async (textToSend: string) => {
    const text = textToSend.trim();
    if (!text) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          context: {
            totalSavings: `$${(metrics.projectedRetentionsResico + 2500).toFixed(2)} MXN`,
            bankBalance: metrics.totalBankBalance,
            discrepancies: metrics.discrepanciaCount,
            discrepancyAmount: metrics.nonDeductibleExpenseDiscrepancies
          }
        })
      });

      const data = await res.json();
      setIsTyping(false);

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          sender: 'assistant',
          text: data.reply || 'No pude procesar tu solicitud, intenta nuevamente.'
        }
      ]);
    } catch (err) {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          sender: 'assistant',
          text: 'Tuve un breve problema de conexión. ¿Puedes intentar de nuevo?'
        }
      ]);
    }
  };

  const suggestions = [
    '¿Cuánto podría ahorrar este mes?',
    '¿Qué facturas me faltan por registrar?',
    'Explícame RESICO en 2 líneas',
    '¿Por qué no deducir en efectivo?'
  ];

  return (
    <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl flex flex-col h-[580px] overflow-hidden shadow-2xl">
      {/* Head */}
      <div className="px-5 py-4 border-b border-[oklch(0.30_0.03_260)] bg-[oklch(0.18_0.02_260)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] flex items-center justify-center text-[oklch(0.15_0.03_260)] shadow-glow">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="font-sora font-bold text-sm text-[oklch(0.97_0.01_240)]">
              Asistente FacturIA
            </div>
            <div className="text-[11px] text-[oklch(0.72_0.17_155)] flex items-center gap-1.5 font-medium">
              <span className="w-2 h-2 rounded-full bg-[oklch(0.72_0.17_155)] animate-pulse"></span>
              Conectado • Asesor Fiscal Especializado
            </div>
          </div>
        </div>
        <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-[oklch(0.24_0.028_260)] border border-[oklch(0.30_0.03_260)] text-[oklch(0.68_0.03_250)]">
          LISR Art. 151 / RESICO
        </span>
      </div>

      {/* Body de Conversación */}
      <div ref={chatBodyRef} className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex items-start gap-2.5 max-w-[85%] ${
              m.sender === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'
            }`}
          >
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                m.sender === 'user'
                  ? 'bg-gradient-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)]'
                  : 'bg-[oklch(0.24_0.028_260)] border border-[oklch(0.30_0.03_260)] text-[oklch(0.78_0.15_195)]'
              }`}
            >
              {m.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div
              className={`px-4 py-3 rounded-2xl text-xs sm:text-[13px] leading-relaxed ${
                m.sender === 'user'
                  ? 'bg-gradient-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] font-medium rounded-br-none shadow-md'
                  : 'bg-[oklch(0.18_0.02_260)] border border-[oklch(0.30_0.03_260)] text-[oklch(0.97_0.01_240)] rounded-bl-none shadow-sm'
              }`}
            >
              <div
                dangerouslySetInnerHTML={{
                  __html: m.text
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n\n/g, '<br/><br/>')
                    .replace(/\n/g, '<br/>')
                }}
              />
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
            onClick={() => sendMessage(s)}
            className="text-[11px] whitespace-nowrap px-3 py-1.5 rounded-full bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] hover:border-[oklch(0.78_0.15_195)] hover:text-white text-[oklch(0.68_0.03_250)] transition-colors"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="p-3.5 bg-[oklch(0.18_0.02_260)] border-t border-[oklch(0.30_0.03_260)] flex items-center gap-2">
        <input
          type="text"
          placeholder="Pregúntale a tu contador con IA sobre SAT, RESICO, IVA o deducciones..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') sendMessage(input);
          }}
          className="flex-1 bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-full px-4 py-2.5 text-xs sm:text-sm text-[oklch(0.97_0.01_240)] placeholder:text-[oklch(0.68_0.03_250)] focus:outline-none focus:border-[oklch(0.78_0.15_195)]"
        />
        <button
          onClick={() => sendMessage(input)}
          className="w-10 h-10 rounded-full bg-gradient-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] flex items-center justify-center flex-shrink-0 shadow-glow hover:brightness-105 transition-all"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
