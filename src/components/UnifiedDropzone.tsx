'use client';

import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileCode2, FileText, Image as ImageIcon, CheckCircle2, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { XmlCfdiParser } from '../lib/xmlParser';
import { EfosService } from '../lib/efosService';
import { CfdiRecord } from '../lib/types';
import { DocumentExtraction } from './DocumentExtraction';
import { validateDocumentFile } from '../lib/documentExtraction';
import type { DocumentSource } from '../lib/documentExtraction';
import type { ProvisionalDocumentHandler } from './DocumentExtraction';
import { formatDeclaredAmount } from '../lib/documentSummary';

interface UnifiedDropzoneProps {
  userId: string;
  rfcReceptor: string;
  demoMode?: boolean;
  onCfdiAdded: (cfdi: CfdiRecord, source: 'xml' | 'pdf' | 'image' | 'manual') => void | Promise<void>;
  onProvisionalAdded?: ProvisionalDocumentHandler;
  onCfdiOpened?: (document: CfdiRecord) => void;
}

export function describeImportedXml(document: CfdiRecord, demoMode: boolean): {title: string; detail: string} {
  const stored = demoMode ? 'Agregado a los ejemplos de este navegador.' : 'Guardado en tu cuenta.';
  const amount = document.tipoComprobante === 'P'
    ? document.paymentComplement ? `Pagos declarados en el documento: ${formatDeclaredAmount(document.paymentComplement.totalPaymentsMxn, 'MXN')}.` : 'Consulta los importes del pago en el complemento del XML; el total cero del comprobante no es el monto del pago.'
    : `Importe declarado: ${document.total.toFixed(2)} ${document.currency || 'MXN'}.`;
  return {title: document.tipoComprobante === 'P' ? 'Documento de pago guardado' : 'Documento XML guardado', detail: `${stored} ${amount} Guardarlo no confirma su estado en el SAT. Abre el documento para revisar sus datos y las opciones de consulta.`};
}

