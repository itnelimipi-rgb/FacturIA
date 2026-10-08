'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { BankCsvImport } from '../components/BankCsvImport';
import { CashFlowShield } from '../components/CashFlowShield';
import { UnifiedDropzone } from '../components/UnifiedDropzone';
import { TreasuryInbox } from '../components/TreasuryInbox';
import { AmbiguousResolverModal } from '../components/AmbiguousResolverModal';
import { CfdiDetailModal } from '../components/CfdiDetailModal';
import { RegisterInvoiceModal } from '../components/RegisterInvoiceModal';
import { FiscalDashboardPanel } from '../components/FiscalDashboardPanel';
import { AssistantChat } from '../components/AssistantChat';
import { LandingHero } from '../components/LandingHero';
import { FacturiaStore } from '../lib/mockStore';
import { MatchingEngineService } from '../lib/MatchingEngineService';
import { BankTransaction, CfdiRecord, Profile } from '../lib/types';
import { SEED_PROFILE, SEED_TRANSACTIONS, SEED_CFDIS } from '../lib/seed';
import {
  Shield,
  RotateCcw,
  Zap,
  LayoutDashboard,
  Receipt,
  Bot,
  Globe,
  Plus
} from 'lucide-react';

type Snapshot = { profile: Profile; transactions: BankTransaction[]; cfdis: CfdiRecord[] };
export default function FacturiaDashboard({ mode = 'demo', initialSnapshot }: { mode?: 'demo' | 'workspace'; initialSnapshot?: Snapshot }) {
  const isDemo = mode === 'demo';
  const [operationError, setOperationError] = useState('');
  const [viewMode, setViewMode] = useState<'app' | 'landing'>('app');
  const [activeTab, setActiveTab] = useState<'panel' | 'facturas' | 'asistente'>('panel');

  const [profile, setProfile] = useState<Profile>(initialSnapshot?.profile || SEED_PROFILE);
  const [transactions, setTransactions] = useState<BankTransaction[]>(() =>
    MatchingEngineService.evaluateBatch(initialSnapshot?.transactions || SEED_TRANSACTIONS, initialSnapshot?.cfdis || SEED_CFDIS, initialSnapshot?.profile || SEED_PROFILE)
  );
  const [cfdis, setCfdis] = useState<CfdiRecord[]>(initialSnapshot?.cfdis || SEED_CFDIS);

  // Estados de Modales
  const [selectedAmbiguousTx, setSelectedAmbiguousTx] = useState<BankTransaction | null>(null);
  const [selectedCfdi, setSelectedCfdi] = useState<CfdiRecord | null>(null);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);

  useEffect(() => {
    if (!isDemo) return;
    const p = FacturiaStore.getProfile();
    const t = FacturiaStore.getTransactions();
    const c = FacturiaStore.getCfdis();
    const evaluated = MatchingEngineService.evaluateBatch(t, c, p);
    FacturiaStore.saveTransactions(evaluated);
    // Hydrate the browser storage snapshot after the server-rendered demo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(p); setTransactions(evaluated); setCfdis(c);
  }, [isDemo]);

  const metrics = MatchingEngineService.calculateCashFlowShieldMetrics(transactions, cfdis);
  const applySnapshot = (data: Snapshot) => {
    setProfile(data.profile); setTransactions(data.transactions); setCfdis(data.cfdis);
  };
  const workspaceAction = async (body: unknown) => {
    const res = await fetch('/api/workspace', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el cambio');
    applySnapshot(data);
  };
  const handleCfdiAdded = async (newCfdi: CfdiRecord, source: 'xml' | 'pdf' | 'image' | 'manual') => {
    if (!isDemo) {
      if (source === 'xml' && newCfdi.rawXml) await workspaceAction({action: 'xml', rawXml: newCfdi.rawXml});
      else if (source === 'manual') await workspaceAction({action: 'manual', document: newCfdi});
      else throw new Error('Este formato todavía no está configurado');
      return;
    }
    const {updatedTransactions, updatedCfdis} = FacturiaStore.addCfdi(newCfdi);
    setCfdis(updatedCfdis); setTransactions(updatedTransactions);
  };
  const handleTransactionsImported = async (newTransactions: BankTransaction[]) => {
    if (!isDemo) { await workspaceAction({action: 'transactions', transactions: newTransactions}); return; }
    const {updatedTransactions, updatedCfdis} = FacturiaStore.addTransactions(newTransactions);
    setTransactions(updatedTransactions); setCfdis(updatedCfdis);
  };
  const handleResolveAmbiguous = async (txId: string, selectedCfdiId: string) => {
    try {
      setOperationError('');
      if (isDemo) setTransactions(FacturiaStore.resolveAmbiguous(txId, selectedCfdiId));
      else await workspaceAction({action: 'resolve', transactionId: txId, cfdiId: selectedCfdiId});
      setSelectedAmbiguousTx(null);
    } catch (error) { setOperationError(error instanceof Error ? error.message : 'No se pudo conciliar'); }
  };
  const handleUnmatch = async (txId: string) => {
    try {
      setOperationError('');
      if (isDemo) setTransactions(FacturiaStore.unmatchTransaction(txId));
      else await workspaceAction({action: 'unmatch', transactionId: txId});
    } catch (error) { setOperationError(error instanceof Error ? error.message : 'No se pudo desvincular'); }
  };
  const handleResumeReconciliation = async (txId: string) => {
    try {
      setOperationError('');
      if (isDemo) setTransactions(FacturiaStore.resumeReconciliation(txId));
      else await workspaceAction({action: 'resumeReconciliation', transactionId: txId});
    } catch (error) { setOperationError(error instanceof Error ? error.message : 'No se pudo reanudar la conciliación'); }
  };
  const handleResetToSeed = () => {
    const {transactions: t, cfdis: c} = FacturiaStore.resetToSeed();
    const evaluated = MatchingEngineService.evaluateBatch(t, c, SEED_PROFILE);
    FacturiaStore.saveTransactions(evaluated); setProfile(SEED_PROFILE); setTransactions(evaluated); setCfdis(c);
  };

  // Candidatos para la transacción ambigua seleccionada
  const ambiguousCandidates: CfdiRecord[] = selectedAmbiguousTx
    ? (selectedAmbiguousTx.candidateCfdiIds || [])
        .map((id) => cfdis.find((c) => c.id === id))
        .filter((c): c is CfdiRecord => c !== undefined)
    : [];

  // Si está en modo Landing
  if (viewMode === 'landing') {
    return (
      <main className="min-h-screen bg-[oklch(0.16_0.02_260)]">
        <LandingHero onEnterDemo={() => setViewMode('app')} />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[oklch(0.16_0.02_260)] text-[oklch(0.97_0.01_240)] antialiased font-inter">
      {/* Header Estilo Shell de la Referencia */}
      <header className="sticky top-0 z-40 w-full border-b border-[oklch(0.30_0.03_260)] bg-[oklch(0.16_0.02_260)]/85 backdrop-blur-md">
        <div className="max-w-[1180px] mx-auto px-4 sm:px-6 h-18 flex items-center justify-between flex-wrap gap-3 py-3">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-linear-to-tr from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] flex items-center justify-center text-[oklch(0.15_0.03_260)] shadow-glow">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="font-sora font-extrabold text-base tracking-tight leading-none">
                Factur<span className="text-[oklch(0.78_0.15_195)]">IA</span>
              </div>
              <div className="text-[11px] text-[oklch(0.68_0.03_250)] mt-0.5">
                {isDemo ? 'Demostración · datos de ejemplo' : 'Mi espacio · datos persistentes'}
              </div>
            </div>
          </div>

          {/* Navegación por Tabs principales */}
          <nav className="flex items-center bg-[oklch(0.21_0.025_260)] p-1 rounded-xl border border-[oklch(0.30_0.03_260)]">
            <button
              onClick={() => setActiveTab('panel')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'panel'
                  ? 'bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] shadow-xs'
                  : 'text-[oklch(0.68_0.03_250)] hover:text-white'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              Panel
            </button>

            <button
              onClick={() => setActiveTab('facturas')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'facturas'
                  ? 'bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] shadow-xs'
                  : 'text-[oklch(0.68_0.03_250)] hover:text-white'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              Facturas & Tesorería
            </button>

            <button
              onClick={() => setActiveTab('asistente')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'asistente'
                  ? 'bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] shadow-xs'
                  : 'text-[oklch(0.68_0.03_250)] hover:text-white'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              Asistente
            </button>
          </nav>

          {/* User Chip & Acciones */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] px-3 py-1.5 rounded-full text-xs">
              <div className="w-6 h-6 rounded-full bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] flex items-center justify-center font-bold text-[10px] text-[oklch(0.15_0.03_260)]">
                {profile.businessName.slice(0, 2).toUpperCase()}
              </div>
              <span className="font-medium text-[oklch(0.97_0.01_240)] hidden md:inline">
                {profile.businessName}
              </span>
              <span className="text-[10px] text-[oklch(0.68_0.03_250)] font-mono hidden lg:inline">
                ({profile.rfc})
              </span>
            </div>

            <button
              onClick={() => setViewMode('landing')}
              title="Ver Landing Page informativa"
              className="p-2 rounded-xl border border-[oklch(0.30_0.03_260)] hover:bg-[oklch(0.24_0.028_260)] text-[oklch(0.68_0.03_250)] hover:text-white text-xs transition-colors flex items-center gap-1"
            >
              <Globe className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Landing</span>
            </button>

            {isDemo && <button
              onClick={handleResetToSeed}
              title="Restablecer a datos iniciales"
              className="p-2 rounded-xl border border-[oklch(0.30_0.03_260)] hover:bg-[oklch(0.24_0.028_260)] text-[oklch(0.68_0.03_250)] hover:text-white text-xs transition-colors flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset demo</span>
            </button>}
            <Link href={isDemo ? "/workspace" : "/demo"} className="text-xs underline">{isDemo ? "Mi espacio" : "Demo"}</Link>
          </div>
        </div>
      </header>

      {operationError && <p role="alert" className="max-w-[1180px] mx-auto px-6 py-3 text-red-300">{operationError}</p>}
      {/* Contenedor Principal Shell */}
      <div className="max-w-[1180px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Banner de Arquitectura Blindada */}
        <section className="p-3.5 rounded-2xl border border-[oklch(0.78_0.15_195/0.3)] bg-[oklch(0.78_0.15_195/0.08)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-[oklch(0.97_0.01_240)]">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[oklch(0.78_0.15_195)] shrink-0" />
            <span>
              <strong>{isDemo ? "Modo demostración:" : "Conciliación documental:"}</strong> XML y movimientos CSV se revisan con reglas deterministas. La vigencia SAT, lista EFOS oficial, OCR e IA están pendientes de configurar.
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono shrink-0">
            <span className="px-2 py-0.5 rounded bg-[oklch(0.72_0.17_155/0.2)] text-[oklch(0.72_0.17_155)]">
              XML: 0 Tokens
            </span>
            <span className="px-2 py-0.5 rounded bg-[oklch(0.65_0.20_295/0.2)] text-purple-300">
              SAT: no verificado
            </span>
          </div>
        </section>

        {/* ==================== TAB 1: PANEL ==================== */}
        {activeTab === 'panel' && (
          <div className="space-y-6 animate-fade-in">
            <FiscalDashboardPanel
              metrics={metrics}
              cfdis={cfdis}
              transactions={transactions}
              onGoToFacturas={() => setActiveTab('facturas')}
            />

            {/* Escudo de Flujo de Caja dentro del Panel */}
            <div className="pt-2">
              <CashFlowShield metrics={metrics} />
            </div>
          </div>
        )}

        {/* ==================== TAB 2: FACTURAS & TESORERÍA ==================== */}
        {activeTab === 'facturas' && (
          <div className="space-y-6 animate-fade-in">
            {/* Botón directo de Registrar Factura */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="font-sora font-bold text-xl text-white">
                  Tesorería & Comprobantes Fiscales
                </h1>
                <p className="text-xs text-[oklch(0.68_0.03_250)]">
                  Conciliación determinista en tiempo real clasificada en 3 estados
                </p>
              </div>

              <button
                onClick={() => setIsRegisterModalOpen(true)}
                className="px-4 py-2.5 rounded-xl bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] text-xs font-sora font-bold shadow-glow flex items-center gap-2 hover:brightness-105 transition-all"
              >
                <Plus className="w-4 h-4" />
                Registrar Factura
              </button>
            </div>

            {/* Dropzone Unificado */}
            <UnifiedDropzone userId={profile.id} demoMode={isDemo} onCfdiAdded={handleCfdiAdded} />
            <BankCsvImport userId={profile.id} accountId="cuenta-csv-01" onTransactionsImported={handleTransactionsImported} />

            {/* Inbox de Tesorería Unificado */}
            <TreasuryInbox
              transactions={transactions}
              cfdis={cfdis}
              onOpenResolver={(tx) => setSelectedAmbiguousTx(tx)}
              onOpenCfdiDetail={(cfdi) => setSelectedCfdi(cfdi)}
              onUnmatch={handleUnmatch}
              onResumeReconciliation={handleResumeReconciliation}
              onRequestUploadForDiscrepancy={() => {
                window.scrollTo({ top: 120, behavior: 'smooth' });
              }}
              onOpenRegisterModal={() => setIsRegisterModalOpen(true)}
            />
          </div>
        )}

        {/* ==================== TAB 3: ASISTENTE CONTADOR CON IA ==================== */}
        {activeTab === 'asistente' && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <h1 className="font-sora font-bold text-xl text-white">
                Asistente de tus movimientos
              </h1>
              <p className="text-xs text-[oklch(0.68_0.03_250)]">
                Resúmenes basados en los documentos y movimientos registrados
              </p>
            </div>

            <AssistantChat key={mode + profile.id} mode={mode} profile={profile}
              metrics={metrics}
              transactions={transactions}
              cfdis={cfdis}
            />
          </div>
        )}
      </div>

      {/* Modal para Registrar Factura con deducción LISR */}
      <RegisterInvoiceModal userId={profile.id} receptorRfc={profile.rfc} receptorName={profile.businessName}
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        onInvoiceCreated={(newCfdi) => {
          return handleCfdiAdded(newCfdi, 'manual');
        }}
      />

      {/* Modal para Resolver Ambigüedades en 1 Clic */}
      <AmbiguousResolverModal
        isOpen={!!selectedAmbiguousTx}
        onClose={() => setSelectedAmbiguousTx(null)}
        transaction={selectedAmbiguousTx}
        candidates={ambiguousCandidates}
        onResolve={handleResolveAmbiguous}
      />

      {/* Modal para Inspección de CFDI */}
      <CfdiDetailModal
        isOpen={!!selectedCfdi}
        onClose={() => setSelectedCfdi(null)}
        cfdi={selectedCfdi}
      />
    </main>
  );
}
