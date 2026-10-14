'use client';

import React from 'react';
import { FileCheck, X, ShieldAlert, CheckCircle2, Copy } from 'lucide-react';
import type { CfdiRecord } from '../lib/types';
import { SatStatusControls, type SatWorkspaceSnapshot } from './SatStatusControls';
import { documentTypeLabel, formatDeclaredAmount } from '../lib/documentSummary';
import { useDialogFocus } from '../lib/useDialogFocus';

interface CfdiDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  cfdi: CfdiRecord | null;
  demoMode?: boolean;
  onSnapshotUpdated?: (snapshot: SatWorkspaceSnapshot) => void;
  documents?: CfdiRecord[];
}

const cardClass = 'rounded-xl border border-[oklch(0.30_0.03_260)] bg-[oklch(0.21_0.025_260)] p-4';
const titleFor = (document: CfdiRecord) => ['manual', 'pdf', 'image'].includes(document.sourceType || '') ? 'Gasto anotado sin factura XML' : ({ I: 'Factura', E: 'Nota de crédito', P: 'Documento de pago', N: 'Documento de nómina', T: 'Documento de traslado' }[document.tipoComprobante]);
const recordedSatState = (document: CfdiRecord) => document.statusSat === 'no_verificado' ? 'Estado SAT sin confirmar' : `Estado registrado: ${document.statusSat}`;

export const CfdiDetailModal: React.FC<CfdiDetailModalProps> = props => props.isOpen && props.cfdi ? <CfdiDetailContent key={props.cfdi.id} {...props} /> : null;

