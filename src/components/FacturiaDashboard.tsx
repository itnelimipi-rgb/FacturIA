'use client';

import React, { useState, useEffect, useRef, useReducer, useCallback } from 'react';
import Link from 'next/link';
import { WorkspaceExportControls } from './WorkspaceExportControls';
import { manualDocumentSchema } from '../lib/validation';
import { WorkspaceRestoreControls } from './WorkspaceRestoreControls';
import { TreasuryInbox } from './TreasuryInbox';
import { DocumentLibrary } from './DocumentLibrary';
import { AmbiguousResolverModal } from './AmbiguousResolverModal';
import { CfdiDetailModal } from './CfdiDetailModal';
import { RegisterInvoiceModal } from './RegisterInvoiceModal';
import { AssistantChat } from './AssistantChat';
import { LandingHero } from './LandingHero';
import { HomeOverview } from './HomeOverview';
import { AccountMenu } from './AccountMenu';
import { Dialog } from './Dialog';
import { RequestError, UploadCenter, type UploadOps, type WorkspaceSnapshot } from './UploadCenter';
import { INITIAL_WORKSPACE_NAVIGATION, workspaceNavigationReducer, workspaceSectionTargets, type MovementFilter, type WorkspaceSection } from '../lib/workspaceNavigation';
import { FacturiaStore } from '../lib/mockStore';
import { MatchingEngineService } from '../lib/MatchingEngineService';
import { buildHomeSummary } from '../lib/homeSummary';
import { BankTransaction, CfdiRecord, Profile } from '../lib/types';
import { SEED_PROFILE, SEED_TRANSACTIONS, SEED_CFDIS } from '../lib/seed';
import { Bot, CheckCircle2, AlertCircle, FilePlus2, Landmark, LayoutDashboard, Receipt, Shield, UploadCloud, X } from 'lucide-react';
import { ui } from './ui';

type Snapshot = WorkspaceSnapshot;
type UploadRequest = {key: number; files: File[]; target: BankTransaction | null};
type Toast = {kind: 'success' | 'error'; text: string};

const workspaceSections: Array<{value: WorkspaceSection; label: string; Icon: typeof LayoutDashboard}> = [
  {value: 'home', label: 'Inicio', Icon: LayoutDashboard},
  {value: 'movements', label: 'Movimientos', Icon: Landmark},
  {value: 'documents', label: 'Documentos', Icon: Receipt},
  {value: 'help', label: 'Asistente', Icon: Bot},
];

async function readResponse(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(typeof data?.error === 'string' ? data.error : fallback, response.status);
  return data;
}

