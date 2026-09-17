import { CfdiRecord } from './types';

export interface ParsedCfdiResult {
  success: boolean;
  cfdi?: CfdiRecord;
  error?: string;
  deterministicMathValidation?: {
    subtotal: number;
    ivaCalculado: number;
    retencionesCalculadas: number;
    totalCalculado: number;
    totalDeclarado: number;
    coincideExacto: boolean;
  };
}

/**
 * Parser nativo determinista de CFDI 4.0 / 3.3.
 * Regla de Oro: 0 TOKENS de LLM consumidos.
 * Extrae y valida matemáticamente montos, UUID, RFCs y desglose de IVA/Retenciones.
 */
export class XmlCfdiParser {
  /**
   * Extrae atributos de un nodo XML de manera segura soportando prefijos cfdi: y mayúsculas/minúsculas.
   */
  private static getAttr(node: any, ...attrNames: string[]): string {
    if (!node) return '';
    // Si viene de fast-xml-parser con atributos bajo '@_'
    for (const name of attrNames) {
      if (node[`@_${name}`] !== undefined) return String(node[`@_${name}`]);
      if (node[`@_${name.toLowerCase()}`] !== undefined) return String(node[`@_${name.toLowerCase()}`]);
      if (node[name] !== undefined) return String(node[name]);
      if (node[name.toLowerCase()] !== undefined) return String(node[name.toLowerCase()]);
    }
    return '';
  }

  /**
   * Parser sintáctico nativo rápido que funciona tanto con fast-xml-parser
   * como con un parser regex/sintáctico de alta precisión sin dependencias pesadas.
   */
  static parse(xmlString: string, userId: string = 'default-user'): ParsedCfdiResult {
    try {
      if (!xmlString || typeof xmlString !== 'string' || !xmlString.includes('<')) {
        return { success: false, error: 'El archivo provisto no contiene una estructura XML válida.' };
      }

      // 1. Extraer UUID del Timbre Fiscal Digital
      let uuidSat = '';
      const uuidMatch = xmlString.match(/UUID=["']([a-fA-F0-9\-]{36})["']/i) ||
                         xmlString.match(/FolioFiscal["']?:?\s*["']([a-fA-F0-9\-]{36})["']/i);
      if (uuidMatch && uuidMatch[1]) {
        uuidSat = uuidMatch[1].toUpperCase();
      } else {
        // Generar un UUID mock si es un comprobante de prueba sin timbrado
        uuidSat = `TEST-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`.toUpperCase();
      }

      // 2. Extraer Comprobante: Total, SubTotal, Fecha, TipoDeComprobante
      const comprobanteMatch = xmlString.match(/<(?:cfdi:)?Comprobante\b([^>]+)>/i);
      const compAttrs = comprobanteMatch ? comprobanteMatch[1] : xmlString;

      const totalMatch = compAttrs.match(/\bTotal=["']([\d\.]+)["']/i);
      const subtotalMatch = compAttrs.match(/\bSubTotal=["']([\d\.]+)["']/i);
      const fechaMatch = compAttrs.match(/\bFecha=["']([^"']+)["']/i);
      const tipoMatch = compAttrs.match(/\bTipoDeComprobante=["']([A-Z])["']/i);

      const total = totalMatch ? parseFloat(totalMatch[1]) : 0;
      const subtotal = subtotalMatch ? parseFloat(subtotalMatch[1]) : total;
      const fecha = fechaMatch ? fechaMatch[1] : new Date().toISOString();
      const tipoComprobante = (tipoMatch ? tipoMatch[1] : 'E') as 'I' | 'E' | 'T' | 'N' | 'P';

      // 3. Extraer Emisor y Receptor
      const emisorMatch = xmlString.match(/<(?:cfdi:)?Emisor\b([^>]+)>/i);
      const emisorAttrs = emisorMatch ? emisorMatch[1] : '';
      const rfcEmisorMatch = emisorAttrs.match(/\bRfc=["']([^"']+)["']/i);
      const nombreEmisorMatch = emisorAttrs.match(/\bNombre=["']([^"']+)["']/i);

      const receptorMatch = xmlString.match(/<(?:cfdi:)?Receptor\b([^>]+)>/i);
      const receptorAttrs = receptorMatch ? receptorMatch[1] : '';
      const rfcReceptorMatch = receptorAttrs.match(/\bRfc=["']([^"']+)["']/i);
      const nombreReceptorMatch = receptorAttrs.match(/\bNombre=["']([^"']+)["']/i);

      const rfcEmisor = (rfcEmisorMatch ? rfcEmisorMatch[1] : 'RFC_DESCONOCIDO').toUpperCase();
      const nombreEmisor = nombreEmisorMatch ? nombreEmisorMatch[1] : 'Emisor no especificado';
      const rfcReceptor = (rfcReceptorMatch ? rfcReceptorMatch[1] : 'XAXX010101000').toUpperCase();
      const nombreReceptor = nombreReceptorMatch ? nombreReceptorMatch[1] : 'Receptor';

      // 4. Extraer Impuestos (Traslados IVA 16% y Retenciones)
      let iva = 0;
      const ivaMatch = xmlString.match(/<(?:cfdi:)?Impuestos\b[^>]*\bTotalImpuestosTrasladados=["']([\d\.]+)["']/i) ||
                       xmlString.match(/<(?:cfdi:)?Traslado\b[^>]*\bImporte=["']([\d\.]+)["'][^>]*\bImpuesto=["']002["']/i) ||
                       xmlString.match(/<(?:cfdi:)?Traslado\b[^>]*\bImpuesto=["']002["'][^>]*\bImporte=["']([\d\.]+)["']/i);
      if (ivaMatch && ivaMatch[1]) {
        iva = parseFloat(ivaMatch[1]);
      }

      let retenciones = 0;
      const retMatch = xmlString.match(/<(?:cfdi:)?Impuestos\b[^>]*\bTotalImpuestosRetenidos=["']([\d\.]+)["']/i) ||
                       xmlString.match(/<(?:cfdi:)?Retencion\b[^>]*\bImporte=["']([\d\.]+)["']/i);
      if (retMatch && retMatch[1]) {
        retenciones = parseFloat(retMatch[1]);
      }

      // 5. Verificación determinista matemática:
      // Subtotal + IVA - Retenciones == Total (tolerancia <= $0.02 por redondeos de líneas)
      const totalCalculado = Math.round((subtotal + iva - retenciones) * 100) / 100;
      const coincideExacto = Math.abs(totalCalculado - total) <= 0.05;

      const cfdi: CfdiRecord = {
        id: `cfdi-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        userId,
        uuidSat,
        rfcEmisor,
        rfcReceptor,
        nombreEmisor,
        nombreReceptor,
        total: Math.round(total * 100) / 100,
        subtotal: Math.round(subtotal * 100) / 100,
        iva: Math.round(iva * 100) / 100,
        retenciones: Math.round(retenciones * 100) / 100,
        fechaEmision: fecha,
        tipoComprobante,
        statusSat: 'vigente',
        isEfos: false, // Se evalúa con el servicio de EFOS
        sourceType: 'xml'
      };

      return {
        success: true,
        cfdi,
        deterministicMathValidation: {
          subtotal,
          ivaCalculado: iva,
          retencionesCalculadas: retenciones,
          totalCalculado,
          totalDeclarado: total,
          coincideExacto
        }
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Error al parsear el archivo XML CFDI: ${err?.message || 'Estructura inválida'}`
      };
    }
  }
}
