'use client';

import React, {useEffect, useRef, useState} from 'react';
import {AlertCircle, CheckCircle2, CircleDashed, FileCode2, FileSpreadsheet, FileText, Loader2, MinusCircle, ShieldAlert, UploadCloud} from 'lucide-react';
import {Dialog} from './Dialog';
import {BankCsvReview} from './BankCsvReview';
import {DocumentExtraction} from './DocumentExtraction';
import {XmlCfdiParser} from '../lib/xmlParser';
import {EfosService} from '../lib/efosService';
import {MAX_BANK_CSV_BYTES, decodeBankCsvBytes, parseBankCsv, type BankCsvResult} from '../lib/bankCsvParser';
import {classifyUpload, unsupportedUploadMessage, uploadOrder, UPLOAD_ACCEPT, type UploadKind} from '../lib/uploadRouting';
import {validateDocumentFile, type DocumentSource} from '../lib/documentExtraction';
import {candidateComparison, counterpartName, documentCardLabel, invoiceOrientation} from '../lib/reconciliationPresentation';
import {buildHomeSummary} from '../lib/homeSummary';
import {documentAmountText} from '../lib/documentSummary';
import {demoSampleXml} from '../lib/demoSamples';
import {formatDay, formatMoney, formatSignedMoney} from '../lib/format';
import type {BankTransaction, CfdiRecord, Profile} from '../lib/types';
import {ui} from './ui';

export type WorkspaceSnapshot = {profile: Profile; transactions: BankTransaction[]; cfdis: CfdiRecord[]};
export class RequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
/** Saving is delegated: the demo writes to this browser, the account writes to the server. */
export interface UploadOps {
  addXml(document: CfdiRecord, rawXml: string): Promise<WorkspaceSnapshot>;
  addTransactions(transactions: BankTransaction[]): Promise<WorkspaceSnapshot>;
  addProvisional(document: CfdiRecord, source: DocumentSource, file: File): Promise<WorkspaceSnapshot>;
}

type ItemState = 'waiting' | 'working' | 'review' | 'done' | 'repeated' | 'error' | 'skipped';
interface UploadItem {id: string; file: File; kind: UploadKind; state: ItemState; title: string; detail?: string; documentId?: string; csv?: BankCsvResult; saved?: number; invoice?: boolean}

/** Same account identity as earlier imports, so a repeated statement keeps its movement IDs. */
export const BANK_ACCOUNT_ID = 'cuenta-csv-01';
const MAX_XML_BYTES = 2 * 1024 * 1024;
const activeStates: ItemState[] = ['waiting', 'working', 'review'];

const isDuplicate = (error: unknown) => (error instanceof RequestError && error.status === 409 && /ya existe/i.test(error.message))
  || (typeof error === 'object' && error !== null && (error as {code?: string}).code === 'DUPLICATE_CFDI');

