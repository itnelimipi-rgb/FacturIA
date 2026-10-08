'use client';

import React, { useState } from 'react';
import { BankTransaction, CfdiRecord, ReconciliationStatus } from '../lib/types';
import {
  CheckCircle2,
  HelpCircle,
  AlertOctagon,
  ArrowUpRight,
  ArrowDownLeft,
  FileCheck2,
  ExternalLink,
  ShieldAlert,
  Unlink,
  Search,
  Plus
} from 'lucide-react';

interface TreasuryInboxProps {
  transactions: BankTransaction[];
  cfdis: CfdiRecord[];
  onOpenResolver: (tx: BankTransaction) => void;
  onOpenCfdiDetail: (cfdi: CfdiRecord) => void;
  onUnmatch: (txId: string) => void;
  onResumeReconciliation?: (txId: string) => void | Promise<void>;
  onRequestUploadForDiscrepancy: (tx: BankTransaction) => void;
  onOpenRegisterModal?: () => void;
}

export const TreasuryInbox: React.FC<TreasuryInboxProps> = ({
  transactions,
  cfdis,
  onOpenResolver,
  onOpenCfdiDetail,
  onUnmatch,
  onResumeReconciliation,
  onRequestUploadForDiscrepancy,
  onOpenRegisterModal
}) => {
  const [activeTab, setActiveTab] = useState<'all' | ReconciliationStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingResumeId, setPendingResumeId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState('');

  const resumeReconciliation = async (transactionId: string) => {
    if (!onResumeReconciliation || pendingResumeId) return;
    setPendingResumeId(transactionId);
    setResumeError('');
    try {
      await onResumeReconciliation(transactionId);
    } catch (error) {
      setResumeError(error instanceof Error ? error.message : 'No se pudo reactivar la búsqueda. Intenta nuevamente.');
    } finally {
      setPendingResumeId(null);
    }
  };

  const cfdiMap = new Map<string, CfdiRecord>(cfdis.map((c) => [c.id, c]));

  const conciliados = transactions.filter((t) => t.status === 'conciliado');
  const ambiguos = transactions.filter((t) => t.status === 'ambiguo');
  const discrepancias = transactions.filter((t) => t.status === 'discrepancia');

  const filteredTransactions = transactions
    .filter((t) => (activeTab === 'all' ? true : t.status === activeTab))
    .filter((t) => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        t.description.toLowerCase().includes(term) ||
        t.amount.toString().includes(term) ||
        t.date.includes(term) ||
        (t.matchedCfdiId && cfdiMap.get(t.matchedCfdiId)?.rfcEmisor.toLowerCase().includes(term))
      );
    });

  const formatCurrency = (val: number, currency: string) => {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2
    }).format(Math.abs(val));
  };

  return (
    <div className="w-full space-y-4">
      {resumeError && <p role="alert" className="text-xs text-rose-300 rounded-xl border border-rose-800 bg-rose-950/30 p-3">{resumeError}</p>}
      {/* Barra de Acciones y Pestañas */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[oklch(0.30_0.03_260)] pb-4">
        {/* Pestañas de Estados */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none bg-[oklch(0.18_0.02_260)] p-1 rounded-xl border border-[oklch(0.30_0.03_260)]">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'all'
                ? 'bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] shadow-xs'
                : 'text-[oklch(0.68_0.03_250)] hover:text-white'
            }`}
          >
            Todos
            <span className="text-[10px] opacity-80">({transactions.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('conciliado')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'conciliado'
                ? 'bg-[oklch(0.72_0.17_155)] text-[oklch(0.12_0.03_165)] shadow-xs'
                : 'text-[oklch(0.72_0.17_155)] hover:bg-[oklch(0.72_0.17_155/0.1)]'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Conciliados
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 font-mono font-bold">
              {conciliados.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('ambiguo')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'ambiguo'
                ? 'bg-[oklch(0.80_0.16_75)] text-black shadow-xs'
                : 'text-[oklch(0.80_0.16_75)] hover:bg-[oklch(0.80_0.16_75/0.1)]'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            Ambiguos
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 font-mono font-bold">
              {ambiguos.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('discrepancia')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'discrepancia'
                ? 'bg-[oklch(0.65_0.22_25)] text-white shadow-xs'
                : 'text-rose-400 hover:bg-rose-950/40'
            }`}
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            Discrepancias
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 font-mono font-bold">
              {discrepancias.length}
            </span>
          </button>
        </div>

        {/* Buscador + Botón Registrar */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-60">
            <Search className="w-3.5 h-3.5 text-[oklch(0.68_0.03_250)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar concepto o monto..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-[oklch(0.30_0.03_260)] bg-[oklch(0.21_0.025_260)] text-white placeholder:text-[oklch(0.68_0.03_250)] focus:outline-hidden focus:border-[oklch(0.78_0.15_195)]"
            />
          </div>

          {onOpenRegisterModal && (
            <button
              onClick={onOpenRegisterModal}
              className="px-3 py-1.5 rounded-xl bg-linear-to-r from-[oklch(0.78_0.15_195)] to-[oklch(0.65_0.20_295)] text-[oklch(0.15_0.03_260)] text-xs font-bold font-sora shadow-glow flex items-center gap-1.5 hover:brightness-105 transition-all shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Registrar gasto</span>
            </button>
          )}
        </div>
      </div>

      {/* Lista Dinámica de Movimientos */}
      <div className="space-y-3">
        {filteredTransactions.length === 0 ? (
          <div className="p-10 text-center rounded-2xl border border-dashed border-[oklch(0.30_0.03_260)] bg-[oklch(0.18_0.02_260)] text-[oklch(0.68_0.03_250)] text-xs">
            No hay movimientos en este criterio
          </div>
        ) : (
          filteredTransactions.map((tx) => {
            const isIncome = tx.amount > 0;
            const matchedCfdi = tx.matchedCfdiId ? cfdiMap.get(tx.matchedCfdiId) : null;

            return (
              <div
                key={tx.id}
                className={`p-4 rounded-2xl border transition-all ${
                  tx.status === 'conciliado'
                    ? 'bg-[oklch(0.21_0.025_260)] border-[oklch(0.30_0.03_260)] hover:border-[oklch(0.72_0.17_155/0.4)]'
                    : tx.status === 'ambiguo'
                    ? 'bg-[oklch(0.80_0.16_75/0.05)] border-[oklch(0.80_0.16_75/0.3)] hover:border-[oklch(0.80_0.16_75/0.6)]'
                    : 'bg-[oklch(0.65_0.22_25/0.06)] border-[oklch(0.65_0.22_25/0.3)] hover:border-[oklch(0.65_0.22_25/0.6)]'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  {/* Icono y Detalles */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div
                      className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                        tx.status === 'conciliado'
                          ? 'bg-[oklch(0.72_0.17_155/0.15)] text-[oklch(0.72_0.17_155)]'
                          : tx.status === 'ambiguo'
                          ? 'bg-[oklch(0.80_0.16_75/0.15)] text-[oklch(0.80_0.16_75)]'
                          : 'bg-[oklch(0.65_0.22_25/0.15)] text-rose-400'
                      }`}
                    >
                      {tx.status === 'conciliado' ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : tx.status === 'ambiguo' ? (
                        <HelpCircle className="w-5 h-5" />
                      ) : (
                        <AlertOctagon className="w-5 h-5" />
                      )}
                    </div>

                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-white">
                          {tx.description}
                        </span>

                        {tx.status === 'conciliado' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[oklch(0.72_0.17_155/0.15)] text-[oklch(0.72_0.17_155)] border border-[oklch(0.72_0.17_155/0.3)]">
                            🟢 Conciliado
                          </span>
                        )}
                        {tx.status === 'ambiguo' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[oklch(0.80_0.16_75/0.15)] text-[oklch(0.80_0.16_75)] border border-[oklch(0.80_0.16_75/0.3)] animate-pulse">
                            🟡 Ambiguo ({tx.candidateCfdiIds?.length || 0} candidatos)
                          </span>
                        )}
                        {tx.status === 'discrepancia' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-950/60 text-rose-300 border border-rose-800">
                            🔴 Discrepancia
                          </span>
                        )}
                      </div>

                      {/* Metadatos bancarios */}
                      <div className="flex items-center gap-2 text-xs text-[oklch(0.68_0.03_250)]">
                        <span className="font-mono text-[11px]">{tx.date}</span>
                        <span>•</span>
                        <span className="font-mono text-[11px] text-[oklch(0.78_0.15_195)]">
                          {tx.accountId}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-0.5">
                          {isIncome ? (
                            <span className="text-[oklch(0.72_0.17_155)] flex items-center font-medium">
                              <ArrowDownLeft className="w-3 h-3" /> Cobro / Depósito
                            </span>
                          ) : (
                            <span className="text-[oklch(0.68_0.03_250)] flex items-center">
                              <ArrowUpRight className="w-3 h-3" /> Pago / Cargo
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Alerta de Discrepancia */}
                      {tx.status === 'discrepancia' && (
                        <div className="text-xs text-rose-300 flex items-center gap-1.5 pt-1">
                          <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                          <span>
                            {tx.alertReason || 'Pendiente de vincular con un comprobante fiscal.'}
                          </span>
                        </div>
                      )}

                      {/* Match Conciliado */}
                      {tx.reconciliationLocked && <p className="text-xs text-amber-300 pt-1">Pendiente de revisión manual · búsqueda automática pausada.</p>}
                      {tx.status === 'conciliado' && matchedCfdi && (
                        <div className="flex items-center gap-2 pt-1 flex-wrap">
                          <button
                            type="button"
                            onClick={() => onOpenCfdiDetail(matchedCfdi)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[oklch(0.18_0.02_260)] border border-[oklch(0.30_0.03_260)] hover:border-[oklch(0.78_0.15_195)] text-white transition-colors"
                          >
                            <FileCheck2 className="w-3.5 h-3.5 text-[oklch(0.72_0.17_155)]" />
                            <span className="font-mono text-[11px]">
                              UUID: {matchedCfdi.uuidSat.slice(0, 18)}...
                            </span>
                            <span className="text-[10px] text-[oklch(0.68_0.03_250)]">
                              ({matchedCfdi.nombreEmisor?.slice(0, 20) || matchedCfdi.rfcEmisor})
                            </span>
                            <ExternalLink className="w-3 h-3 text-[oklch(0.68_0.03_250)]" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onUnmatch(tx.id)}
                            title="Desvincular para reclasificar"
                            className="text-[11px] text-[oklch(0.68_0.03_250)] hover:text-rose-400 flex items-center gap-1 p-1 transition-colors"
                          >
                            <Unlink className="w-3 h-3" /> Desvincular
                          </button>
                          {matchedCfdi.statusSat === 'no_verificado' && <span className="text-[10px] text-amber-300">Vigencia SAT sin verificar</span>}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Monto y Botones de Acción */}
                  <div className="flex sm:flex-col items-end justify-between sm:justify-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[oklch(0.30_0.03_260)]">
                    <div
                      className={`font-mono text-base sm:text-lg font-bold ${
                        isIncome ? 'text-[oklch(0.72_0.17_155)]' : 'text-white'
                      }`}
                    >
                      {isIncome ? '+' : '-'}{formatCurrency(tx.amount, tx.currency)}
                    </div>

                    {tx.status === 'ambiguo' && (
                      <button
                        type="button"
                        onClick={() => onOpenResolver(tx)}
                        className="px-3.5 py-1.5 text-xs font-sora font-bold rounded-xl bg-[oklch(0.80_0.16_75)] text-black shadow-xs hover:brightness-105 transition-all flex items-center gap-1.5"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        Revisar candidatos
                      </button>
                    )}

                    {tx.reconciliationLocked && onResumeReconciliation && (
                      <button
                        type="button"
                        disabled={pendingResumeId !== null}
                        aria-busy={pendingResumeId === tx.id}
                        onClick={() => void resumeReconciliation(tx.id)}
                        className="px-3 py-1.5 text-xs font-medium rounded-xl bg-[oklch(0.78_0.15_195/0.12)] hover:bg-[oklch(0.78_0.15_195/0.2)] border border-[oklch(0.78_0.15_195/0.35)] text-[oklch(0.78_0.15_195)] transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Search className="w-3.5 h-3.5" />
                        {pendingResumeId === tx.id ? 'Buscando…' : 'Buscar coincidencias'}
                      </button>
                    )}
                    {tx.status === 'discrepancia' && !tx.reconciliationLocked && (
                      <button
                        type="button"
                        onClick={() => onRequestUploadForDiscrepancy(tx)}
                        className="px-3 py-1.5 text-xs font-medium rounded-xl bg-rose-900/50 hover:bg-rose-900 border border-rose-800 text-rose-200 transition-colors flex items-center gap-1"
                      >
                        Vincular CFDI
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <section className="pt-4 border-t border-[oklch(0.30_0.03_260)]">
        <h2 className="font-sora font-bold text-sm text-white mb-3">Comprobantes registrados ({cfdis.length})</h2>
        {cfdis.length === 0 ? <p className="text-xs text-[oklch(0.68_0.03_250)]">Carga un XML o registra un gasto provisional para comenzar.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {cfdis.map(record => <button key={record.id} type="button" onClick={() => onOpenCfdiDetail(record)} className="text-left p-3 rounded-xl border border-[oklch(0.30_0.03_260)] bg-[oklch(0.18_0.02_260)] hover:border-[oklch(0.78_0.15_195)] transition-colors flex gap-3">
              <FileCheck2 className="w-4 h-4 text-[oklch(0.78_0.15_195)] shrink-0 mt-1" />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-xs font-semibold text-white truncate">{record.nombreEmisor || record.rfcEmisor}</span>
                <span className="block font-mono text-[11px] text-[oklch(0.68_0.03_250)] break-all">{record.uuidSat || 'Gasto provisional · sin UUID fiscal'}</span>
                <span className="block text-xs text-white">{formatCurrency(record.total, record.currency || 'MXN')}</span>
                <span className={`block text-[10px] ${record.statusSat === 'cancelado' ? 'text-rose-300' : 'text-amber-300'}`}>{record.sourceType === 'manual' ? 'Registro manual pendiente de CFDI' : record.statusSat === 'no_verificado' ? 'Vigencia SAT sin verificar' : record.statusSat === 'cancelado' ? 'Marcado como cancelado' : 'Marcado como vigente'}</span>
              </span>
              <ExternalLink className="w-3 h-3 text-[oklch(0.68_0.03_250)] shrink-0 mt-1" />
            </button>)}
          </div>
        )}
      </section>
    </div>
  );
};