const CfdiDetailContent: React.FC<CfdiDetailModalProps> = ({ isOpen, onClose, cfdi, demoMode = true, onSnapshotUpdated, documents = [] }) => {
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState('');
  const dialogRef = useDialogFocus(isOpen && !!cfdi, onClose);
  if (!isOpen || !cfdi) return null;

  const linkedDocuments = new Map(documents.filter(document => document.userId === cfdi.userId && document.uuidSat).map(document => [document.uuidSat.toUpperCase(), document]));
  const declaredPayment = cfdi.tipoComprobante === 'P' ? cfdi.paymentComplement : undefined;
  const describeRelatedDocument = (uuid: string) => {
    const linked = linkedDocuments.get(uuid.toUpperCase());
    return linked ? `Documento cargado en tu cuenta: ${titleFor(linked)}. ${recordedSatState(linked)}.` : 'Este documento relacionado aún no está cargado en tu cuenta. Puedes agregar su XML para revisarlo.';
  };
  const formatCurrency = (amount: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: cfdi.currency || 'MXN', currencyDisplay: 'code' }).format(amount);
  const copyUuid = async () => {
    try {
      if (!navigator.clipboard) throw new Error('No disponible');
      await navigator.clipboard.writeText(cfdi.uuidSat);
      setCopied(true); setCopyError('');
    } catch { setCopyError('No se pudo copiar. Selecciona el identificador y cópialo manualmente.'); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs">
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="cfdi-detail-title" className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[oklch(0.30_0.03_260)] bg-[oklch(0.18_0.02_260)] shadow-2xl text-[oklch(0.97_0.01_240)]">
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[oklch(0.30_0.03_260)]">
        <div className="flex items-start gap-3 min-w-0"><FileCheck className="w-6 h-6 mt-1 shrink-0 text-[oklch(0.78_0.15_195)]" /><div><h2 id="cfdi-detail-title" className="font-sora text-lg font-bold text-white">{titleFor(cfdi)}</h2><p className="mt-1 text-sm text-slate-300">{cfdi.sourceType === 'manual' ? 'Anotación provisional: conserva los datos del gasto hasta conseguir la factura XML.' : demoMode ? 'Documento de ejemplo para practicar.' : 'Documento guardado en tu cuenta.'}</p></div></div>
        <button type="button" onClick={onClose} aria-label="Cerrar detalle del documento" className="min-w-11 min-h-11 flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-teal-300"><X className="w-5 h-5" /></button>
      </div>

      <div className="p-5 space-y-5 text-sm leading-relaxed">
        <dl className={`${cardClass} grid grid-cols-1 sm:grid-cols-2 gap-4`}>
          <div className="min-w-0"><dt className="text-slate-300">Quién lo emitió</dt><dd className="mt-1 font-semibold text-white break-words">{cfdi.nombreEmisor || cfdi.rfcEmisor}</dd><dd className="font-mono text-sm text-slate-300 break-all">{cfdi.rfcEmisor}</dd></div>
          <div className="min-w-0"><dt className="text-slate-300">Para quién es</dt><dd className="mt-1 font-semibold text-white break-words">{cfdi.nombreReceptor || cfdi.rfcReceptor}</dd><dd className="font-mono text-sm text-slate-300 break-all">{cfdi.rfcReceptor}</dd></div>
          <div className="sm:col-span-2"><dt className="text-slate-300">Fecha que indica el documento</dt><dd className="break-all">{cfdi.fechaEmision.replace('T', ' a las ')}</dd></div>
        </dl>
        {cfdi.conceptos?.[0] && <p className="break-words"><span className="font-semibold text-white">Concepto: </span>{cfdi.conceptos[0].descripcion}</p>}

        {cfdi.tipoComprobante === 'E' && <div className={`${cardClass} space-y-2`}><h3 className="font-semibold text-white">Un ajuste declarado a una factura</h3><p>Esta nota declara un ajuste por {formatCurrency(cfdi.total)}. Revisa qué documento relaciona más abajo. Cargarla no registra una devolución bancaria ni descuenta dinero de tus movimientos.</p></div>}

        {declaredPayment ? <section className={`${cardClass} space-y-4`} aria-labelledby="cfdi-payments-title">
          <h3 id="cfdi-payments-title" className="font-semibold text-base text-white">Pagos que indica este documento</h3>
          <div><p className="text-slate-300">Total declarado en pesos mexicanos (MXN)</p><p className="font-mono text-lg font-semibold text-teal-300 break-all mt-1">{formatDeclaredAmount(declaredPayment.totalPaymentsMxn, 'MXN')}</p></div>
          <p>Estos pagos y saldos corresponden a las fechas indicadas aquí. No muestran cuánto queda pendiente hoy ni el saldo de tu banco. Importar el documento no agrega movimientos de dinero.</p>
          <ol className="space-y-4">{declaredPayment.payments.slice(0, 10).map((payment, paymentIndex) => <li key={paymentIndex} className="rounded-xl border border-slate-600 p-4 space-y-3 min-w-0">
            <h4 className="font-semibold text-white">Pago declarado {paymentIndex + 1}</h4>
            <p className="font-mono text-lg text-teal-300 break-all">{formatDeclaredAmount(payment.amount, payment.currency)}</p>
            <p className="text-slate-300">Fecha del pago: <span className="text-white break-all">{payment.date.replace('T', ' a las ')}</span></p>
            <ul className="space-y-4">{payment.relatedDocuments.slice(0, 10).map((document, documentIndex) => <li key={`${document.uuid}-${documentIndex}`} className="border-l-2 border-slate-600 pl-3 space-y-2">
              <h5 className="font-semibold text-white">Documento al que se aplica este pago</h5>
              <p className="text-slate-300">{describeRelatedDocument(document.uuid)}</p>
              <p className="font-mono text-sm text-teal-300 break-all">{document.uuid}</p>
              <p>Pago parcial número <strong>{document.installment}</strong> · importes en <strong>{document.currency}</strong></p>
              <dl className="space-y-2">
                <div><dt className="text-slate-300">Pendiente antes de este pago, según el documento</dt><dd className="font-mono text-white break-all">{formatDeclaredAmount(document.previousBalance, document.currency)}</dd></div>
                <div><dt className="text-slate-300">Importe aplicado a este documento</dt><dd className="font-mono text-white break-all">{formatDeclaredAmount(document.paidAmount, document.currency)}</dd></div>
                <div><dt className="text-slate-300">Pendiente después de este pago, según el documento</dt><dd className="font-mono text-white break-all">{formatDeclaredAmount(document.remainingBalance, document.currency)}</dd></div>
              </dl>
              {document.equivalence && <details className="text-slate-300"><summary className="min-h-11 cursor-pointer flex items-center">Ver equivalencia de monedas declarada</summary><p className="font-mono break-all">EquivalenciaDR: {document.equivalence}</p><p>Se muestra lo que dice el XML; FacturIA no convierte estos importes.</p></details>}
            </li>)}</ul>
            {payment.relatedDocuments.length > 10 && <p className="text-amber-200">Se muestran diez documentos de {payment.relatedDocuments.length}. Revisa los demás en el XML original.</p>}
            <details className="text-slate-300"><summary className="min-h-11 cursor-pointer flex items-center">Ver datos técnicos de este pago</summary><dl className="space-y-2 mt-2"><div><dt>Forma de pago (FormaDePagoP)</dt><dd className="font-mono">{payment.form}</dd></div>{payment.exchangeRate && <div><dt>Tipo de cambio declarado (TipoCambioP)</dt><dd className="font-mono break-all">{payment.exchangeRate}</dd></div>}</dl></details>
          </li>)}</ol>
          {declaredPayment.payments.length > 10 && <p className="text-amber-200">Se muestran diez pagos de {declaredPayment.payments.length}. Revisa los demás en el XML original.</p>}
        </section> : cfdi.tipoComprobante === 'P' ? <div className={`${cardClass} space-y-2`}><h3 className="font-semibold text-white">Falta el desglose de pagos en este registro</h3><p>Revisa el complemento dentro del XML original. El total cero del comprobante no significa que el pago haya sido de cero.</p></div> : <section className={`${cardClass} space-y-3`} aria-labelledby="cfdi-amount-title">
          <h3 id="cfdi-amount-title" className="font-semibold text-base text-white">Importe que indica el documento</h3>
          <p className="font-mono text-xl font-semibold text-teal-300 break-all">{formatCurrency(cfdi.total)}</p>
          <details><summary className="min-h-11 cursor-pointer text-slate-300 flex items-center">Ver subtotal e impuestos declarados</summary><dl className="mt-3 space-y-2"><div className="flex flex-wrap justify-between gap-2"><dt>Subtotal</dt><dd className="font-mono">{formatCurrency(cfdi.subtotal)}</dd></div>{!!cfdi.descuento && <div className="flex flex-wrap justify-between gap-2"><dt>Descuento declarado</dt><dd className="font-mono">{formatCurrency(cfdi.descuento)}</dd></div>}<div className="flex flex-wrap justify-between gap-2"><dt>IVA declarado</dt><dd className="font-mono">{formatCurrency(cfdi.iva)}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt>Retenciones declaradas</dt><dd className="font-mono">{formatCurrency(cfdi.retenciones)}</dd></div></dl></details>
        </section>}

        {cfdi.relatedCfdis?.length ? <section className={`${cardClass} space-y-3`} aria-labelledby="cfdi-relations-title">
          <h3 id="cfdi-relations-title" className="font-semibold text-base text-white">Documentos que relaciona este XML</h3><p>Son referencias indicadas por quien lo emitió. No vinculan por sí solas movimientos del banco ni confirman el estado del documento relacionado.</p>
          {cfdi.relatedCfdis.slice(0, 10).map((relation, relationIndex) => <div key={relationIndex} className="space-y-2"><ul className="space-y-3">{relation.uuids.slice(0, 20).map((uuid, uuidIndex) => <li key={`${uuid}-${uuidIndex}`} className="border-l-2 border-slate-600 pl-3"><p className="font-mono text-sm text-teal-300 break-all">{uuid}</p><p className="text-slate-300 mt-1">{describeRelatedDocument(uuid)}</p></li>)}</ul><details className="text-slate-300"><summary className="min-h-11 flex items-center cursor-pointer">Ver tipo de relación declarado</summary><p>TipoRelación: <span className="font-mono">{relation.type}</span></p></details>{relation.uuids.length > 20 && <p className="text-amber-200">Se muestran los primeros veinte identificadores de {relation.uuids.length}. Revisa las demás referencias en el XML original.</p>}</div>)}
          {cfdi.relatedCfdis.length > 10 && <p className="text-amber-200">Se muestran diez grupos de relación de {cfdi.relatedCfdis.length}. Revisa los demás en el XML original.</p>}
        </section> : null}

        <section className={`${cardClass} space-y-2`} aria-labelledby="cfdi-identifier-title"><h3 id="cfdi-identifier-title" className="font-semibold text-white">Identificador del documento</h3>{cfdi.uuidSat ? <><p className="text-slate-300">Sirve para identificar este documento y buscarlo en el SAT.</p><p className="font-mono text-sm text-white break-all">{cfdi.uuidSat}</p><button type="button" onClick={() => void copyUuid()} className="min-h-11 flex items-center gap-2 rounded-lg border border-slate-600 px-3 hover:border-teal-300 focus-visible:outline-2 focus-visible:outline-teal-300">{copied ? <CheckCircle2 className="w-4 h-4 text-teal-300" /> : <Copy className="w-4 h-4" />}{copied ? 'Identificador copiado' : 'Copiar identificador'}</button></> : <p className="text-slate-300">Esta anotación no tiene identificador fiscal. Pide la factura XML a quien emitió el comprobante y agrégala cuando la tengas.</p>}{copyError && <p role="alert" className="text-rose-200">{copyError}</p>}</section>
        <SatStatusControls document={cfdi} demoMode={demoMode} onSnapshotUpdated={onSnapshotUpdated} />
        {cfdi.isEfos && <div className="rounded-xl border border-rose-800 bg-rose-950/30 p-4 flex items-start gap-3 text-rose-200"><ShieldAlert className="w-5 h-5 shrink-0 mt-1" /><div><p className="font-semibold">{demoMode ? 'Alerta de proveedor de ejemplo' : 'Alerta registrada sobre el proveedor'}</p><p className="mt-1">{demoMode ? 'La lista de la demo contiene una alerta simulada para practicar.' : 'Se registró una alerta EFOS sobre este emisor. Revisa la consulta y la fuente oficial antes de tomar decisiones fiscales.'}</p></div></div>}
        {!demoMode && cfdi.attachment && <div className={cardClass}><a href={`/api/workspace/documents/${encodeURIComponent(cfdi.id)}/file`} className="inline-flex min-h-11 items-center text-teal-300 underline underline-offset-2">Descargar {cfdi.attachment.source === 'pdf' ? 'PDF' : 'imagen'} original</a><p className="text-slate-300">El archivo original está guardado de forma privada en tu cuenta. Los datos leídos requieren tu revisión.</p></div>}
        <details className={`${cardClass} text-slate-300`}><summary className="min-h-11 flex items-center cursor-pointer font-semibold">Ver datos técnicos del documento</summary><dl className="mt-3 space-y-2"><div><dt>Tipo fiscal</dt><dd>{documentTypeLabel(cfdi)}</dd></div>{cfdi.uuidSat && <div><dt>Nombre fiscal del identificador</dt><dd>Folio fiscal / UUID SAT</dd></div>}{cfdi.metodoPago && <div><dt>Método de pago declarado</dt><dd>{cfdi.metodoPago === 'PUE' ? 'PUE · Pago en una sola exhibición' : 'PPD · Pago en parcialidades o diferido'}</dd></div>}{cfdi.tipoComprobante === 'P' && <><div><dt>Total del comprobante XML</dt><dd className="font-mono break-all">{formatCurrency(cfdi.total)}</dd></div><p>El cero y el código de moneda XXX son campos técnicos de este tipo de XML. El importe del pago se obtiene del complemento, no de este total.</p>{declaredPayment && <p>Versión de pagos: {declaredPayment.version}. El total en MXN proviene del campo MontoTotalPagos declarado; FacturIA no lo calcula convirtiendo monedas.</p>}</>}<div><dt>Fuente</dt><dd>{cfdi.sourceType === 'xml' ? 'Archivo XML importado' : cfdi.sourceType === 'manual' ? 'Captura provisional revisada por el usuario' : 'Datos cargados'}</dd></div></dl></details>
      </div>
      <div className="px-5 py-4 border-t border-[oklch(0.30_0.03_260)] flex justify-end"><button type="button" onClick={onClose} className="min-h-11 rounded-lg bg-slate-700 hover:bg-slate-600 px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-teal-300">Cerrar documento</button></div>
    </div>
  </div>;
};