export default function FacturiaDashboard({ mode = 'demo', initialSnapshot, onSignOut, signingOut = false }: {
  mode?: 'demo' | 'workspace'; initialSnapshot?: Snapshot; onSignOut?: () => void; signingOut?: boolean;
}) {
  const isDemo = mode === 'demo';
  const [viewMode, setViewMode] = useState<'app' | 'landing'>('app');
  const [navigation, navigate] = useReducer(workspaceNavigationReducer, INITIAL_WORKSPACE_NAVIGATION);
  const activeTab = navigation.section;
  const [demoRevision, setDemoRevision] = useState(0);
  const lastSnapshot = useRef<Snapshot | null>(initialSnapshot ?? null);

  const [profile, setProfile] = useState<Profile>(initialSnapshot?.profile || SEED_PROFILE);
  const [transactions, setTransactions] = useState<BankTransaction[]>(() =>
    MatchingEngineService.evaluateBatch(initialSnapshot?.transactions || SEED_TRANSACTIONS, initialSnapshot?.cfdis || SEED_CFDIS, initialSnapshot?.profile || SEED_PROFILE)
  );
  const [cfdis, setCfdis] = useState<CfdiRecord[]>(initialSnapshot?.cfdis || SEED_CFDIS);

  const [selectedAmbiguousTx, setSelectedAmbiguousTx] = useState<BankTransaction | null>(null);
  const [selectedCfdi, setSelectedCfdi] = useState<CfdiRecord | null>(null);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [upload, setUpload] = useState<UploadRequest | null>(null);
  const [dataDialogOpen, setDataDialogOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busyMovementId, setBusyMovementId] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [dragging, setDragging] = useState(false);
  const uploadKey = useRef(0);

  useEffect(() => {
    if (!isDemo) return;
    const p = FacturiaStore.getProfile();
    const t = FacturiaStore.getTransactions();
    const c = FacturiaStore.getCfdis();
    const evaluated = MatchingEngineService.evaluateBatch(t, c, p);
    FacturiaStore.saveTransactions(evaluated);
    lastSnapshot.current = {profile: p, transactions: evaluated, cfdis: c};
    // Hydrate the browser storage snapshot after the server-rendered demo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(p); setTransactions(evaluated); setCfdis(c);
  }, [isDemo]);

  useEffect(() => {
    if (isDemo) return;
    const controller = new AbortController();
    fetch('/api/account/features', {cache: 'no-store', signal: controller.signal})
      .then(response => response.json()).then(data => setAiEnabled(data?.aiEnabled === true)).catch(() => {});
    return () => controller.abort();
  }, [isDemo]);

  useEffect(() => {
    if (toast?.kind !== 'success') return;
    const timer = setTimeout(() => setToast(current => current === toast ? null : current), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  const applySnapshot = useCallback((data: Snapshot) => {
    lastSnapshot.current = data;
    setProfile(data.profile); setTransactions(data.transactions); setCfdis(data.cfdis);
  }, []);
  const currentSnapshot = (): Snapshot => lastSnapshot.current ?? {profile, transactions, cfdis};
  const workspaceAction = async (body: unknown): Promise<Snapshot> => {
    const data = await readResponse(await fetch('/api/workspace', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}), 'No se pudo guardar el cambio.');
    applySnapshot(data);
    return data as Snapshot;
  };
  const demoSave = (result: {updatedTransactions: BankTransaction[]; updatedCfdis: CfdiRecord[]}): Snapshot => {
    const next = {profile: currentSnapshot().profile, transactions: result.updatedTransactions, cfdis: result.updatedCfdis};
    applySnapshot(next);
    return next;
  };
  const provisionalRequests = useRef(new WeakMap<File, {fingerprint: string; key: string}>());
  const saveProvisional = async (document: CfdiRecord, file: File): Promise<Snapshot> => {
    const fields = manualDocumentSchema.parse(document);
    const fingerprint = JSON.stringify(fields);
    const previous = provisionalRequests.current.get(file);
    const key = previous?.fingerprint === fingerprint ? previous.key : crypto.randomUUID();
    provisionalRequests.current.set(file, {fingerprint, key});
    const body = new FormData();
    body.set('document', fingerprint); body.set('file', file);
    const data = await readResponse(await fetch('/api/workspace/documents/provisional', {method: 'POST', headers: {'Idempotency-Key': key}, body}), 'No se pudo guardar el gasto y su original.');
    applySnapshot(data);
    return data as Snapshot;
  };
  const ops: UploadOps = isDemo ? {
    addXml: async document => demoSave(FacturiaStore.addCfdi(document)),
    addTransactions: async records => demoSave(FacturiaStore.addTransactions(records)),
    addProvisional: async document => demoSave(FacturiaStore.addCfdi(document)),
  } : {
    addXml: (_document, rawXml) => workspaceAction({action: 'xml', rawXml}),
    addTransactions: records => workspaceAction({action: 'transactions', transactions: records}),
    addProvisional: (document, _source, file) => saveProvisional(document, file),
  };

  const handleManualExpense = async (document: CfdiRecord) => {
    if (isDemo) demoSave(FacturiaStore.addCfdi(document));
    else await workspaceAction({action: 'manual', document});
    setToast({kind: 'success', text: 'Gasto anotado. Cuando tengas su factura XML, súbela.'});
  };
  const runMovementAction = async (transactionId: string, action: 'resolve' | 'unmatch' | 'resumeReconciliation', cfdiId?: string) => {
    if (isDemo) {
      const updated = action === 'resolve' ? FacturiaStore.resolveAmbiguous(transactionId, cfdiId!)
        : action === 'unmatch' ? FacturiaStore.unmatchTransaction(transactionId) : FacturiaStore.resumeReconciliation(transactionId);
      lastSnapshot.current = {...currentSnapshot(), transactions: updated};
      setTransactions(updated);
      return updated;
    }
    return (await workspaceAction({action, transactionId, ...(cfdiId ? {cfdiId} : {})})).transactions;
  };
  const handleResolveAmbiguous = async (txId: string, selectedCfdiId: string) => {
    await runMovementAction(txId, 'resolve', selectedCfdiId);
    setSelectedAmbiguousTx(null);
    setToast({kind: 'success', text: 'Listo: la factura quedó vinculada al movimiento.'});
  };
  const handleUnmatch = async (txId: string) => {
    await runMovementAction(txId, 'unmatch');
    setToast({kind: 'success', text: 'Quitamos la factura del movimiento; no se borró nada. Usa «Volver a buscar» si cambias de opinión.'});
  };
  const handleResume = async (txId: string) => {
    const updated = await runMovementAction(txId, 'resumeReconciliation');
    const result = updated.find(record => record.id === txId);
    setToast({kind: 'success', text: result?.status === 'conciliado' ? 'Encontramos su factura y quedó vinculada.' : result?.status === 'ambiguo' ? 'Hay varias facturas posibles: elige la correcta.' : 'Buscamos de nuevo, pero todavía no hay una factura que coincida.'});
  };
  const resumeFromHome = async (transaction: BankTransaction) => {
    if (busyMovementId) return;
    setBusyMovementId(transaction.id);
    try { await handleResume(transaction.id); }
    catch (error) { setToast({kind: 'error', text: error instanceof Error ? error.message : 'No se pudo volver a buscar.'}); }
    finally { setBusyMovementId(null); }
  };
  const handleResetToSeed = () => {
    const {transactions: t, cfdis: c} = FacturiaStore.resetToSeed();
    const evaluated = MatchingEngineService.evaluateBatch(t, c, SEED_PROFILE);
    lastSnapshot.current = {profile: SEED_PROFILE, transactions: evaluated, cfdis: c};
    FacturiaStore.saveTransactions(evaluated); setProfile(SEED_PROFILE); setTransactions(evaluated); setCfdis(c);
    setDemoRevision(previous => previous + 1);
    navigate({type: 'reset'}); setToast({kind: 'success', text: 'Volvimos a los datos de ejemplo.'});
  };

  const openUpload = (files: File[] = [], target: BankTransaction | null = null) => setUpload({key: ++uploadKey.current, files, target});
  const openRecords = (section: 'movements' | 'documents', filter: MovementFilter = 'all') => navigate({type: 'records', section, filter});

  // Files dropped anywhere on the page open the same upload flow.
  useEffect(() => {
    if (viewMode !== 'app') return;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const over = (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); setDragging(true); };
    const leave = (event: DragEvent) => { if (!event.relatedTarget) setDragging(false); };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) setUpload(current => current ?? {key: ++uploadKey.current, files, target: null});
    };
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'app' || navigation.request === 0) return;
    const section = document.getElementById(navigation.focusTarget);
    section?.focus({preventScroll: true});
    window.scrollTo({top: 0, behavior: 'auto'});
  }, [navigation.request, navigation.focusTarget, viewMode]);

  const ambiguousCandidates: CfdiRecord[] = selectedAmbiguousTx
    ? (selectedAmbiguousTx.candidateCfdiIds || []).map(id => cfdis.find(c => c.id === id)).filter((c): c is CfdiRecord => c !== undefined)
    : [];
  const pendingCount = buildHomeSummary(transactions, cfdis, profile.rfc).pending.length;

  if (viewMode === 'landing') return <main className="min-h-screen bg-[oklch(0.16_0.02_260)]"><LandingHero onEnterDemo={() => setViewMode('app')} /></main>;

  return (
    <main className="facturia-app min-h-screen bg-[oklch(0.16_0.02_260)] pb-24 text-[oklch(0.97_0.01_240)] antialiased font-inter md:pb-10">
      <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-[oklch(0.16_0.02_260)]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-tr from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] shadow-glow"><Shield aria-hidden="true" className="h-5 w-5" /></div>
            <div className="min-w-0">
              <p className="font-sora text-base font-extrabold leading-none tracking-tight">Factur<span className="text-[oklch(0.78_0.15_195)]">IA</span></p>
              <p className="mt-0.5 truncate text-xs text-slate-400">{isDemo ? 'Demo con ejemplos' : profile.businessName}</p>
            </div>
          </div>
          <nav aria-label="Secciones de FacturIA" className="hidden items-center gap-1 rounded-xl border border-white/10 bg-[oklch(0.21_0.025_260)] p-1 md:flex">
            {workspaceSections.map(({value, label, Icon}) => <button key={value} type="button" onClick={() => navigate({type: 'section', section: value})}
              aria-current={activeTab === value ? 'page' : undefined} aria-controls={workspaceSectionTargets[value]}
              className={`flex min-h-10 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${ui.focus} ${activeTab === value ? 'bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)]' : 'text-slate-300 hover:text-white'}`}>
              <Icon aria-hidden="true" className="h-4 w-4" />{label}
              {value === 'home' && pendingCount > 0 && <span className={`ml-0.5 rounded-full px-1.5 text-xs ${activeTab === value ? 'bg-slate-950/20' : 'bg-amber-200 text-slate-950'}`}>{pendingCount}</span>}
            </button>)}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => openUpload()} className={`${ui.primary} px-3 sm:px-4`}><UploadCloud aria-hidden="true" className="h-4 w-4" /><span className="hidden sm:inline">Subir archivos</span><span className="sm:hidden">Subir</span></button>
            <AccountMenu profile={profile} demoMode={isDemo} busy={signingOut} onDownloads={() => setDataDialogOpen(true)} onAbout={() => setViewMode('landing')}
              onReset={isDemo ? handleResetToSeed : undefined} onSignOut={onSignOut} />
          </div>
        </div>
        {isDemo && <div className="border-t border-white/10 bg-amber-200/10">
          <p className="mx-auto max-w-[1180px] px-4 py-2 text-sm text-amber-100 sm:px-6">Estás viendo datos de ejemplo; los cambios sólo se guardan en este navegador. <Link href="/workspace" className="font-semibold underline underline-offset-4">Crear mi cuenta</Link></p>
        </div>}
      </header>

      <nav aria-label="Secciones de FacturIA (móvil)" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-white/10 bg-[oklch(0.18_0.02_260)]/95 backdrop-blur-md md:hidden">
        {workspaceSections.map(({value, label, Icon}) => <button key={value} type="button" onClick={() => navigate({type: 'section', section: value})}
          aria-current={activeTab === value ? 'page' : undefined} aria-controls={workspaceSectionTargets[value]}
          className={`relative flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${ui.focus} ${activeTab === value ? 'text-cyan-200' : 'text-slate-400'}`}>
          <Icon aria-hidden="true" className="h-5 w-5" />{label}
          {value === 'home' && pendingCount > 0 && <span className="absolute right-[calc(50%-1.4rem)] top-2 rounded-full bg-amber-200 px-1.5 text-[0.7rem] font-semibold text-slate-950">{pendingCount}</span>}
        </button>)}
      </nav>

      <div className="mx-auto max-w-[1180px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <section id="workspace-home" hidden={activeTab !== 'home'} tabIndex={-1} aria-label="Inicio" className="rounded-xl focus:outline-none">
          <HomeOverview transactions={transactions} documents={cfdis} profileRfc={profile.rfc} businessName={profile.businessName} demoMode={isDemo}
            busyMovementId={busyMovementId} onUpload={() => openUpload()} onChoose={setSelectedAmbiguousTx} onUploadFor={transaction => openUpload([], transaction)}
            onResume={transaction => void resumeFromHome(transaction)} onShowMovements={filter => openRecords('movements', filter)} onShowDocuments={() => openRecords('documents')} />
        </section>

        <section id="workspace-movements-page" hidden={activeTab !== 'movements'} tabIndex={-1} aria-labelledby="movements-page-title" className="space-y-5 rounded-xl focus:outline-none">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h1 id="movements-page-title" className="font-sora text-2xl font-bold text-white">Movimientos</h1><p className="mt-1 text-sm text-slate-400">Lo que entró y salió según tus estados de cuenta, y la factura de cada uno.</p></div>
            <button type="button" onClick={() => openUpload()} className={ui.secondary}><UploadCloud aria-hidden="true" className="h-4 w-4" />Subir estado de cuenta</button>
          </div>
          <TreasuryInbox key={`movements-${demoRevision}`} reviewRequest={navigation.reviewRequest} transactions={transactions} cfdis={cfdis} profileRfc={profile.rfc}
            onOpenResolver={setSelectedAmbiguousTx} onOpenCfdiDetail={setSelectedCfdi} onUnmatch={handleUnmatch} onResumeReconciliation={handleResume}
            onRequestUploadForDiscrepancy={transaction => openUpload([], transaction)} onUpload={() => openUpload()} />
        </section>

        <section id="workspace-documents-page" hidden={activeTab !== 'documents'} tabIndex={-1} aria-labelledby="documents-page-title" className="space-y-5 rounded-xl focus:outline-none">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h1 id="documents-page-title" className="font-sora text-2xl font-bold text-white">Documentos</h1><p className="mt-1 text-sm text-slate-400">Tus facturas, pagos, notas de crédito y gastos.</p></div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setIsRegisterModalOpen(true)} className={ui.quiet}><FilePlus2 aria-hidden="true" className="h-4 w-4" />Anotar gasto sin factura</button>
              <button type="button" onClick={() => openUpload()} className={ui.secondary}><UploadCloud aria-hidden="true" className="h-4 w-4" />Subir documentos</button>
            </div>
          </div>
          <DocumentLibrary key={`documents-${demoRevision}`} cfdis={cfdis} transactions={transactions} profileRfc={profile.rfc} onOpenCfdiDetail={setSelectedCfdi} onUpload={() => openUpload()} />
        </section>

        <section id="workspace-help" hidden={activeTab !== 'help'} tabIndex={-1} aria-labelledby="help-page-title" className="space-y-4 rounded-xl focus:outline-none">
          <div><h1 id="help-page-title" className="font-sora text-2xl font-bold text-white">Asistente</h1><p className="mt-1 text-sm text-slate-400">Pregunta qué tienes pendiente o cómo hacer algo.</p></div>
          <AssistantChat visible={activeTab === 'help'} mode={mode} profile={profile} transactions={transactions} cfdis={cfdis} aiEnabled={aiEnabled} />
        </section>
      </div>

      {dragging && !upload && <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-cyan-950/70 backdrop-blur-xs">
        <p className="rounded-2xl border-2 border-dashed border-cyan-200 px-10 py-8 font-sora text-xl font-bold text-white">Suelta tus archivos para subirlos</p>
      </div>}

      {toast && <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6">
        <div role={toast.kind === 'error' ? 'alert' : 'status'} className={`flex max-w-xl items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl ${toast.kind === 'error' ? 'border-rose-800 bg-rose-950 text-rose-100' : 'border-emerald-800 bg-[oklch(0.22_0.04_170)] text-emerald-50'}`}>
          {toast.kind === 'error' ? <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{toast.text}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setToast(null)} className="-my-1 -mr-1 rounded-lg p-1 hover:bg-white/10"><X aria-hidden="true" className="h-4 w-4" /></button>
        </div>
      </div>}

      {upload && <UploadCenter key={upload.key} mode={mode} snapshot={{profile, transactions, cfdis}} ops={ops} aiEnabled={aiEnabled}
        target={upload.target} initialFiles={upload.files} onClose={() => setUpload(null)}
        onOpenDocument={document => { setUpload(null); setSelectedCfdi(document); }}
        onReviewPending={() => { setUpload(null); openRecords('movements', 'pending'); }} />}

      {dataDialogOpen && <Dialog title="Descargar mis datos" description={isDemo ? 'Descarga los ejemplos de la demo.' : 'Para tu contador o para guardar una copia de seguridad.'} onClose={() => setDataDialogOpen(false)}>
        <div className="space-y-5">
          <WorkspaceExportControls mode={mode} snapshot={{profile, transactions, cfdis}} />
          {!isDemo && <WorkspaceRestoreControls profile={profile} occupied={transactions.length > 0 || cfdis.length > 0} onRestored={applySnapshot} />}
        </div>
      </Dialog>}

      <RegisterInvoiceModal userId={profile.id} receptorRfc={profile.rfc} receptorName={profile.businessName}
        isOpen={isRegisterModalOpen} onClose={() => setIsRegisterModalOpen(false)} onInvoiceCreated={handleManualExpense} />

      <AmbiguousResolverModal isOpen={!!selectedAmbiguousTx} onClose={() => setSelectedAmbiguousTx(null)} transaction={selectedAmbiguousTx}
        candidates={ambiguousCandidates} profileRfc={profile.rfc} onResolve={handleResolveAmbiguous} />

      <CfdiDetailModal demoMode={isDemo}
        onSnapshotUpdated={data => {
          if (!data.profile) return;
          applySnapshot({...data, profile: data.profile});
          setSelectedCfdi(previous => previous ? data.cfdis.find(document => document.id === previous.id) ?? null : null);
        }}
        isOpen={!!selectedCfdi} onClose={() => setSelectedCfdi(null)} cfdi={selectedCfdi} documents={cfdis} />
    </main>
  );
}
