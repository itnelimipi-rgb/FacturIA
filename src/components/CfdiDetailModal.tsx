'use client';

import React from 'react';
import { CfdiRecord } from '../lib/types';
import { FileCheck, X, ShieldAlert, CheckCircle2, Copy } from 'lucide-react';
import { SatStatusControls, type SatWorkspaceSnapshot } from './SatStatusControls';
import { documentTypeLabel, formatDeclaredAmount } from '../lib/documentSummary';

interface CfdiDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  cfdi: CfdiRecord | null;
  demoMode?: boolean;
  onSnapshotUpdated?: (snapshot: SatWorkspaceSnapshot) => void;
  documents?: CfdiRecord[];
}

export const CfdiDetailModal: React.FC<CfdiDetailModalProps> = props => props.isOpen && props.cfdi ? <CfdiDetailContent key={props.cfdi.id} {...props} /> : null;

const CfdiDetailContent: React.FC<CfdiDetailModalProps> = ({ isOpen, onClose, cfdi, demoMode = true, onSnapshotUpdated, documents = [] }) => {
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState('');
  if (!isOpen || !cfdi) return null;
  const linkedDocuments = new Map(documents.filter(document => document.userId === cfdi.userId && document.uuidSat).map(document => [document.uuidSat.toUpperCase(), document]));
  const declaredPayment = cfdi.tipoComprobante === 'P' ? cfdi.paymentComplement : undefined;
  const describeRelatedDocument = (uuid: string) => {
    const linked = linkedDocuments.get(uuid.toUpperCase());
    return linked ? `Registrado en tu cuenta: ${documentTypeLabel(linked)} · ${linked.statusSat === 'no_verificado' ? 'vigencia SAT sin verificar' : `estado registrado: ${linked.statusSat}`}` : 'UUID declarado en el XML; su comprobante no está cargado en esta cuenta.';
  };
  const copyUuid = async () => {
    try {
      if (!navigator.clipboard) throw new Error('El navegador no permite copiar el UUID.');
      await navigator.clipboard.writeText(cfdi.uuidSat);
      setCopied(true);
      setCopyError('');
    } catch {
      setCopyError('No se pudo copiar. Selecciona el UUID y cópialo manualmente.');
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: cfdi.currency || 'MXN',
      currencyDisplay: 'code'
    }).format(val);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fade-in">
      <div role="dialog" aria-modal="true" aria-labelledby="cfdi-detail-title" className="bg-[oklch(0.18_0.02_260)] rounded-2xl border border-[oklch(0.30_0.03_260)] shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto text-[oklch(0.97_0.01_240)]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[oklch(0.30_0.03_260)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-2 rounded-xl bg-[oklch(0.78_0.15_195/0.14)] text-[oklch(0.78_0.15_195)]">
              <FileCheck className="w-5 h-5" />
            </span>
            <div>
              <h3 id="cfdi-detail-title" className="font-sora text-sm font-bold text-white">
                {documentTypeLabel(cfdi)}
              </h3>
              <p className="text-xs text-[oklch(0.68_0.03_250)]">{cfdi.sourceType === 'manual' ? 'Captura manual; no emite un CFDI' : cfdi.statusSat === 'no_verificado' ? 'XML importado; vigencia SAT sin verificar' : `Estado registrado: ${cfdi.statusSat}`}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar detalle del comprobante"
            className="p-1 shrink-0 rounded-lg text-[oklch(0.68_0.03_250)] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alerta si es EFOS */}
        {cfdi.isEfos && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-200 text-xs flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <strong className="font-sora">ALERTA EFOS REGISTRADA:</strong>
              <p className="mt-0.5">
                El RFC {cfdi.rfcEmisor} fue marcado con una alerta EFOS. {demoMode ? 'En la demostración se usa una lista de ejemplo; revisa la fuente oficial antes de tomar decisiones fiscales.' : 'Revisa la consulta registrada y la fuente oficial antes de tomar decisiones fiscales.'}
              </p>
            </div>
          </div>
        )}

        {/* Contenido */}
        <div className="p-6 space-y-4">
          <SatStatusControls document={cfdi} demoMode={demoMode} onSnapshotUpdated={onSnapshotUpdated} />
          {!demoMode && cfdi.attachment && <div className="p-3.5 rounded-xl border border-[oklch(0.30_0.03_260)] bg-[oklch(0.21_0.025_260)] text-xs space-y-1">
            <a href={`/api/workspace/documents/${encodeURIComponent(cfdi.id)}/file`} className="text-[oklch(0.78_0.15_195)] underline underline-offset-2">Descargar archivo original {cfdi.attachment.source === 'pdf' ? 'PDF' : 'de imagen'}</a>
            <p className="text-[oklch(0.68_0.03_250)]">{(cfdi.attachment.bytes / 1024).toFixed(1)} KiB. Guardado en tu cuenta; la lectura OCR requiere revisar los datos capturados.</p>
          </div>}
          {/* UUID SAT */}
          <div className="p-3.5 rounded-xl bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)]">
            <div className="text-[10px] font-semibold uppercase text-[oklch(0.68_0.03_250)]">
              Folio Fiscal (UUID SAT)
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <span className="font-mono text-xs font-bold text-white break-all">
                {cfdi.uuidSat || 'Sin UUID fiscal. Registro provisional pendiente de CFDI.'}
              </span>
              <button
                type="button"
                onClick={() => void copyUuid()}
                disabled={!cfdi.uuidSat}
                className="p-1.5 rounded-md hover:bg-[oklch(0.24_0.028_260)] text-[oklch(0.68_0.03_250)] hover:text-white"
                title="Copiar UUID"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-[oklch(0.72_0.17_155)]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            {copyError && <p role="alert" className="text-xs text-rose-300 mt-2">{copyError}</p>}
          </div>

          {/* Emisor y Receptor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0 p-3 rounded-xl bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)]">
              <div className="text-[10px] font-semibold uppercase text-[oklch(0.68_0.03_250)]">Emisor</div>
              <div className="font-mono text-xs font-bold text-[oklch(0.78_0.15_195)] mt-0.5 break-all">
                {cfdi.rfcEmisor}
              </div>
              <div className="text-[11px] text-[oklch(0.68_0.03_250)] truncate mt-0.5">
                {cfdi.nombreEmisor || 'N/A'}
              </div>
            </div>
            <div className="min-w-0 p-3 rounded-xl bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)]">
              <div className="text-[10px] font-semibold uppercase text-[oklch(0.68_0.03_250)]">Receptor</div>
              <div className="font-mono text-xs font-bold text-white mt-0.5 break-all">
                {cfdi.rfcReceptor}
              </div>
              <div className="text-[11px] text-[oklch(0.68_0.03_250)] truncate mt-0.5">
                {cfdi.nombreReceptor || 'N/A'}
              </div>
            </div>
          </div>

          <dl className="text-xs rounded-xl border border-[oklch(0.30_0.03_260)] p-3.5 space-y-2">
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-[oklch(0.68_0.03_250)]">Fecha de emisión declarada</dt><dd className="font-mono break-all">{cfdi.fechaEmision}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-[oklch(0.68_0.03_250)]">Moneda del comprobante</dt><dd>{cfdi.currency || 'MXN'}{cfdi.currency === 'XXX' ? ' · sin moneda monetaria' : ''}</dd></div>
            {cfdi.metodoPago && <div className="flex flex-wrap justify-between gap-2"><dt className="text-[oklch(0.68_0.03_250)]">Método de pago declarado</dt><dd>{cfdi.metodoPago === 'PUE' ? 'PUE · Pago en una sola exhibición' : 'PPD · Pago en parcialidades o diferido'}</dd></div>}
          </dl>

          {/* Desglose Matemático Determinista */}
          {cfdi.tipoComprobante === 'P' ? <div className="p-4 rounded-xl bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] text-xs space-y-2"><p className="text-white font-semibold">Total declarado en el XML del comprobante P</p><p className="font-mono break-all">{formatCurrency(cfdi.total)}</p><p className="text-[oklch(0.68_0.03_250)]">El total cero y la moneda XXX de este comprobante no son el monto del pago. {declaredPayment ? 'Los importes del complemento se muestran a continuación.' : 'Este registro no contiene el desglose del complemento; revisa su XML original.'}</p></div> : <div className="p-4 rounded-xl bg-[oklch(0.21_0.025_260)] border border-[oklch(0.30_0.03_260)] space-y-2">
            <div className="text-[11px] font-semibold uppercase text-[oklch(0.68_0.03_250)] mb-1">
              Importes registrados
            </div>
            <div className="flex justify-between text-xs text-[oklch(0.90_0.01_240)]">
              <span>Subtotal</span>
              <span className="font-mono">{formatCurrency(cfdi.subtotal)}</span>
            </div>
            {!!cfdi.descuento && <div className="flex justify-between text-xs text-[oklch(0.90_0.01_240)]"><span>Descuento declarado</span><span className="font-mono">-{formatCurrency(cfdi.descuento)}</span></div>}
            <div className="flex justify-between text-xs text-[oklch(0.90_0.01_240)]">
              <span>IVA declarado</span>
              <span className="font-mono">{formatCurrency(cfdi.iva)}</span>
            </div>
            {cfdi.retenciones > 0 && (
              <div className="flex justify-between text-xs text-amber-400 font-medium">
                <span>Retenciones declaradas</span>
                <span className="font-mono">-{formatCurrency(cfdi.retenciones)}</span>
              </div>
            )}
            <div className="pt-2 border-t border-[oklch(0.30_0.03_260)] flex justify-between text-sm font-bold text-white">
              <span>Total Comprobante</span>
              <span className="font-mono text-[oklch(0.78_0.15_195)]">{formatCurrency(cfdi.total)}</span>
            </div>
          </div>}

          {cfdi.relatedCfdis && cfdi.relatedCfdis.length > 0 && <section className="p-3.5 rounded-xl border border-[oklch(0.30_0.03_260)] text-xs space-y-3" aria-labelledby="cfdi-relations-title">
            <h4 id="cfdi-relations-title" className="font-semibold text-white">CFDI relacionados declarados</h4>
            <p className="text-[oklch(0.68_0.03_250)]">Estas referencias documentales no vinculan movimientos bancarios ni modifican importes o vigencia.</p>
            {cfdi.relatedCfdis.slice(0, 10).map((relation, relationIndex) => <div key={relationIndex} className="space-y-2"><p className="text-white">Tipo de relación declarado: <span className="font-mono">{relation.type}</span></p><ul className="space-y-2">{relation.uuids.slice(0, 20).map((uuid, uuidIndex) => <li key={`${uuid}-${uuidIndex}`} className="border-l-2 border-[oklch(0.30_0.03_260)] pl-2"><p className="font-mono break-all text-[oklch(0.78_0.15_195)]">{uuid}</p><p className="text-[oklch(0.68_0.03_250)] mt-1">{describeRelatedDocument(uuid)}</p></li>)}</ul>{relation.uuids.length > 20 && <p className="text-amber-300">Se muestran los primeros veinte UUID de {relation.uuids.length}. Revisa las demás referencias en el XML original.</p>}</div>)}
            {cfdi.relatedCfdis.length > 10 && <p className="text-amber-300">Se muestran diez grupos de relación de {cfdi.relatedCfdis.length}. Revisa los demás en el XML original.</p>}
          </section>}

          {declaredPayment && <section className="p-3.5 rounded-xl border border-[oklch(0.30_0.03_260)] text-xs space-y-3" aria-labelledby="cfdi-payments-title">
            <h4 id="cfdi-payments-title" className="font-semibold text-white">Complemento de pagos {declaredPayment.version} · datos declarados</h4>
            <div><p className="text-[oklch(0.68_0.03_250)]">MontoTotalPagos declarado en MXN</p><p className="font-mono text-[oklch(0.78_0.15_195)] mt-1 break-all">{formatDeclaredAmount(declaredPayment.totalPaymentsMxn, 'MXN')}</p></div>
            <p className="text-[oklch(0.68_0.03_250)]">Los importes, tipos de cambio y saldos pertenecen a este XML. No se convierten monedas ni se calcula un saldo actual; importar este complemento no crea cobros, cargos o conciliaciones.</p>
            <ol className="space-y-3">{declaredPayment.payments.slice(0, 10).map((payment, paymentIndex) => <li key={paymentIndex} className="p-3 rounded-xl bg-[oklch(0.21_0.025_260)] space-y-2 min-w-0"><h5 className="font-semibold text-white">Pago declarado {paymentIndex + 1}</h5><dl className="space-y-1">
              <div><dt className="text-[oklch(0.68_0.03_250)]">FechaPago</dt><dd className="font-mono break-all">{payment.date}</dd></div>
              <div><dt className="text-[oklch(0.68_0.03_250)]">Monto y MonedaP</dt><dd className="font-mono break-all">{formatDeclaredAmount(payment.amount, payment.currency)}</dd></div>
              <div><dt className="text-[oklch(0.68_0.03_250)]">FormaDePagoP declarada</dt><dd className="font-mono">{payment.form}</dd></div>
              {payment.exchangeRate && <div><dt className="text-[oklch(0.68_0.03_250)]">TipoCambioP declarado</dt><dd className="font-mono break-all">{payment.exchangeRate}</dd></div>}
            </dl><h6 className="font-semibold text-white pt-1">Documentos relacionados del pago</h6><ul className="space-y-3">{payment.relatedDocuments.slice(0, 10).map((document, documentIndex) => <li key={`${document.uuid}-${documentIndex}`} className="pl-2 border-l-2 border-[oklch(0.30_0.03_260)] space-y-2"><p className="font-mono break-all text-[oklch(0.78_0.15_195)]">{document.uuid}</p><p className="text-[oklch(0.68_0.03_250)]">{describeRelatedDocument(document.uuid)}</p><dl className="space-y-1">
              <div><dt className="text-[oklch(0.68_0.03_250)]">MonedaDR y parcialidad declarada</dt><dd className="font-mono">{document.currency} · {document.installment}</dd></div>
              <div><dt className="text-[oklch(0.68_0.03_250)]">Saldo anterior declarado (ImpSaldoAnt)</dt><dd className="font-mono break-all">{formatDeclaredAmount(document.previousBalance, document.currency)}</dd></div>
              <div><dt className="text-[oklch(0.68_0.03_250)]">Importe pagado declarado (ImpPagado)</dt><dd className="font-mono break-all">{formatDeclaredAmount(document.paidAmount, document.currency)}</dd></div>
              <div><dt className="text-[oklch(0.68_0.03_250)]">Saldo insoluto declarado (ImpSaldoInsoluto)</dt><dd className="font-mono break-all">{formatDeclaredAmount(document.remainingBalance, document.currency)}</dd></div>
              {document.equivalence && <div><dt className="text-[oklch(0.68_0.03_250)]">EquivalenciaDR declarada</dt><dd className="font-mono break-all">{document.equivalence}</dd></div>}
            </dl></li>)}</ul>{payment.relatedDocuments.length > 10 && <p className="text-amber-300">Se muestran diez documentos de {payment.relatedDocuments.length}. Revisa los demás en el XML original.</p>}</li>)}</ol>
            {declaredPayment.payments.length > 10 && <p className="text-amber-300">Se muestran diez pagos de {declaredPayment.payments.length}. Revisa los demás en el XML original.</p>}
          </section>}

          {/* Conceptos */}
          {cfdi.conceptos && cfdi.conceptos.length > 0 && (
            <div className="text-xs text-[oklch(0.68_0.03_250)]">
              <span className="font-semibold text-white">Concepto principal: </span>
              {cfdi.conceptos[0].descripcion}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[oklch(0.21_0.025_260)] border-t border-[oklch(0.30_0.03_260)] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[oklch(0.24_0.028_260)] hover:bg-[oklch(0.30_0.03_260)] text-white transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
