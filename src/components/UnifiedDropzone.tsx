'use client';

import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileCode2, FileText, Image as ImageIcon, CheckCircle2, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { XmlCfdiParser } from '../lib/xmlParser';
import { EfosService } from '../lib/efosService';
import { CfdiRecord } from '../lib/types';

interface UnifiedDropzoneProps {
  userId: string;
  demoMode?: boolean;
  onCfdiAdded: (cfdi: CfdiRecord, source: 'xml' | 'pdf' | 'image') => void | Promise<void>;
}

export const UnifiedDropzone: React.FC<UnifiedDropzoneProps> = ({ userId, demoMode = false, onCfdiAdded }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [lastNotification, setLastNotification] = useState<{ type: 'success' | 'warning' | 'error'; title: string; detail: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current++; }, []);

  const processXmlFile = async (file: File) => {
    if (isReading) return;
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
        title: demoEfos ? 'XML importado con alerta de demostración' : 'CFDI XML importado',
        detail: demoEfos
          ? `El RFC ${result.cfdi.rfcEmisor} coincide con la lista de ejemplo de la demo. No es una consulta oficial al SAT.`
          : `Total: ${result.cfdi.total.toFixed(2)} ${result.cfdi.currency || 'MXN'} · RFC: ${result.cfdi.rfcEmisor}. Estructura validada; vigencia SAT y lista EFOS aún no verificadas.`
      });
    } catch (error) {
      if (currentRequest === requestId.current) setLastNotification({ type: 'error', title: 'No se pudo importar el XML', detail: error instanceof Error ? error.message : 'No se pudo leer o guardar el archivo.' });
    } finally {
      if (currentRequest === requestId.current) setIsReading(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files?.length || isReading) return;
    if (files.length > 1) {
      setLastNotification({ type: 'warning', title: 'Selecciona un comprobante a la vez', detail: 'Carga cada XML por separado para revisar el resultado de importación.' });
      return;
    }
    const file = files[0];
    const name = file.name.toLowerCase();
    if (name.endsWith('.xml')) void processXmlFile(file);
    else if (/\.(pdf|jpg|jpeg|png|webp)$/.test(name)) {
      setLastNotification({ type: 'warning', title: 'Extracción OCR pendiente de configurar', detail: 'Todavía no se extraen datos de PDF o imágenes. Carga el XML original del CFDI o registra un gasto provisional; este archivo no se guardó.' });
    } else {
      setLastNotification({ type: 'error', title: 'Formato no soportado', detail: 'Selecciona un XML CFDI. La extracción de PDF e imágenes está pendiente.' });
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
        onDragOver={event => { event.preventDefault(); if (!isReading) setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={event => { event.preventDefault(); setIsDragging(false); handleFiles(event.dataTransfer.files); }}
        onClick={() => { if (!isReading) fileInputRef.current?.click(); }}
        onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && !isReading) { event.preventDefault(); fileInputRef.current?.click(); } }}
        role="button" tabIndex={0} aria-label="Cargar archivo XML CFDI" aria-disabled={isReading}
        className={`relative border-2 border-dashed rounded-2xl p-6 sm:p-8 transition-all cursor-pointer flex flex-col items-center justify-center text-center ${isDragging ? 'border-[oklch(0.78_0.15_195)] bg-[oklch(0.78_0.15_195/0.1)] shadow-inner' : 'border-[oklch(0.30_0.03_260)] bg-[oklch(0.18_0.02_260)] hover:bg-[oklch(0.21_0.025_260)] hover:border-[oklch(0.78_0.15_195/0.5)]'}`}
      >
        <input type="file" ref={fileInputRef} onClick={event => event.stopPropagation()} onChange={event => { handleFiles(event.target.files); event.target.value = ''; }} accept=".xml,.pdf,.jpg,.jpeg,.png,.webp" className="hidden" disabled={isReading} />
        {isReading ? (
          <div className="flex flex-col items-center py-2"><Loader2 className="w-10 h-10 text-[oklch(0.78_0.15_195)] animate-spin" /><p className="mt-3 text-sm font-sora font-semibold text-white">Validando y guardando el XML…</p></div>
        ) : (
          <>
            <span className="p-3 mb-3 rounded-2xl bg-[oklch(0.78_0.15_195/0.14)] text-[oklch(0.78_0.15_195)] shadow-glow"><UploadCloud className="w-6 h-6" /></span>
            <h3 className="font-sora text-sm font-bold text-white">Cargar comprobante fiscal</h3>
            <p className="text-xs text-[oklch(0.68_0.03_250)] max-w-md mt-1">Arrastra o selecciona el <strong className="text-[oklch(0.78_0.15_195)]">XML original del CFDI</strong>. Se revisan su estructura y sus importes sin enviar el archivo a una IA.</p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-[11px]">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[oklch(0.72_0.17_155/0.12)] text-[oklch(0.72_0.17_155)] border border-[oklch(0.72_0.17_155/0.3)]"><FileCode2 className="w-3 h-3" /> XML CFDI 4.0 / 3.3</span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[oklch(0.78_0.15_195/0.12)] text-[oklch(0.78_0.15_195)] border border-[oklch(0.78_0.15_195/0.3)]"><FileText className="w-3 h-3" /> PDF: pendiente</span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[oklch(0.65_0.20_295/0.12)] text-[oklch(0.65_0.20_295)] border border-[oklch(0.65_0.20_295/0.3)]"><ImageIcon className="w-3 h-3" /> OCR: pendiente</span>
            </div>
          </>
        )}
      </div>
      {demoMode && <div className="flex flex-wrap items-center gap-2 mt-3 px-1">
        <span className="text-[11px] text-[oklch(0.68_0.03_250)]">Sólo demostración:</span>
        <button type="button" disabled={isReading} onClick={() => uploadSample(false)} className="text-[11px] px-2.5 py-1 rounded-lg border border-[oklch(0.30_0.03_260)] bg-[oklch(0.21_0.025_260)] text-white flex items-center gap-1.5 disabled:opacity-50"><FileCode2 className="w-3.5 h-3.5 text-[oklch(0.72_0.17_155)]" /> Probar XML de $12,400</button>
        <button type="button" disabled={isReading} onClick={() => uploadSample(true)} className="text-[11px] px-2.5 py-1 rounded-lg bg-[oklch(0.65_0.22_25/0.1)] text-rose-300 border border-[oklch(0.65_0.22_25/0.35)] flex items-center gap-1.5 disabled:opacity-50"><ShieldCheck className="w-3.5 h-3.5" /> Probar alerta EFOS de ejemplo</button>
      </div>}
      {lastNotification && (
        <div role={lastNotification.type === 'success' ? 'status' : 'alert'} className={`mt-3 p-3.5 rounded-xl border flex items-start gap-3 ${lastNotification.type === 'success' ? 'bg-[oklch(0.72_0.17_155/0.12)] border-[oklch(0.72_0.17_155/0.35)] text-[oklch(0.72_0.17_155)]' : lastNotification.type === 'warning' ? 'bg-[oklch(0.80_0.16_75/0.12)] border-[oklch(0.80_0.16_75/0.35)] text-[oklch(0.80_0.16_75)]' : 'bg-[oklch(0.65_0.22_25/0.12)] border-[oklch(0.65_0.22_25/0.35)] text-rose-300'}`}>
          {lastNotification.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
          <div className="flex-1 text-xs"><div className="font-semibold">{lastNotification.title}</div><div className="mt-0.5 opacity-90">{lastNotification.detail}</div></div>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setLastNotification(null)} className="text-xs opacity-60 hover:opacity-100 font-bold px-1">✕</button>
        </div>
      )}
    </div>
  );
};
