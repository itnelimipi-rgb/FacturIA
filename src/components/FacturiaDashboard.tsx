'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { BankCsvImport } from '../components/BankCsvImport';
import { WorkspaceExportControls } from './WorkspaceExportControls';
import {manualDocumentSchema} from '../lib/validation';
import { WorkspaceRestoreControls } from './WorkspaceRestoreControls';
import { CashFlowShield } from '../components/CashFlowShield';
import { UnifiedDropzone } from '../components/UnifiedDropzone';
import { TreasuryInbox } from '../components/TreasuryInbox';
import { AmbiguousResolverModal } from '../components/AmbiguousResolverModal';
import { CfdiDetailModal } from '../components/CfdiDetailModal';
import { RegisterInvoiceModal } from '../components/RegisterInvoiceModal';
import { FiscalDashboardPanel } from '../components/FiscalDashboardPanel';
import { AssistantChat } from '../components/AssistantChat';
import { LandingHero } from '../components/LandingHero';
import { GettingStarted } from './GettingStarted';
import { FacturiaStore } from '../lib/mockStore';
import { MatchingEngineService } from '../lib/MatchingEngineService';
import { BankTransaction, CfdiRecord, Profile, ReconciliationStatus } from '../lib/types';
import { SEED_PROFILE, SEED_TRANSACTIONS, SEED_CFDIS } from '../lib/seed';
import {
  Shield,
  RotateCcw,
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
  const [operationNotice, setOperationNotice] = useState('');
  const [viewMode, setViewMode] = useState<'app' | 'landing'>('app');
  const [activeTab, setActiveTab] = useState<'panel' | 'facturas' | 'asistente'>('panel');
  const [navigation, setNavigation] = useState<{filter: 'all' | ReconciliationStatus; section: 'movements' | 'documents'; request: number}>({filter: 'all', section: 'movements', request: 0});
  const [uploadFocus, setUploadFocus] = useState<'document-upload' | 'bank-upload' | null>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const [demoRevision, setDemoRevision] = useState(0);
  const shellRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const lastSnapshot = useRef<Snapshot | null>(initialSnapshot ?? null);

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

  useEffect(() => {
    const shell = shellRef.current;
    const header = headerRef.current;
    if (!shell || !header) return;
    const updateOffset = () => shell.style.setProperty('--facturia-header-offset', `${window.matchMedia('(min-width: 640px)').matches ? header.getBoundingClientRect().height + 16 : 16}px`);
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(header);
    window.addEventListener('resize', updateOffset);
    return () => {observer.disconnect(); window.removeEventListener('resize', updateOffset);};
  }, [viewMode]);

  const metrics = MatchingEngineService.calculateCashFlowShieldMetrics(transactions, cfdis);
  const applySnapshot = (data: Snapshot) => {
    lastSnapshot.current = data;
    setProfile(data.profile); setTransactions(data.transactions); setCfdis(data.cfdis);
  };
  const provisionalRequests = useRef(new WeakMap<File, {fingerprint: string; key: string}>());
  const workspaceAction = async (body: unknown) => {
    const res = await fetch('/api/workspace', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el cambio');
    applySnapshot(data);
    return data as Snapshot;
  };
  const handleProvisionalAdded = async (document: CfdiRecord, _source: 'pdf' | 'image', file: File) => {
    const fields = manualDocumentSchema.parse(document);
    const fingerprint = JSON.stringify(fields);
    const previous = provisionalRequests.current.get(file);
    const key = previous?.fingerprint === fingerprint ? previous.key : crypto.randomUUID();
    provisionalRequests.current.set(file, {fingerprint, key});
    const body = new FormData();
    body.set('document', fingerprint); body.set('file', file);
    const response = await fetch('/api/workspace/documents/provisional', {method: 'POST', headers: {'Idempotency-Key': key}, body});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el gasto y su original.');
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
    lastSnapshot.current = {profile, transactions: updatedTransactions, cfdis: updatedCfdis};
    setCfdis(updatedCfdis); setTransactions(updatedTransactions);
  };
  const handleTransactionsImported = async (newTransactions: BankTransaction[]) => {
    if (!isDemo) { await workspaceAction({action: 'transactions', transactions: newTransactions}); return; }
    const {updatedTransactions, updatedCfdis} = FacturiaStore.addTransactions(newTransactions);
    lastSnapshot.current = {profile, transactions: updatedTransactions, cfdis: updatedCfdis};
    setTransactions(updatedTransactions); setCfdis(updatedCfdis);
  };
  const handleResolveAmbiguous = async (txId: string, selectedCfdiId: string) => {
    try {
      setOperationError('');
      setOperationNotice('');
      if (isDemo) setTransactions(FacturiaStore.resolveAmbiguous(txId, selectedCfdiId));
      else await workspaceAction({action: 'resolve', transactionId: txId, cfdiId: selectedCfdiId});
      setSelectedAmbiguousTx(null);
      setOperationNotice('Documento vinculado. Puedes abrirlo o quitar la relación desde el movimiento.');
    } catch (error) { setOperationError(error instanceof Error ? error.message : 'No se pudo guardar la relación. Intenta de nuevo.'); throw error; }
  };
  const handleUnmatch = async (txId: string) => {
    try {
      setOperationError('');
      setOperationNotice('');
      if (isDemo) setTransactions(FacturiaStore.unmatchTransaction(txId));
      else await workspaceAction({action: 'unmatch', transactionId: txId});
      setOperationNotice('Se quitó la relación, sin borrar el documento ni el movimiento. La búsqueda quedó pausada; usa «Volver a buscar» para reactivarla.');
    } catch (error) { setOperationError(error instanceof Error ? error.message : 'No se pudo quitar la relación. Intenta de nuevo.'); throw error; }
  };
  const handleResumeReconciliation = async (txId: string) => {
    try {
      setOperationError('');
      setOperationNotice('');
      if (isDemo) setTransactions(FacturiaStore.resumeReconciliation(txId));
      else await workspaceAction({action: 'resumeReconciliation', transactionId: txId});
      setOperationNotice('La búsqueda se reactivó. Revisa el resultado junto al movimiento.');
    } catch (error) { setOperationError(error instanceof Error ? error.message : 'No se pudo volver a buscar. Intenta de nuevo.'); throw error; }
  };
  const handleResetToSeed = () => {
    const {transactions: t, cfdis: c} = FacturiaStore.resetToSeed();
    const evaluated = MatchingEngineService.evaluateBatch(t, c, SEED_PROFILE);
    lastSnapshot.current = {profile: SEED_PROFILE, transactions: evaluated, cfdis: c};
    FacturiaStore.saveTransactions(evaluated); setProfile(SEED_PROFILE); setTransactions(evaluated); setCfdis(c);
    setDemoRevision(previous => previous + 1);
    setUploadTargetId(null); setOperationError(''); setOperationNotice('Se restablecieron los datos de ejemplo.');
  };

  const openRecords = (section: 'movements' | 'documents', filter: 'all' | ReconciliationStatus = 'all') => {
    setUploadFocus(null); setActiveTab('facturas');
    setNavigation(previous => ({section, filter, request: previous.request + 1}));
  };
  const openUpload = (kind: 'document-upload' | 'bank-upload', target?: BankTransaction) => {
    setUploadTargetId(target?.id ?? null); setUploadFocus(kind); setActiveTab('facturas');
    setNavigation(previous => ({section: kind === 'document-upload' ? 'documents' : 'movements', filter: 'all', request: previous.request + 1}));
  };
  useEffect(() => {
    if (activeTab !== 'facturas' || !uploadFocus) return;
    const section = document.getElementById(uploadFocus);
    section?.focus(); section?.scrollIntoView({block: 'start', behavior: 'auto'});
  }, [activeTab, uploadFocus, navigation.request]);
  const uploadTarget = transactions.find(transaction => transaction.id === uploadTargetId);
  const openImportedDocument = (document: CfdiRecord) => {
    const saved = (lastSnapshot.current?.cfdis ?? cfdis).find(record => record.userId === profile.id && record.uuidSat && record.uuidSat.toUpperCase() === document.uuidSat.toUpperCase());
    if (saved) setSelectedCfdi(saved);
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
    <main ref={shellRef} className="facturia-app min-h-screen bg-[oklch(0.16_0.02_260)] text-[oklch(0.97_0.01_240)] antialiased font-inter">
      {/* Header Estilo Shell de la Referencia */}
      <header ref={headerRef} className="sm:sticky top-0 z-40 w-full border-b border-[oklch(0.30_0.03_260)] bg-[oklch(0.16_0.02_260)]/85 backdrop-blur-md">
        <div className="max-w-[1180px] mx-auto px-4 sm:px-6 flex items-center justify-between flex-wrap gap-3 py-3">
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
                {isDemo ? 'Datos de ejemplo' : 'Tus registros, guardados en tu cuenta'}
              </div>
            </div>
          </div>

          {/* Navegación por Tabs principales */}
          <nav aria-label="Secciones de FacturIA" className="flex flex-wrap items-center bg-[oklch(0.21_0.025_260)] p-1 rounded-xl border border-[oklch(0.30_0.03_260)]">
            <button
              onClick={() => setActiveTab('panel')}
              aria-pressed={activeTab === 'panel'}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'panel'
                  ? 'bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] shadow-xs'
                  : 'text-[oklch(0.68_0.03_250)] hover:text-white'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              Inicio
            </button>

            <button
              onClick={() => openRecords('movements')}
              aria-pressed={activeTab === 'facturas'}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'facturas'
                  ? 'bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] shadow-xs'
                  : 'text-[oklch(0.68_0.03_250)] hover:text-white'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              Movimientos y documentos
            </button>

            <button
              onClick={() => setActiveTab('asistente')}
              aria-pressed={activeTab === 'asistente'}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'asistente'
                  ? 'bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] shadow-xs'
                  : 'text-[oklch(0.68_0.03_250)] hover:text-white'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              Ayuda
            </button>
          </nav>

          {/* User Chip & Acciones */}
          <div className="flex flex-wrap items-center gap-2 max-w-full">
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
              title="Acerca de FacturIA"
              className="p-2 rounded-xl border border-[oklch(0.30_0.03_260)] hover:bg-[oklch(0.24_0.028_260)] text-[oklch(0.68_0.03_250)] hover:text-white text-xs transition-colors flex items-center gap-1"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Acerca de FacturIA</span>
            </button>

            {isDemo && <button
              onClick={handleResetToSeed}
              title="Restablecer a datos iniciales"
              className="p-2 rounded-xl border border-[oklch(0.30_0.03_260)] hover:bg-[oklch(0.24_0.028_260)] text-[oklch(0.68_0.03_250)] hover:text-white text-xs transition-colors flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reiniciar ejemplos</span>
            </button>}
            <Link href={isDemo ? "/workspace" : "/demo"} className="text-sm underline">{isDemo ? "Entrar a mi espacio" : "Probar con ejemplos"}</Link>
          </div>
        </div>
      </header>

      {operationError && <p role="alert" className="max-w-[1180px] mx-auto px-6 py-3 text-red-300">{operationError}</p>}
      {operationNotice && activeTab !== 'facturas' && <p role="status" className="max-w-[1180px] mx-auto px-6 py-3 text-sm text-cyan-100">{operationNotice}</p>}
      {/* Contenedor Principal Shell */}
      <div className="max-w-[1180px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Banner de Arquitectura Blindada */}
        <section aria-label={isDemo ? 'Estás usando datos de ejemplo' : 'Estás usando tu espacio personal'} className="p-4 rounded-xl border border-slate-700 bg-slate-900/60 text-sm text-slate-300">
          <strong className="text-white">{isDemo ? 'Estás probando con datos de ejemplo.' : 'Estás en tu espacio personal.'}</strong>{' '}
          {isDemo ? 'Los cambios de esta demo se guardan sólo en este navegador. Los estados del SAT y las alertas de proveedores son ejemplos.' : 'Los documentos y movimientos se guardan en tu cuenta. Cargar una factura y consultar su estado en el SAT son pasos distintos.'}
        </section>

        {/* ==================== TAB 1: PANEL ==================== */}
        {activeTab === 'panel' && (
          <div className="space-y-6 animate-fade-in">
            <GettingStarted transactions={transactions} documents={cfdis} demoMode={isDemo}
              onAddDocuments={() => openUpload('document-upload')}
              onAddMovements={() => openUpload('bank-upload')}
              onReview={filter => openRecords('movements', filter)} />
            <FiscalDashboardPanel
              metrics={metrics}
              cfdis={cfdis}
              transactions={transactions}
              profileRfc={profile.rfc}
              onGoToFacturas={() => openRecords('documents')}
              onReviewDocuments={() => openRecords('documents')}
              onReviewMovements={filter => openRecords('movements', filter)}
              onAddMovements={() => openUpload('bank-upload')}
            />

            {/* Escudo de Flujo de Caja dentro del Panel */}
            <div className="pt-2">
              <CashFlowShield metrics={metrics} transactions={transactions} onReviewMovements={filter => openRecords('movements', filter)} />
            </div>
          </div>
        )}

        {/* ==================== TAB 2: FACTURAS & TESORERÍA ==================== */}
        {activeTab === 'facturas' && (
          <div className="space-y-6 animate-fade-in">
            {/* Botón directo de Registrar Factura */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="font-sora font-bold text-xl text-white">
                  Movimientos y documentos
                </h1>
                <p className="text-xs text-[oklch(0.68_0.03_250)]">
                  Revisa qué documento corresponde a cada entrada o salida de dinero.
                </p>
              </div>

              <button
                onClick={() => setIsRegisterModalOpen(true)}
                className="px-4 py-2.5 rounded-xl bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] text-xs font-sora font-bold shadow-glow flex items-center gap-2 hover:brightness-105 transition-all"
              >
                <Plus className="w-4 h-4" />
                Anotar un gasto sin factura
              </button>
            </div>

            {/* Dropzone Unificado */}
            <section id="document-upload" tabIndex={-1} className="scroll-mt-48 rounded-xl" aria-label="Agregar documentos">
              {uploadTarget && <div className="mb-4 rounded-xl border border-slate-600 p-4 space-y-2 text-sm" role="status">
                <h2 className="font-semibold text-white">Documento para este movimiento</h2>
                <p>{uploadTarget.description} · {uploadTarget.date} · {new Intl.NumberFormat('es-MX', {style: 'currency', currency: uploadTarget.currency, currencyDisplay: 'code'}).format(Math.abs(uploadTarget.amount))}</p>
                <p className="text-slate-300">{uploadTarget.status === 'conciliado' ? 'Este movimiento ya tiene un documento vinculado. Puedes abrirlo desde la lista.' : uploadTarget.status === 'ambiguo' ? 'Hay una coincidencia que debes revisar. Abre el movimiento para comparar los documentos.' : uploadTarget.reconciliationLocked ? 'La búsqueda está pausada. Después de cargar el documento, usa «Volver a buscar» en el movimiento.' : 'Agrega el XML que podría corresponder. Al guardarlo se compararán sus datos; cargarlo no garantiza una coincidencia.'}</p>
                <div className="flex flex-wrap gap-4"><button type="button" className="underline text-cyan-200" onClick={() => openRecords('movements')}>Ver resultado en movimientos</button><button type="button" className="underline text-slate-300" onClick={() => setUploadTargetId(null)}>Quitar este contexto</button></div>
              </div>}
              <UnifiedDropzone key={`documents-${demoRevision}`} userId={profile.id} rfcReceptor={profile.rfc} demoMode={isDemo} onCfdiAdded={handleCfdiAdded} onCfdiOpened={openImportedDocument} onProvisionalAdded={isDemo ? undefined : handleProvisionalAdded} />
            </section>
            <section id="bank-upload" tabIndex={-1} className="scroll-mt-48 rounded-xl" aria-label="Agregar movimientos del banco"><BankCsvImport key={`bank-${demoRevision}`} userId={profile.id} accountId="cuenta-csv-01" onTransactionsImported={handleTransactionsImported} /></section>

            {/* Inbox de Tesorería Unificado */}
            <TreasuryInbox
              key={`list-${navigation.request}`}
              initialFilter={navigation.filter}
              focusSection={uploadFocus ? undefined : navigation.section}
              profileRfc={profile.rfc}
              notice={operationNotice}
              transactions={transactions}
              cfdis={cfdis}
              onOpenResolver={(tx) => setSelectedAmbiguousTx(tx)}
              onOpenCfdiDetail={(cfdi) => setSelectedCfdi(cfdi)}
              onUnmatch={handleUnmatch}
              onResumeReconciliation={handleResumeReconciliation}
              onRequestUploadForDiscrepancy={transaction => openUpload('document-upload', transaction)}
              onOpenRegisterModal={() => setIsRegisterModalOpen(true)}
            />
          </div>
        )}

        {/* ==================== TAB 3: ASISTENTE CONTADOR CON IA ==================== */}
        {activeTab === 'asistente' && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <h1 className="font-sora font-bold text-xl text-white">
                Ayuda para entender tus registros
              </h1>
              <p className="text-xs text-[oklch(0.68_0.03_250)]">
                Consulta qué necesita tu atención y cómo revisar un movimiento.
              </p>
            </div>

            <AssistantChat key={mode + profile.id} mode={mode} profile={profile}
              metrics={metrics}
              transactions={transactions}
              cfdis={cfdis}
            />
          </div>
        )}
        <details className="rounded-xl border border-slate-700 p-4 space-y-4">
          <summary className="cursor-pointer font-semibold text-base text-white">Descargar y recuperar mis registros</summary>
          <div className="mt-4 space-y-4"><WorkspaceExportControls mode={mode} snapshot={{profile, transactions, cfdis}} />
            {!isDemo && <WorkspaceRestoreControls profile={profile} occupied={transactions.length > 0 || cfdis.length > 0} onRestored={applySnapshot} />}
          </div>
        </details>
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
        demoMode={isDemo}
        onSnapshotUpdated={data => {
          if (!data.profile) return;
          applySnapshot({...data, profile: data.profile});
          setSelectedCfdi(previous => previous ? data.cfdis.find(document => document.id === previous.id) ?? null : null);
        }}
        isOpen={!!selectedCfdi}
        onClose={() => setSelectedCfdi(null)}
        cfdi={selectedCfdi}
        documents={cfdis}
      />
    </main>
  );
}