/** What happened to a saved CFDI, from the snapshot the save returned; never a promise of a link. */
export function describeSavedDocument(document: CfdiRecord, snapshot: Pick<WorkspaceSnapshot, 'transactions'>, profileRfc: string, target?: BankTransaction | null): string {
  const linked = snapshot.transactions.find(record => record.status === 'conciliado' && record.matchedCfdiId === document.id);
  const contested = snapshot.transactions.filter(record => record.status === 'ambiguo' && record.candidateCfdiIds?.includes(document.id));
  if (target) {
    const current = snapshot.transactions.find(record => record.id === target.id);
    if (current?.status === 'conciliado' && current.matchedCfdiId === document.id) return 'Quedó vinculada a este movimiento.';
    if (current?.status === 'ambiguo' && current.candidateCfdiIds?.includes(document.id)) return 'Coincide con este movimiento y con otro. Elige a cuál corresponde.';
    if (linked) return `Se vinculó a «${linked.description}», no a este movimiento.`;
    if (document.tipoComprobante !== 'I') return 'Se guardó, pero sólo una factura se puede vincular a un movimiento.';
    const orientation = invoiceOrientation(document, profileRfc);
    if (target.amount < 0 && orientation === 'issued') return 'Se guardó, pero es una factura que tú emitiste y este movimiento es un pago que hiciste.';
    if (target.amount > 0 && orientation === 'received') return 'Se guardó, pero es una factura que recibiste y este movimiento es un depósito.';
    const comparison = candidateComparison(target, document);
    return `Se guardó, pero no coincide con este movimiento. ${comparison.amount} ${comparison.date}`;
  }
  if (document.tipoComprobante === 'E') return 'Nota de crédito guardada. No cambia tus movimientos.';
  if (document.tipoComprobante === 'P') return 'Comprobante de pago guardado. No cambia tus movimientos.';
  if (document.tipoComprobante !== 'I') return 'Documento guardado.';
  if (linked) return `Vinculada a «${linked.description}».`;
  if (contested.length) return `Coincide con ${contested.length === 1 ? `«${contested[0].description}»` : `${contested.length} movimientos`}: elige si corresponde.`;
  if (!snapshot.transactions.length) return 'Guardada. Sube tu estado de cuenta para encontrar su movimiento.';
  return 'Guardada. Aún no hay un movimiento con el mismo importe y una fecha cercana.';
}

function StateIcon({item}: {item: UploadItem}) {
  const className = 'mt-0.5 h-5 w-5 shrink-0';
  if (item.state === 'working') return <Loader2 aria-hidden="true" className={`${className} animate-spin text-cyan-200`} />;
  if (item.state === 'done') return <CheckCircle2 aria-hidden="true" className={`${className} text-emerald-300`} />;
  if (item.state === 'repeated') return <CheckCircle2 aria-hidden="true" className={`${className} text-slate-400`} />;
  if (item.state === 'error') return <AlertCircle aria-hidden="true" className={`${className} text-rose-300`} />;
  if (item.state === 'skipped') return <MinusCircle aria-hidden="true" className={`${className} text-slate-500`} />;
  if (item.state === 'review') return <ShieldAlert aria-hidden="true" className={`${className} text-amber-200`} />;
  return <CircleDashed aria-hidden="true" className={`${className} text-slate-500`} />;
}

const stateText: Record<ItemState, string> = {waiting: 'En espera', working: 'Procesando', review: 'Revisa antes de guardar', done: 'Guardado', repeated: 'Ya estaba cargado', error: 'No se guardó', skipped: 'No se guardó'};

