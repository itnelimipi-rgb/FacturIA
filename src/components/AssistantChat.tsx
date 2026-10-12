'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { CashFlowMetrics, BankTransaction, CfdiRecord, Profile } from '../lib/types';
import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import { buildLocalAssistantContext, isFiscalDecisionQuestion, isRecordedDataQuestion, isLocalAiUserCancellation, localAssistantMessages, safeLocalAssistantReply,
  localAiSetupDiagnostic, LocalAiSetupError, withLocalAiDeadline as bounded,
  LOCAL_AI_MODEL_ID, LOCAL_AI_DOWNLOAD_MB, LOCAL_AI_GPU_MB, LOCAL_AI_FISCAL_LIMIT, MAX_LOCAL_AI_QUESTION_CHARS } from '../lib/localAssistant';
import type {LocalAiSetupPhase} from '../lib/localAssistant';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  localAi?: boolean;
  rules?: boolean;
}

interface AssistantChatProps {
  mode: 'demo' | 'workspace';
  profile: Profile;
  metrics: CashFlowMetrics;
  transactions: BankTransaction[];
  cfdis: CfdiRecord[];
}

// Remount for each account and mode, so private history and the worker cannot cross accounts.
export const AssistantChat: React.FC<AssistantChatProps> = props => <AssistantSession key={`${props.mode}:${props.profile.id}`} {...props} />;

