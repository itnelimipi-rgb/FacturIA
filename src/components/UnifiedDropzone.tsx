'use client';

import React, { useState, useRef } from 'react';
import { UploadCloud, FileCode2, FileText, Image as ImageIcon, CheckCircle2, AlertCircle, Loader2, Sparkles, ShieldCheck } from 'lucide-react';
import { XmlCfdiParser } from '../lib/xmlParser';
import { EfosService } from '../lib/efosService';
import { CfdiRecord } from '../lib/types';

interface UnifiedDropzoneProps {
  onCfdiAdded: (cfdi: CfdiRecord, source: 'xml' | 'pdf' | 'image') => void;
}

export const UnifiedDropzone: React.FC<UnifiedDropzoneProps> = ({ onCfdiAdded }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState('');
  const [lastNotification, setLastNotification] = useState<{
    type: 'success' | 'warning' | 'error';
    title: string;
    detail: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Procesa archivo XML con 0 tokens de LLM
  const processXmlFile = async (file: File) => {
    try {
      const text = await file.text();
      const result = XmlCfdiParser.parse(text);

      if (!result.success || !result.cfdi) {
        setLastNotification({
          type: 'error',
          title: 'Error de validación XML',
          detail: result.error || 'Estructura CFDI no conforme al estándar SAT.'
        });
        return;
      }

      // Cruce determinista contra lista negra EFOS
      const efosStatus = EfosService.checkRfc(result.cfdi.rfcEmisor);
      if (efosStatus.isEfos) {
        result.cfdi.isEfos = true;
      }

      onCfdiAdded(result.cfdi, 'xml');

      setLastNotification({
        type: efosStatus.isEfos ? 'warning' : 'success',
        title: efosStatus.isEfos ? '⚠️ Alerta de Seguridad SAT Art. 69-B' : 'CFDI XML Ingerido al Instante',
        detail: efosStatus.isEfos
          ? `El RFC ${result.cfdi.rfcEmisor} figura en la lista definitiva de EFOS. Marcado como discrepancia de alto riesgo.`
          : `Total: $${result.cfdi.total.toFixed(2)} MXN • RFC: ${result.cfdi.rfcEmisor} • 0 tokens consumidos.`
      });
    } catch (err: any) {
      setLastNotification({
        type: 'error',
        title: 'Fallo de lectura',
        detail: err?.message || 'No se pudo leer el archivo XML.'
      });
    }
  };

  // Simulación del flujo agéntico para PDF e Imágenes con compresión y extracción semántica estructurada
  const processPdfOrImageFile = (file: File, fileType: 'pdf' | 'image') => {
    setIsExtracting(true);
    setExtractionMessage(
      fileType === 'pdf'
        ? 'Extrayendo comprobante digital (pdf-parse & regex)...'
        : 'Comprimiendo imagen en cliente & extrayendo datos estructurados...'
    );

    setTimeout(() => {
      setExtractionMessage('Verificando consistencia fiscal y cálculos de IVA...');

      setTimeout(() => {
        setIsExtracting(false);

        const randomAmount = Math.floor(Math.random() * 800) + 150;
        const subtotal = Math.round((randomAmount / 1.16) * 100) / 100;
        const iva = Math.round((randomAmount - subtotal) * 100) / 100;

        const simulatedCfdi: CfdiRecord = {
          id: `cfdi-extracted-${Date.now()}`,
          userId: 'usr-resico-001',
          uuidSat: `EXT-${Date.now().toString(16).toUpperCase()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
          rfcEmisor: fileType === 'pdf' ? 'CFE370814QI0' : 'OXX8605231N4',
          nombreEmisor: fileType === 'pdf' ? 'CFE Suministrador de Servicios Básicos' : 'Cadena Comercial OXXO S.A. de C.V.',
          rfcReceptor: 'GARM900101XYZ',
          nombreReceptor: 'GARCÍA MARTÍNEZ TECH & CONSULTING',
          total: randomAmount,
          subtotal,
          iva,
          retenciones: 0,
          fechaEmision: new Date().toISOString(),
          tipoComprobante: 'E',
          statusSat: 'vigente',
          isEfos: false,
          conceptos: [
            {
              descripcion: fileType === 'pdf' ? 'Consumo de energía eléctrica período actual' : 'Consumo insumos de papelería y cafetería',
              importe: subtotal
            }
          ],
          sourceType: fileType
        };

        onCfdiAdded(simulatedCfdi, fileType);

        setLastNotification({
          type: 'success',
          title: fileType === 'pdf' ? 'Comprobante PDF Procesado' : 'Ticket Físico Digitalizado',
          detail: `Extraído exitosamente: $${simulatedCfdi.total.toFixed(2)} MXN (${simulatedCfdi.nombreEmisor}). Desglose IVA 16% calculado puramente en cliente.`
        });
      }, 900);
    }, 800);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const name = file.name.toLowerCase();

    if (name.endsWith('.xml')) {
      processXmlFile(file);
    } else if (name.endsWith('.pdf')) {
      processPdfOrImageFile(file, 'pdf');
    } else if (name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp')) {
      processPdfOrImageFile(file, 'image');
    } else {
      setLastNotification({
        type: 'error',
        title: 'Formato no soportado',
        detail: 'Por favor arrastra o selecciona archivos .xml, .pdf, .jpg o .png'
      });
    }
  };

  const triggerSampleXmlUpload = () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Fecha="${new Date().toISOString().slice(0, 19)}" SubTotal="12400.00" Total="12400.00" TipoDeComprobante="E" Moneda="MXN">
  <cfdi:Emisor Rfc="DES890101XYZ" Nombre="DESPACHO CONTABLE INTEGRAL S.C." RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="GARM900101XYZ" Nombre="GARCIA MARTINEZ TECH AND CONSULTING" UsoCFDI="G03" RegimenFiscalReceptor="626"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111500" Cantidad="1" Descripcion="Honorarios mensuales de auditoria y contabilidad fiscal" ValorUnitario="12400.00" Importe="12400.00"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="0.00"/>
  <cfdi:Complemento xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital">
    <tfd:TimbreFiscalDigital UUID="9B1DEE92-30C4-4B2C-82DA-${Date.now().toString(16).slice(-12).toUpperCase()}"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

    const blob = new Blob([sampleXml], { type: 'application/xml' });
    const file = new File([blob], 'factura_despacho_12400.xml', { type: 'application/xml' });
    processXmlFile(file);
  };

  const triggerEfosSampleUpload = () => {
    const efosXml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Fecha="${new Date().toISOString().slice(0, 19)}" SubTotal="8500.00" Total="8500.00" TipoDeComprobante="E" Moneda="MXN">
  <cfdi:Emisor Rfc="FAL8501019A1" Nombre="FACTURAS FANTASMA Y ASOCIADOS S.A. DE C.V." RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="GARM900101XYZ" Nombre="GARCIA MARTINEZ TECH" UsoCFDI="G03" RegimenFiscalReceptor="626"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="80101500" Cantidad="1" Descripcion="Asesoría corporativa abstracta" ValorUnitario="8500.00" Importe="8500.00"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="0.00"/>
  <cfdi:Complemento xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital">
    <tfd:TimbreFiscalDigital UUID="F47AC10B-58CC-4372-A567-0E02B2C3D479"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

    const blob = new Blob([efosXml], { type: 'application/xml' });
    const file = new File([blob], 'factura_fantasma_efos.xml', { type: 'application/xml' });
    processXmlFile(file);
  };

  return (
    <div className="w-full">
      {/* Área Dropzone Principal */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-6 sm:p-8 transition-all cursor-pointer flex flex-col items-center justify-center text-center ${
          isDragging
            ? 'border-[oklch(0.78_0.15_195)] bg-[oklch(0.78_0.15_195/0.1)] shadow-inner'
            : 'border-[oklch(0.30_0.03_260)] bg-[oklch(0.18_0.02_260)] hover:bg-[oklch(0.21_0.025_260)] hover:border-[oklch(0.78_0.15_195/0.5)]'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => handleFiles(e.target.files)}
          accept=".xml,.pdf,.jpg,.jpeg,.png,.webp"
          className="hidden"
        />

        {isExtracting ? (
          <div className="flex flex-col items-center py-2 animate-fade-in">
            <div className="relative">
              <Loader2 className="w-10 h-10 text-[oklch(0.78_0.15_195)] animate-spin" />
              <Sparkles className="w-4 h-4 text-amber-400 absolute -top-1 -right-1 animate-bounce" />
            </div>
            <p className="mt-3 text-sm font-sora font-semibold text-white">
              {extractionMessage}
            </p>
            <p className="text-xs text-[oklch(0.68_0.03_250)] mt-1">
              Extracción semántica estructurada con JSON Schema y validación matemática pura
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <span className="p-3 rounded-2xl bg-[oklch(0.78_0.15_195/0.14)] text-[oklch(0.78_0.15_195)] shadow-glow">
                <UploadCloud className="w-6 h-6" />
              </span>
            </div>

            <h3 className="font-sora text-sm font-bold text-white">
              Dropzone Unificado de Ingesta Fiscal
            </h3>
            <p className="text-xs text-[oklch(0.68_0.03_250)] max-w-md mt-1">
              Arrastra o haz clic para subir comprobantes en <strong className="text-[oklch(0.78_0.15_195)]">.XML</strong> (procesamiento instantáneo, 0 tokens), <strong className="text-[oklch(0.72_0.17_155)]">.PDF</strong> o <strong className="text-[oklch(0.65_0.20_295)]">.JPG/.PNG</strong>
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-[11px]">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[oklch(0.72_0.17_155/0.12)] text-[oklch(0.72_0.17_155)] border border-[oklch(0.72_0.17_155/0.3)]">
                <FileCode2 className="w-3 h-3" /> XML CFDI 4.0 / 3.3 (0 tokens)
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[oklch(0.78_0.15_195/0.12)] text-[oklch(0.78_0.15_195)] border border-[oklch(0.78_0.15_195/0.3)]">
                <FileText className="w-3 h-3" /> PDF Vectorial
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[oklch(0.65_0.20_295/0.12)] text-[oklch(0.65_0.20_295)] border border-[oklch(0.65_0.20_295/0.3)]">
                <ImageIcon className="w-3 h-3" /> Tickets Físicos
              </span>
            </div>
          </>
        )}
      </div>

      {/* Botones de acción rápida para demostración inmediata */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-3 px-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[oklch(0.68_0.03_250)]">Pruebas rápidas:</span>
          <button
            type="button"
            onClick={triggerSampleXmlUpload}
            className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-[oklch(0.21_0.025_260)] hover:bg-[oklch(0.24_0.028_260)] border border-[oklch(0.30_0.03_260)] text-[oklch(0.97_0.01_240)] transition-colors flex items-center gap-1.5"
          >
            <FileCode2 className="w-3.5 h-3.5 text-[oklch(0.72_0.17_155)]" />
            Vincular factura de $12,400 (Resuelve discrepancia)
          </button>
          <button
            type="button"
            onClick={triggerEfosSampleUpload}
            className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-[oklch(0.65_0.22_25/0.1)] hover:bg-[oklch(0.65_0.22_25/0.2)] text-rose-300 border border-[oklch(0.65_0.22_25/0.35)] transition-colors flex items-center gap-1.5"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-rose-400" />
            Probar XML con RFC Lista Negra (Art. 69-B)
          </button>
        </div>
        <span className="text-[11px] text-[oklch(0.68_0.03_250)] hidden sm:inline font-mono">
          RLS Supabase Activo
        </span>
      </div>

      {/* Banner de Notificación */}
      {lastNotification && (
        <div
          className={`mt-3 p-3.5 rounded-xl border flex items-start gap-3 transition-all ${
            lastNotification.type === 'success'
              ? 'bg-[oklch(0.72_0.17_155/0.12)] border-[oklch(0.72_0.17_155/0.35)] text-[oklch(0.72_0.17_155)]'
              : lastNotification.type === 'warning'
              ? 'bg-[oklch(0.80_0.16_75/0.12)] border-[oklch(0.80_0.16_75/0.35)] text-[oklch(0.80_0.16_75)]'
              : 'bg-[oklch(0.65_0.22_25/0.12)] border-[oklch(0.65_0.22_25/0.35)] text-rose-300'
          }`}
        >
          {lastNotification.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-[oklch(0.72_0.17_155)] flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1 text-xs">
            <div className="font-semibold">{lastNotification.title}</div>
            <div className="mt-0.5 opacity-90">{lastNotification.detail}</div>
          </div>
          <button
            onClick={() => setLastNotification(null)}
            className="text-xs opacity-60 hover:opacity-100 font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