export function UploadCenter({mode, snapshot, ops, aiEnabled, target, initialFiles, onClose, onOpenDocument, onReviewPending}: {
  mode: 'demo' | 'workspace'; snapshot: WorkspaceSnapshot; ops: UploadOps; aiEnabled: boolean;
  target: BankTransaction | null; initialFiles: File[]; onClose: () => void;
  onOpenDocument: (document: CfdiRecord) => void; onReviewPending: () => void;
}) {
  const demoMode = mode === 'demo';
  const {profile} = snapshot;
  const toItems = (files: File[]): UploadItem[] => files
    .map(file => ({id: crypto.randomUUID(), file, kind: classifyUpload(file), state: 'waiting' as const, title: file.name}))
    .sort((left, right) => uploadOrder[left.kind] - uploadOrder[right.kind]);
  const [items, setItems] = useState<UploadItem[]>(() => toItems(initialFiles));
  const [dragging, setDragging] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const itemsRef = useRef(items);
  const snapshotRef = useRef(snapshot);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

  const commit = (next: UploadItem[]) => { itemsRef.current = next; if (mountedRef.current) setItems(next); };
  const patch = (id: string, changes: Partial<UploadItem>) => commit(itemsRef.current.map(item => item.id === id ? {...item, ...changes} : item));

  const processXml = async (item: UploadItem) => {
    patch(item.id, {state: 'working', detail: 'Leyendo la factura…'});
    try {
      if (item.file.size > MAX_XML_BYTES) throw new Error('El XML supera 2 MB.');
      const text = await item.file.text();
      const parsed = XmlCfdiParser.parse(text, profile.id);
      if (!parsed.success || !parsed.cfdi) throw new Error((parsed.error || 'No es una factura XML válida.').replace(/^Error al importar CFDI:\s*/, ''));
      const document: CfdiRecord = {...parsed.cfdi, rawXml: text};
      const rfc = profile.rfc.trim().toUpperCase();
      const title = `${documentCardLabel(document, rfc)} · ${counterpartName(document, rfc)}`;
      if (document.rfcEmisor !== rfc && document.rfcReceptor !== rfc) {
        throw new Error(`Tu RFC ${rfc} no aparece en esta factura (es de ${document.rfcEmisor} para ${document.rfcReceptor}).${demoMode ? ' En la demo sólo se aceptan facturas del RFC de ejemplo; crea tu cuenta para subir las tuyas.' : ''}`);
      }
      const existing = snapshotRef.current.cfdis.find(record => record.uuidSat && record.uuidSat.toUpperCase() === document.uuidSat.toUpperCase());
      if (existing) { patch(item.id, {state: 'repeated', title, detail: 'Ya estaba cargada.', documentId: existing.id}); return; }
      if (demoMode) document.isEfos = EfosService.checkRfc(document.rfcEmisor).isEfos;
      const after = await ops.addXml(document, text);
      snapshotRef.current = after;
      const saved = after.cfdis.find(record => record.uuidSat.toUpperCase() === document.uuidSat.toUpperCase()) ?? document;
      const alert = demoMode && saved.isEfos ? ' El proveedor tiene una alerta de ejemplo: revísala antes de usarla.' : '';
      patch(item.id, {state: 'done', title, detail: `${documentAmountText(saved)} · ${formatDay(saved.fechaEmision)}. ${describeSavedDocument(saved, after, rfc, target)}${alert}`, documentId: saved.id, invoice: saved.tipoComprobante === 'I'});
    } catch (error) {
      if (isDuplicate(error)) patch(item.id, {state: 'repeated', detail: 'Ya estaba cargada.'});
      else patch(item.id, {state: 'error', detail: error instanceof Error ? error.message : 'No se pudo guardar la factura.'});
    }
  };

  const startCsv = async (item: UploadItem) => {
    patch(item.id, {state: 'working', detail: 'Leyendo el estado de cuenta…'});
    try {
      if (item.file.size > MAX_BANK_CSV_BYTES) throw new Error('El archivo supera 2 MB. Descarga un periodo más corto.');
      const text = decodeBankCsvBytes(new Uint8Array(await item.file.arrayBuffer()));
      const csv = parseBankCsv(text, {userId: profile.id, accountId: BANK_ACCOUNT_ID});
      if (!csv.rows.length) throw new Error(csv.errors[0]?.message ?? 'No encontramos movimientos en el archivo.');
      setReviewError('');
      patch(item.id, {state: 'review', detail: undefined, csv});
    } catch (error) {
      patch(item.id, {state: 'error', detail: error instanceof Error ? error.message : 'No se pudo leer el archivo.'});
    }
  };

  const startDocument = (item: UploadItem) => {
    try { validateDocumentFile(item.file); setReviewError(''); patch(item.id, {state: 'review', detail: undefined}); }
    catch (error) { patch(item.id, {state: 'error', detail: error instanceof Error ? error.message : 'Selecciona un PDF o una foto válida.'}); }
  };

  const pump = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (mountedRef.current && !itemsRef.current.some(item => item.state === 'review')) {
        const next = itemsRef.current.find(item => item.state === 'waiting');
        if (!next) break;
        if (next.kind === 'xml') await processXml(next);
        else if (next.kind === 'csv') await startCsv(next);
        else if (next.kind === 'pdf' || next.kind === 'image') startDocument(next);
        else patch(next.id, {state: 'error', detail: unsupportedUploadMessage(next.kind)});
      }
    } finally { runningRef.current = false; }
  };

  useEffect(() => {
    mountedRef.current = true;
    const timer = setTimeout(() => {
      if (itemsRef.current.length) void pump();
      // A movement's "Subir factura" goes straight to the file picker.
      else if (target) inputRef.current?.click();
    }, 0);
    return () => { clearTimeout(timer); mountedRef.current = false; };
    // The queue starts once per dialog; later files are added by handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    commit([...itemsRef.current, ...toItems(list)]);
    void pump();
  };

  const finishReview = (id: string, changes: Partial<UploadItem>) => {
    setReviewBusy(false); setReviewError('');
    patch(id, {...changes, csv: undefined});
    void pump();
  };

  const confirmCsv = async (item: UploadItem, transactions: BankTransaction[]) => {
    if (reviewBusy) return;
    setReviewBusy(true); setReviewError('');
    const before = snapshotRef.current.transactions.length;
    try {
      const after = await ops.addTransactions(transactions);
      snapshotRef.current = after;
      const added = Math.max(0, after.transactions.length - before);
      const repeated = transactions.length - added;
      const linked = after.transactions.filter(record => record.status === 'conciliado').length;
      if (!added) finishReview(item.id, {state: 'repeated', detail: `Estos ${transactions.length} movimientos ya estaban cargados.`});
      else finishReview(item.id, {state: 'done', saved: added, detail: `${added} ${added === 1 ? 'movimiento nuevo' : 'movimientos nuevos'}${repeated ? ` (${repeated} ya estaban)` : ''}. Ahora ${linked} de ${after.transactions.length} tienen factura.`});
    } catch (error) {
      setReviewBusy(false);
      setReviewError(error instanceof Error ? error.message : 'No se pudieron guardar los movimientos.');
    }
  };

  const saveDocument = async (item: UploadItem, document: CfdiRecord, source: DocumentSource, file: File) => {
    const after = await ops.addProvisional(document, source, file);
    snapshotRef.current = after;
    const saved = after.cfdis.find(record => record.id === document.id) ?? after.cfdis.find(record => !record.uuidSat && record.nombreEmisor === document.nombreEmisor && record.total === document.total);
    finishReview(item.id, {state: 'done', title: `Gasto · ${document.nombreEmisor}`, documentId: saved?.id,
      detail: `${formatMoney(document.total)} · ${formatDay(document.fechaEmision)}. Guardado como gasto sin factura XML.${target ? ' Un ticket no se vincula al movimiento; si tienes su factura XML, súbela.' : ''}`});
  };

  const reviewing = items.find(item => item.state === 'review');
  const working = items.some(item => item.state === 'working');
  const finished = items.length > 0 && items.every(item => !activeStates.includes(item.state));
  const doneCount = (kind: UploadKind[]) => items.filter(item => item.state === 'done' && kind.includes(item.kind)).length;
  const savedMovements = items.reduce((sum, item) => sum + (item.state === 'done' && item.kind === 'csv' ? item.saved ?? 0 : 0), 0);
  const pending = buildHomeSummary(snapshot.transactions, snapshot.cfdis, profile.rfc).pending.length;
  const currentTarget = target ? snapshot.transactions.find(record => record.id === target.id) ?? target : null;
  const processed = items.filter(item => !activeStates.includes(item.state)).length;

  const savedParts = [
    doneCount(['xml']) && (items.every(item => item.kind !== 'xml' || item.state !== 'done' || item.invoice)
      ? `${doneCount(['xml'])} ${doneCount(['xml']) === 1 ? 'factura' : 'facturas'}`
      : `${doneCount(['xml'])} ${doneCount(['xml']) === 1 ? 'documento' : 'documentos'}`),
    savedMovements && `${savedMovements} ${savedMovements === 1 ? 'movimiento' : 'movimientos'}`,
    doneCount(['pdf', 'image']) && `${doneCount(['pdf', 'image'])} ${doneCount(['pdf', 'image']) === 1 ? 'gasto' : 'gastos'}`,
  ].filter(Boolean);

  const dropzone = (compact: boolean) => <div
    onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); addFiles(event.dataTransfer.files); }}
    className={`rounded-2xl border-2 border-dashed text-center transition ${dragging ? 'border-cyan-300 bg-cyan-300/10' : 'border-white/15 bg-[oklch(0.16_0.02_260)]'} ${compact ? 'p-4' : 'p-6 sm:p-8'}`}>
    {!compact && <span className="mx-auto mb-3 inline-flex rounded-2xl bg-cyan-300/10 p-3 text-cyan-200 shadow-glow"><UploadCloud aria-hidden="true" className="h-7 w-7" /></span>}
    {!compact && <p className="font-sora text-lg font-bold text-white">Arrastra aquí tus archivos</p>}
    <div className={`${compact ? '' : 'mt-3'} flex flex-wrap items-center justify-center gap-2`}>
      <button type="button" onClick={() => inputRef.current?.click()} className={compact ? ui.secondary : ui.primary}><UploadCloud aria-hidden="true" className="h-4 w-4" />{compact ? 'Agregar más archivos' : 'Elegir archivos'}</button>
    </div>
    {!compact && <ul className="mt-6 grid grid-cols-1 gap-3 text-left text-sm sm:grid-cols-3">
      <li className="flex gap-2"><FileCode2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" /><span><strong className="block text-white">Facturas XML</strong><span className="text-slate-400">Las que recibes o emites. Puedes subir varias.</span></span></li>
      <li className="flex gap-2"><FileSpreadsheet aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" /><span><strong className="block text-white">Estado de cuenta</strong><span className="text-slate-400">En CSV, descargado de tu banca en línea.</span></span></li>
      <li className="flex gap-2"><FileText aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" /><span><strong className="block text-white">Tickets</strong><span className="text-slate-400">PDF o foto de un gasto sin factura XML.</span></span></li>
    </ul>}
  </div>;

  return <Dialog title={target ? 'Subir la factura de este movimiento' : 'Subir archivos'} onClose={onClose} busy={working || reviewBusy} closeLabel="Cerrar carga de archivos" width="max-w-3xl"
    footer={finished ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p role="status" className="text-sm text-slate-200">{savedParts.length ? `Listo: guardamos ${savedParts.length > 1 ? `${savedParts.slice(0, -1).join(', ')} y ${savedParts.at(-1)}` : savedParts[0]}.` : 'Terminamos de revisar tus archivos.'} {pending ? `${pending} ${pending === 1 ? 'movimiento necesita' : 'movimientos necesitan'} tu atención.` : snapshot.transactions.length ? 'No hay movimientos pendientes.' : ''}</p>
      <div className="flex flex-wrap justify-end gap-2">
        {pending > 0 && !target ? <button type="button" onClick={onReviewPending} className={ui.primary}>Ver pendientes</button> : <button type="button" onClick={onClose} className={ui.primary}>Listo</button>}
      </div>
    </div> : items.length ? <p role="status" className="text-sm text-slate-300">{reviewing ? 'Revisa el archivo para continuar.' : `Procesando ${Math.min(processed + 1, items.length)} de ${items.length}…`}</p> : undefined}>
    <input ref={inputRef} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden" aria-label="Elegir archivos para subir"
      onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
    <div className="space-y-5">
      {currentTarget && <div className={`rounded-xl border p-4 ${currentTarget.status === 'conciliado' ? 'border-emerald-700/60 bg-emerald-950/30' : 'border-cyan-800/60 bg-cyan-950/30'}`}>
        <p className={`flex items-center gap-1.5 text-sm ${currentTarget.status === 'conciliado' ? 'text-emerald-300' : 'text-cyan-200'}`}>{currentTarget.status === 'conciliado' && <CheckCircle2 aria-hidden="true" className="h-4 w-4" />}{currentTarget.status === 'conciliado' ? 'Este movimiento ya tiene factura' : 'Buscamos la factura de este movimiento'}</p>
        <p className="mt-1 break-words font-semibold text-white">{currentTarget.description}</p>
        <p className="text-sm text-slate-300">{formatDay(currentTarget.date)} · {formatSignedMoney(currentTarget.amount, currentTarget.currency)}</p>
      </div>}

      {reviewing?.kind === 'csv' && reviewing.csv && <BankCsvReview key={reviewing.id} fileName={reviewing.file.name} initial={reviewing.csv}
        context={{userId: profile.id, accountId: BANK_ACCOUNT_ID}} busy={reviewBusy} error={reviewError}
        onConfirm={transactions => void confirmCsv(reviewing, transactions)}
        onCancel={() => finishReview(reviewing.id, {state: 'skipped', detail: 'No se guardó ningún movimiento.'})} />}
      {reviewing && (reviewing.kind === 'pdf' || reviewing.kind === 'image') && <DocumentExtraction key={reviewing.id} file={reviewing.file} source={reviewing.kind === 'pdf' ? 'pdf' : 'image'}
        userId={profile.id} rfcReceptor={profile.rfc} demoMode={demoMode} aiEnabled={aiEnabled}
        onSave={(document, source, file) => saveDocument(reviewing, document, source, file)}
        onClose={() => finishReview(reviewing.id, {state: 'skipped', detail: 'Descartado; no se guardó.'})} />}

      {!items.length && dropzone(false)}
      {!items.length && <details className="rounded-xl border border-white/10 p-4 text-sm text-slate-300">
        <summary className="cursor-pointer font-semibold text-white">¿Cómo descargo mi estado de cuenta en CSV?</summary>
        <p className="mt-2">En tu banca en línea busca «Movimientos» y la opción «Exportar» o «Descargar». Elige CSV; si sólo hay Excel, ábrelo y guárdalo como CSV. FacturIA reconoce columnas como fecha, concepto, cargo, abono o importe.</p>
        <p className="mt-2">¿No tienes uno? Usa <a href="/plantilla-movimientos.csv" download className={ui.link}>esta plantilla</a> y escribe tus movimientos.</p>
      </details>}
      {!items.length && demoMode && <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-400">Probar con ejemplos:</span>
        <button type="button" onClick={() => addFiles([demoSampleXml('invoice')])} className={ui.secondary}>Factura de $12,400</button>
        <button type="button" onClick={() => addFiles([demoSampleXml('efos')])} className={ui.secondary}>Factura con alerta</button>
      </div>}

      {items.length > 0 && <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-200">Archivos ({items.length})</h3></div>
        <ul className="space-y-2">{items.map(item => <li key={item.id} className={`flex items-start gap-3 rounded-xl border p-3 ${item.state === 'review' ? 'border-amber-700/60 bg-amber-950/20' : 'border-white/10 bg-[oklch(0.16_0.02_260)]'}`}>
          <StateIcon item={item} />
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-semibold text-white">{item.title}</p>
            <p className={`text-sm ${item.state === 'error' ? 'text-rose-200' : 'text-slate-300'}`}>{item.detail ?? stateText[item.state]}</p>
            {finished && item.documentId && (() => {
              const document = snapshot.cfdis.find(record => record.id === item.documentId);
              return document ? <button type="button" onClick={() => onOpenDocument(document)} className={`${ui.link} mt-1 inline-block`}>Ver documento</button> : null;
            })()}
          </div>
        </li>)}</ul>
        {!reviewing && dropzone(true)}
      </div>}
    </div>
  </Dialog>;
}