const AssistantSession: React.FC<AssistantChatProps> = ({ mode, profile, metrics, transactions, cfdis }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const welcome: Message = { id: 'm-init', sender: 'assistant', text: `Hola, ${profile.businessName}. Puedo resumir tus movimientos y comprobantes registrados: hay ${metrics.conciliadoCount} movimiento(s) conciliados, ${metrics.ambiguoCount} ambiguos y ${metrics.discrepanciaCount} en discrepancia.\n\nPor defecto uso reglas y datos de ${mode === 'demo' ? 'la demostración' : 'tu espacio'}. Puedes activar una IA gratuita que procesa las preguntas en tu dispositivo. La consulta SAT se solicita aparte desde cada comprobante.` };
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const engineRef = useRef<MLCEngineInterface | null>(null);
  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const [aiState, setAiState] = useState<'rules' | 'loading' | 'ready'>('rules');
  const [progress, setProgress] = useState(0);
  const [aiError, setAiError] = useState('');
  const computed = useMemo(() => {
    try { return {context: buildLocalAssistantContext({profile, transactions, cfdis}), error: ''}; }
    catch { return {context: null, error: 'No se pudo preparar un resumen validado para la IA local.'}; }
  }, [profile, transactions, cfdis]);
  const context = computed.context;

  function destroyLocalEngine() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    engineRef.current?.interruptGenerate();
    if (engineRef.current) void engineRef.current.unload().catch(() => {});
    engineRef.current = null;
    // Termination destroys the engine and interrupts pending downloads/generation.
    workerRef.current?.terminate();
    workerRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; destroyLocalEngine(); };
  }, []);

  async function activateLocalAi() {
    if (loadingRef.current || sendingRef.current || engineRef.current || !context) return;
    loadingRef.current = true;
    setAiError(''); setProgress(0); setAiState('loading');
    const controller = new AbortController();
    controllerRef.current = controller;
    let phase: LocalAiSetupPhase = 'adapter';
    try {
      const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<{features: {has(value: string): boolean}} | null>}}).gpu;
      if (!window.isSecureContext || !gpu) throw new LocalAiSetupError('gpu');
      const adapter = await bounded(gpu.requestAdapter(), controller.signal, 10_000);
      if (!adapter || !adapter.features.has('shader-f16')) throw new LocalAiSetupError('gpu');
      phase = 'module';
      const webllm = await bounded(import('@mlc-ai/web-llm'), controller.signal, 30_000);
      if (controller.signal.aborted || !mountedRef.current) return;
      phase = 'catalog';
      const model = webllm.prebuiltAppConfig.model_list.find(record => record.model_id === LOCAL_AI_MODEL_ID);
      if (!model || model.model !== `https://huggingface.co/mlc-ai/${LOCAL_AI_MODEL_ID}` ||
          !model.model_lib.startsWith('https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_86/')) throw new LocalAiSetupError('model_config');
      phase = 'model';
      const worker = new Worker(new URL('../lib/localAssistant.worker.ts', import.meta.url), {type: 'module', name: 'facturia-local-ai'});
      workerRef.current = worker;
      worker.onerror = () => { controllerRef.current?.abort(new LocalAiSetupError('unknown')); };
      const engine = new webllm.WebWorkerMLCEngine(worker, {appConfig: {model_list: [model], cacheBackend: 'cache'}, logLevel: 'ERROR',
        initProgressCallback: report => { if (mountedRef.current && !controller.signal.aborted) setProgress(Number.isFinite(report.progress) ? Math.min(100, Math.max(0, Math.round(report.progress * 100))) : 0); }});
      engineRef.current = engine;
      await bounded(engine.reload(LOCAL_AI_MODEL_ID, {context_window_size: 4096}), controller.signal, 300_000);
      if (controller.signal.aborted || !mountedRef.current) return;
      controllerRef.current = null; setAiState('ready'); setProgress(100);
    } catch (error) {
      const ownsOperation = controllerRef.current === controller;
      const diagnostic = localAiSetupDiagnostic(error);
      if (ownsOperation) destroyLocalEngine();
      if (mountedRef.current && ownsOperation) {
        // No raw worker errors, URLs, questions, financial data or secrets are logged.
        console.warn(JSON.stringify({code: diagnostic.code, phase}));
        setAiState('rules');
        setAiError(diagnostic.message);
      }
    } finally { if (controllerRef.current === controller || controllerRef.current === null) loadingRef.current = false; }
  }

  function switchToRules() {
    destroyLocalEngine(); loadingRef.current = false; setAiState('rules'); setProgress(0);
  }

  async function answerWithRules(message: string, signal: AbortSignal): Promise<string> {
    const response = await fetch('/api/assistant', {
      method: 'POST', signal, headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message, mode,
        ...(mode === 'demo' ? {snapshot: {profile, transactions, cfdis: cfdis.map(record => ({...record, rawXml: undefined}))}} : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'No se pudo consultar el asistente.');
    if (typeof data.reply !== 'string' || !data.reply) throw new Error('El asistente devolvió una respuesta vacía.');
    return data.reply;
  }

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const sendMessage = async (textToSend: string) => {
    const text = textToSend.trim();
    if (!text || text.length > MAX_LOCAL_AI_QUESTION_CHARS || sendingRef.current || loadingRef.current) return;
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
    const useLocal = aiState === 'ready' && engineRef.current && context && !isRecordedDataQuestion(text);
    const timeout = setTimeout(() => controller.abort(new LocalAiSetupError('timeout')), useLocal ? 100_000 : 30_000);

    try {
      if (useLocal && engineRef.current && context) {
        let reply: string;
        let localAi = false;
        if (isFiscalDecisionQuestion(text)) reply = LOCAL_AI_FISCAL_LIMIT;
        else {
          const engine = engineRef.current;
          await bounded(engine.resetChat(), controller.signal, 10_000);
          const generated = await bounded(engine.chat.completions.create({messages: localAssistantMessages(text, context),
            max_tokens: 256, temperature: 0.1, top_p: 0.8, stream: false, extra_body: {resumable: {enabled: false}}}), controller.signal, 90_000);
          reply = safeLocalAssistantReply(generated.choices[0]?.message.content ?? '', context);
          localAi = true;
        }
        if (mountedRef.current && !controller.signal.aborted) setMessages(previous => [...previous, {id: `a-${crypto.randomUUID()}`, sender: 'assistant', text: reply, localAi, rules: !localAi}]);
        return;
      }
      const reply = await answerWithRules(text, controller.signal);

      if (mountedRef.current && !controller.signal.aborted) setMessages((prev) => [
        ...prev,
        {
          id: `a-${crypto.randomUUID()}`,
          sender: 'assistant',
          text: reply, rules: true,
        }
      ]);
    } catch (error) {
      if (!mountedRef.current) return;
      const wasLocal = !!useLocal;
      const wasCancelled = isLocalAiUserCancellation(controller.signal);
      if (wasLocal) {
        switchToRules();
        if (!wasCancelled) {
          const fallback = new AbortController();
          controllerRef.current = fallback;
          const deadline = setTimeout(() => fallback.abort(), 30_000);
          try {
            const reply = await answerWithRules(text, fallback.signal);
            if (mountedRef.current && !fallback.signal.aborted) setMessages(previous => [...previous, {
              id: `a-${crypto.randomUUID()}`, sender: 'assistant', rules: true,
              text: `La respuesta local se descartó. Este resumen se calculó con reglas.\n\n${reply}`,
            }]);
            return;
          } catch { /* Keep a controlled notice if the rules request also fails. */ }
          finally {clearTimeout(deadline); if (controllerRef.current === fallback) controllerRef.current = null;}
        }
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${crypto.randomUUID()}`,
          sender: 'assistant',
          text: wasLocal ? wasCancelled ? 'La respuesta local se canceló. Puedes seguir usando reglas.' : 'No se pudo completar el resumen. Consulta las cifras calculadas o vuelve a intentarlo.' : controller.signal.aborted ? 'La consulta se interrumpió o tardó demasiado. Intenta nuevamente.' : error instanceof Error ? error.message : 'No se pudo consultar el asistente. Intenta nuevamente.'
        }
      ]);
    } finally {
      clearTimeout(timeout);
      sendingRef.current = false;
      if (controllerRef.current === controller) controllerRef.current = null;
      if (mountedRef.current) setIsTyping(false);
    }
  };

  const suggestions = [
    '¿Qué facturas me faltan por registrar?',
    'Resume mis movimientos bancarios',
    '¿Cuáles son mis retenciones documentadas?',
    '¿Qué verificaciones fiscales están disponibles?'
  ];

  return (
    <div className="bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] rounded-2xl flex flex-col h-[850px] max-h-[90vh] overflow-hidden shadow-2xl">
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
              {aiState === 'ready' ? 'IA local experimental • Qwen 0.5B' : aiState === 'loading' ? 'Preparando IA en tu dispositivo' : 'Resumen de datos • Reglas configuradas'}
            </div>
          </div>
        </div>
        <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-[oklch(0.24_0.028_260)] border border-[oklch(0.30_0.03_260)] text-[oklch(0.68_0.03_250)]">
          {aiState === 'ready' ? 'IA local' : 'Reglas'}
        </span>
      </div>

      <div className="px-5 py-3 border-b border-[oklch(0.30_0.03_260)] text-xs space-y-2">
        <p>IA local opcional: descarga aproximada de {LOCAL_AI_DOWNLOAD_MB} MB desde Hugging Face y MLC; requiere WebGPU y aproximadamente {LOCAL_AI_GPU_MB} MB de memoria GPU. Las explicaciones de la IA se generan en este dispositivo; las preguntas no se envían a un proveedor de IA.</p>
        <div className="flex flex-wrap gap-2">
          {aiState === 'rules' && <button type="button" disabled={isTyping || !context} onClick={() => void activateLocalAi()} className="rounded-lg border border-[oklch(0.78_0.15_195)] px-3 py-1.5 disabled:opacity-50">Activar IA local (descarga modelo)</button>}
          {aiState !== 'rules' && <button type="button" onClick={switchToRules} className="rounded-lg border border-[oklch(0.40_0.03_260)] px-3 py-1.5">{aiState === 'loading' ? 'Cancelar descarga y usar reglas' : 'Desactivar IA y usar reglas'}</button>}
          {isTyping && <button type="button" onClick={() => { controllerRef.current?.abort(); if (aiState === 'ready') switchToRules(); }} className="rounded-lg border border-[oklch(0.40_0.03_260)] px-3 py-1.5">Cancelar respuesta</button>}
        </div>
        {aiState === 'loading' && <div role="status"><progress max={100} value={progress} aria-label="Preparación de IA local" className="w-full" /><span>Preparación: {progress}%. La primera carga puede tardar varios minutos.</span></div>}
        {(aiError || computed.error) && <p role="alert" className="text-amber-300">{aiError || computed.error}</p>}
        <p className="text-amber-200">La IA explica cómo revisar los estados y puede contener errores. Los resúmenes, cifras y referencias se calculan con reglas. Las decisiones fiscales requieren revisión contable.</p>
      </div>
      {context && <details className="px-5 py-2 border-b border-[oklch(0.30_0.03_260)] text-xs max-h-44 overflow-y-auto" open>
        <summary className="cursor-pointer font-semibold">Resumen calculado: {context.counts.matched} conciliados, {context.counts.ambiguous} ambiguos, {context.counts.unlinked} en discrepancia</summary>
        <div className="mt-2 space-y-1">
          {context.metrics.map(metric => <p key={metric.currency}>{metric.currency}: ingresos {metric.income.toFixed(2)}, egresos {metric.expense.toFixed(2)}, neto importado {metric.importedNet.toFixed(2)}, retenciones documentadas {metric.documentedWithholdings.toFixed(2)}.</p>)}
          {context.omittedCurrencies > 0 && <p>{context.omittedCurrencies} moneda(s) adicionales fuera del contexto local. No se convierten divisas.</p>}
          {context.references.map(reference => <p key={reference.label}>{reference.label}: {reference.date}, {reference.amount.toFixed(2)} {reference.currency} • {reference.state}</p>)}
          <p className="text-[oklch(0.68_0.03_250)]">Referencias parciales de tus registros recientes. El neto importado no representa el saldo real del banco.</p>
        </div>
      </details>}
      {/* Body de Conversación */}
      <div ref={chatBodyRef} className="flex-1 min-h-24 overflow-y-auto p-5 space-y-4">
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
              {m.localAi && <p className="text-[10px] text-amber-200 mb-1">Generado por IA local experimental</p>}
              {m.rules && <p className="text-[10px] text-teal-200 mb-1">Resumen calculado con reglas</p>}
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
            disabled={isTyping || aiState === 'loading'}
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
          maxLength={MAX_LOCAL_AI_QUESTION_CHARS}
          disabled={aiState === 'loading'}
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
          disabled={isTyping || aiState === 'loading' || !input.trim()}
          onClick={() => void sendMessage(input)}
          className="w-10 h-10 rounded-full bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] flex items-center justify-center shrink-0 shadow-glow hover:brightness-105 transition-all disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