export const UnifiedDropzone: React.FC<UnifiedDropzoneProps> = ({ userId, rfcReceptor, demoMode = false, onCfdiAdded, onProvisionalAdded, onCfdiOpened }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [extractionFile, setExtractionFile] = useState<{file: File; source: DocumentSource} | null>(null);
  const busy = isReading || extractionFile !== null;
  const [lastNotification, setLastNotification] = useState<{ type: 'success' | 'warning' | 'error'; title: string; detail: string; document?: CfdiRecord } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current++; }, []);

  const processXmlFile = async (file: File) => {
    if (busy) return;
    const currentRequest = ++requestId.current;
    setIsReading(true);
    setLastNotification(null);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('El XML supera el límite de 2 MB.');
      const text = await file.text();
      if (currentRequest !== requestId.current) return;
      const result = XmlCfdiParser.parse(text, userId);
      if (!result.success || !result.cfdi) throw new Error(result.error || 'El archivo no contiene un CFDI válido.');
      result.cfdi.rawXml = text;
      const demoEfos = demoMode && EfosService.checkRfc(result.cfdi.rfcEmisor).isEfos;
      if (demoEfos) result.cfdi.isEfos = true;
      await onCfdiAdded(result.cfdi, 'xml');
      if (currentRequest !== requestId.current) return;
      setLastNotification({
        type: demoEfos ? 'warning' : 'success',
        title: demoEfos ? 'Documento guardado con una alerta de ejemplo' : describeImportedXml(result.cfdi, demoMode).title,
        detail: demoEfos
          ? 'Agregado a los ejemplos de este navegador. Este proveedor tiene una alerta simulada en la demo; no es una respuesta del SAT.'
          : describeImportedXml(result.cfdi, demoMode).detail,
        document: result.cfdi,
      });
    } catch (error) {
      if (currentRequest === requestId.current) setLastNotification({ type: 'error', title: 'No se pudo agregar el XML', detail: error instanceof Error ? error.message : 'No se pudo leer o guardar el archivo. Elige el archivo nuevamente para reintentar.' });
    } finally {
      if (currentRequest === requestId.current) setIsReading(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files?.length || busy) return;
    if (files.length > 1) {
      setLastNotification({ type: 'warning', title: 'Selecciona un comprobante a la vez', detail: 'Carga cada documento por separado para revisar el resultado de importación.' });
      return;
    }
    const file = files[0];
    const name = file.name.toLowerCase();
    if (name.endsWith('.xml')) void processXmlFile(file);
    else if (/\.(pdf|jpg|jpeg|png|webp)$/.test(name)) {
      try {
        const source = validateDocumentFile(file);
        setLastNotification(null); setExtractionFile({file, source});
      } catch (reason) { setLastNotification({type: 'error', title: 'No se pudo leer el archivo', detail: reason instanceof Error ? reason.message : 'Selecciona un documento válido.'}); }
    } else {
      setLastNotification({ type: 'error', title: 'Necesitamos otro tipo de archivo', detail: 'Selecciona una factura XML, un PDF o una foto JPG, PNG o WebP. No se agregó ningún documento.' });
    }
  };

  const uploadSample = (efos: boolean) => {
    const amount = efos ? '8500.00' : '12400.00';
    const sampleDate = efos ? '2026-09-06T12:00:00' : '2026-09-05T12:00:00';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="${sampleDate}" SubTotal="${amount}" Total="${amount}" TipoDeComprobante="I" Moneda="MXN" FormaPago="03" MetodoPago="PUE">
  <cfdi:Emisor Rfc="${efos ? 'FAL8501019A1' : 'DES890101XYZ'}" Nombre="${efos ? 'PROVEEDOR DE EJEMPLO EFOS' : 'DESPACHO CONTABLE DE EJEMPLO'}" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="GARM900101XYZ" Nombre="CLIENTE DE DEMOSTRACION" UsoCFDI="G03" RegimenFiscalReceptor="626" DomicilioFiscalReceptor="01000"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="84111500" ClaveUnidad="E48" Cantidad="1" Descripcion="Servicios de ejemplo para demostracion" ValorUnitario="${amount}" Importe="${amount}" ObjetoImp="01"/></cfdi:Conceptos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${efos ? 'F47AC10B-58CC-4372-A567-0E02B2C3D479' : '9B1DEE92-30C4-4B2C-82DA-123456789ABC'}" FechaTimbrado="${sampleDate}"/></cfdi:Complemento>
</cfdi:Comprobante>`;
    void processXmlFile(new File([xml], efos ? 'ejemplo_alerta_efos.xml' : 'ejemplo_factura_12400.xml', { type: 'application/xml' }));
  };

  return (
    <div className="w-full">
      <div
        onDragOver={event => { event.preventDefault(); if (!busy) setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={event => { event.preventDefault(); setIsDragging(false); handleFiles(event.dataTransfer.files); }}
        onClick={() => { if (!busy) fileInputRef.current?.click(); }}
        onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && !busy) { event.preventDefault(); fileInputRef.current?.click(); } }}
        role="button" tabIndex={0} aria-label="Elegir XML, PDF o foto para agregar un documento" aria-disabled={busy}
        className={`relative border-2 border-dashed rounded-2xl p-6 sm:p-8 transition-all cursor-pointer flex flex-col items-center justify-center text-center focus-visible:outline-2 focus-visible:outline-teal-300 ${isDragging ? 'border-[oklch(0.78_0.15_195)] bg-[oklch(0.78_0.15_195/0.1)] shadow-inner' : 'border-[oklch(0.30_0.03_260)] bg-[oklch(0.18_0.02_260)] hover:bg-[oklch(0.21_0.025_260)] hover:border-[oklch(0.78_0.15_195/0.5)]'}`}
      >
        <input type="file" ref={fileInputRef} onClick={event => event.stopPropagation()} onChange={event => { handleFiles(event.target.files); event.target.value = ''; }} accept=".xml,.pdf,.jpg,.jpeg,.png,.webp" className="hidden" disabled={busy} />
        {isReading ? (
          <div className="flex flex-col items-center py-2" role="status"><Loader2 className="w-10 h-10 text-[oklch(0.78_0.15_195)] animate-spin" /><p className="mt-3 text-base font-sora font-semibold text-white">Leyendo y guardando tu documento…</p></div>
        ) : (
          <>
            <span className="p-3 mb-3 rounded-2xl bg-[oklch(0.78_0.15_195/0.14)] text-[oklch(0.78_0.15_195)] shadow-glow"><UploadCloud className="w-6 h-6" /></span>
            <h3 className="font-sora text-lg font-bold text-white">Agregar un documento</h3>
            <p className="text-sm text-slate-300 max-w-md mt-2">Elige un archivo o arrástralo aquí. Agrega un documento a la vez.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-sm max-w-xl text-left">
              <div className="p-3 rounded-xl border border-slate-600"><span className="flex items-center gap-2 font-semibold text-teal-300"><FileCode2 className="w-5 h-5" /> Tengo una factura XML</span><p className="text-slate-300 mt-1">Se leerá y guardará al elegirlo. Puedes pedir este archivo a quien emitió la factura. Hasta 2 MB.</p></div>
              <div className="p-3 rounded-xl border border-slate-600"><span className="flex items-center gap-2 font-semibold text-teal-300"><FileText className="w-5 h-5" /><ImageIcon className="w-5 h-5" /> Tengo un PDF o una foto</span><p className="text-slate-300 mt-1">Revisarás los datos antes de guardar una anotación provisional; no sustituye la factura XML. Hasta 5 MiB. Fotos JPG, PNG o WebP.</p></div>
            </div>
          </>
        )}
      </div>
      {extractionFile && <DocumentExtraction file={extractionFile.file} source={extractionFile.source} userId={userId} rfcReceptor={rfcReceptor} demoMode={demoMode}
        onClose={() => setExtractionFile(null)} onSave={async (document, source, file) => {
          if (demoMode) await onCfdiAdded(document, 'manual');
          else if (onProvisionalAdded) await onProvisionalAdded(document, source, file);
          else throw new Error('No se pudo conectar el guardado del documento. Actualiza la página.');
          setLastNotification({type: 'success', title: 'Anotación del gasto guardada', detail: `Importe revisado: ${document.total.toFixed(2)} MXN. Aún necesitas la factura XML; esta anotación no se vincula automáticamente con el banco. ${demoMode ? 'La demo guarda los campos en este navegador, sin conservar el archivo original.' : 'Abre la anotación en Documentos cargados para descargar el original privado.'}`});
        }} />}
      {demoMode && <div className="flex flex-wrap items-center gap-2 mt-3 px-1">
        <span className="text-[11px] text-[oklch(0.68_0.03_250)]">Sólo demostración:</span>
        <button type="button" disabled={busy} onClick={() => uploadSample(false)} className="text-[11px] px-2.5 py-1 rounded-lg border border-[oklch(0.30_0.03_260)] bg-[oklch(0.21_0.025_260)] text-white flex items-center gap-1.5 disabled:opacity-50"><FileCode2 className="w-3.5 h-3.5 text-[oklch(0.72_0.17_155)]" /> Probar XML de $12,400</button>
        <button type="button" disabled={busy} onClick={() => uploadSample(true)} className="text-[11px] px-2.5 py-1 rounded-lg bg-[oklch(0.65_0.22_25/0.1)] text-rose-300 border border-[oklch(0.65_0.22_25/0.35)] flex items-center gap-1.5 disabled:opacity-50"><ShieldCheck className="w-3.5 h-3.5" /> Probar alerta EFOS de ejemplo</button>
      </div>}
      {lastNotification && (
        <div role={lastNotification.type === 'success' ? 'status' : 'alert'} className={`mt-3 p-3.5 rounded-xl border flex items-start gap-3 ${lastNotification.type === 'success' ? 'bg-[oklch(0.72_0.17_155/0.12)] border-[oklch(0.72_0.17_155/0.35)] text-[oklch(0.72_0.17_155)]' : lastNotification.type === 'warning' ? 'bg-[oklch(0.80_0.16_75/0.12)] border-[oklch(0.80_0.16_75/0.35)] text-[oklch(0.80_0.16_75)]' : 'bg-[oklch(0.65_0.22_25/0.12)] border-[oklch(0.65_0.22_25/0.35)] text-rose-300'}`}>
          {lastNotification.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
          <div className="flex-1 text-sm leading-relaxed"><div className="font-semibold">{lastNotification.title}</div><div className="mt-1">{lastNotification.detail}</div>{lastNotification.document?.uuidSat && onCfdiOpened && <button type="button" onClick={() => onCfdiOpened(lastNotification.document!)} className="mt-3 min-h-11 px-3 rounded-lg border border-current font-semibold focus-visible:outline-2 focus-visible:outline-white">Ver documento</button>}</div>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setLastNotification(null)} className="min-w-11 min-h-11 text-base hover:opacity-100 font-bold px-1">✕</button>
        </div>
      )}
    </div>
  );
};
