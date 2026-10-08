import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { CfdiRecord } from './types';

export interface ParsedCfdiResult {
  success: boolean;
  cfdi?: CfdiRecord;
  error?: string;
  deterministicMathValidation?: {
    subtotal: number;
    ivaCalculado: number;
    impuestosTrasladadosCalculados: number;
    descuento: number;
    retencionesCalculadas: number;
    totalCalculado: number;
    totalDeclarado: number;
    coincideExacto: boolean;
  };
}

type XmlNode = Record<string, unknown>;
type Namespaces = Record<string, string>;
type Element = { name: string; node: XmlNode; namespaces: Namespaces };

const TFD_NAMESPACE = 'http://www.sat.gob.mx/TimbreFiscalDigital';
const RFC_PATTERN = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const UUID_PATTERN = /^[\dA-F]{8}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{12}$/;
const AMOUNT_PATTERN = /^\d+(?:\.\d{1,6})?$/;
const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  allowBooleanAttributes: false,
  // In FXP 5, this also enables numeric character references. The lexical guard
  // still permits only XML's five predefined named entities, not HTML entities.
  htmlEntities: true,
});

function validXmlCharacter(code: number): boolean {
  return code === 9 || code === 10 || code === 13
    || (code >= 0x20 && code <= 0xD7FF)
    || (code >= 0xE000 && code <= 0xFFFD)
    || (code >= 0x10000 && code <= 0x10FFFF);
}

/** XMLValidator checks tag structure; supplement its entity/attribute character gaps. */
function validateXmlLexical(xml: string): void {
  for (const character of xml) {
    if (!validXmlCharacter(character.codePointAt(0)!)) {
      throw new Error('XML mal formado: contiene caracteres no permitidos en XML 1.0.');
    }
  }
  const entityEnd = (position: number): number => {
    const end = xml.indexOf(';', position + 1);
    if (end < 0) throw new Error('XML mal formado: referencia de entidad incompleta.');
    const entity = xml.slice(position + 1, end);
    if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(entity)) return end;
    const decimal = /^#\d+$/.test(entity);
    const hexadecimal = /^#x[\dA-Fa-f]+$/.test(entity);
    if (!decimal && !hexadecimal) throw new Error('XML mal formado: entidad no definida.');
    const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isFinite(code) || !validXmlCharacter(code)) throw new Error('XML mal formado: referencia de carácter inválida.');
    return end;
  };
  let inTag = false;
  let quote = '';
  for (let index = 0; index < xml.length; index++) {
    const character = xml[index];
    if (!inTag) {
      const ignoredSection = xml.startsWith('<!--', index) ? '-->'
        : xml.startsWith('<![CDATA[', index) ? ']]>'
          : xml.startsWith('<?', index) ? '?>' : '';
      if (ignoredSection) {
        const end = xml.indexOf(ignoredSection, index + 2);
        if (end < 0) throw new Error('XML mal formado: sección incompleta.');
        index = end + ignoredSection.length - 1;
      } else if (character === '<') {
        if (xml[index + 1] === '!') throw new Error('No se permiten DTD ni declaraciones de entidades XML.');
        inTag = true;
      } else if (character === '&') index = entityEnd(index);
    } else if (quote) {
      if (character === quote) quote = '';
      else if (character === '<') throw new Error('XML mal formado: un atributo contiene el carácter < sin escapar.');
      else if (character === '&') index = entityEnd(index);
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') inTag = false;
  }
}

function nodeObject(value: unknown): XmlNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('El CFDI contiene un nodo ausente o duplicado.');
  }
  return value as XmlNode;
}

function attr(node: XmlNode, name: string): string {
  const value = node[`@_${name}`];
  return typeof value === 'string' ? value : '';
}

function namespacesFor(node: XmlNode, inherited: Namespaces): Namespaces {
  const result = { ...inherited };
  for (const [key, value] of Object.entries(node)) {
    if (key === '@_xmlns') result[''] = String(value);
    else if (key.startsWith('@_xmlns:')) result[key.slice(8)] = String(value);
  }
  return result;
}

function namespaceOf(name: string, namespaces: Namespaces): string {
  const separator = name.indexOf(':');
  return namespaces[separator < 0 ? '' : name.slice(0, separator)] || '';
}

function children(parent: Element, localName: string, namespace: string): Element[] {
  const result: Element[] = [];
  for (const [name, value] of Object.entries(parent.node)) {
    if (name.startsWith('@_') || name.startsWith('?') || name === '#text') continue;
    if (name.split(':').pop() !== localName) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      const node = nodeObject(entry);
      const namespaces = namespacesFor(node, parent.namespaces);
      if (namespaceOf(name, namespaces) === namespace) result.push({ name, node, namespaces });
    }
  }
  return result;
}

function single(parent: Element, name: string, namespace: string, required = true): Element | undefined {
  const matches = children(parent, name, namespace);
  if (matches.length > 1 || (required && matches.length !== 1)) {
    throw new Error(`El CFDI debe contener ${required ? 'exactamente' : 'como máximo'} un nodo ${name}.`);
  }
  return matches[0];
}

function amount(node: XmlNode, name: string, required = true): number {
  const raw = attr(node, name);
  if (!raw && !required) return 0;
  if (!AMOUNT_PATTERN.test(raw)) throw new Error(`El importe ${name} es inválido.`);
  const result = Number(raw);
  // Avoid accepting totals whose precision cannot be represented safely in JavaScript.
  if (!Number.isFinite(result) || result > Number.MAX_SAFE_INTEGER / 1_000_000) {
    throw new Error(`El importe ${name} excede la precisión admitida.`);
  }
  return result;
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function equalAmounts(actual: number, expected: number, digits: number): boolean {
  return Math.abs(round(actual, digits) - round(expected, digits)) < 1e-8;
}

function checkAmount(actual: number, expected: number, digits: number, label: string): void {
  if (!equalAmounts(actual, expected, digits)) throw new Error(`El CFDI tiene una inconsistencia en ${label}.`);
}

function requiredRfc(node: XmlNode, label: string): string {
  const rfc = attr(node, 'Rfc').toUpperCase();
  if (!RFC_PATTERN.test(rfc)) throw new Error(`El RFC del ${label} es inválido.`);
  return rfc;
}

function internalId(): string {
  // This is an application id; only the timbre supplies the fiscal UUID.
  return `cfdi-${typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function taxes(container: Element | undefined, namespace: string, concept = false): {
  transferred: number; iva: number; withheld: number;
  transferredByTax: Record<string, number>; withheldByTax: Record<string, number>;
} {
  const transferredByTax: Record<string, number> = {};
  const withheldByTax: Record<string, number> = {};
  if (!container) return { transferred: 0, iva: 0, withheld: 0, transferredByTax, withheldByTax };
  const transferContainer = single(container, 'Traslados', namespace, false);
  const retentionContainer = single(container, 'Retenciones', namespace, false);
  let transferred = 0;
  let iva = 0;
  let withheld = 0;
  for (const transfer of transferContainer ? children(transferContainer, 'Traslado', namespace) : []) {
    const taxCode = attr(transfer.node, 'Impuesto');
    if (!/^(001|002|003)$/.test(taxCode)) throw new Error('El código del impuesto trasladado es inválido.');
    const factor = attr(transfer.node, 'TipoFactor');
    if (!['Tasa', 'Cuota', 'Exento'].includes(factor)) throw new Error('El tipo de factor del impuesto es inválido.');
    const value = factor === 'Exento' ? 0 : amount(transfer.node, 'Importe');
    if (factor === 'Exento' && attr(transfer.node, 'Importe')) throw new Error('Un traslado exento no debe declarar un importe.');
    transferred += value;
    transferredByTax[taxCode] = (transferredByTax[taxCode] || 0) + value;
    if (taxCode === '002') iva += value;
  }
  for (const retention of retentionContainer ? children(retentionContainer, 'Retencion', namespace) : []) {
    const taxCode = attr(retention.node, 'Impuesto');
    if (!/^(001|002|003)$/.test(taxCode)) throw new Error('El código del impuesto retenido es inválido.');
    const value = amount(retention.node, 'Importe');
    withheld += value;
    withheldByTax[taxCode] = (withheldByTax[taxCode] || 0) + value;
  }
  if (!concept) {
    if (transferred > 0 && !attr(container.node, 'TotalImpuestosTrasladados')) throw new Error('Falta TotalImpuestosTrasladados.');
    if (withheld > 0 && !attr(container.node, 'TotalImpuestosRetenidos')) throw new Error('Falta TotalImpuestosRetenidos.');
  }
  return { transferred, iva, withheld, transferredByTax, withheldByTax };
}

/** Structural and arithmetic import validation only; it does not verify SAT status, XSD, or signatures. */
export class XmlCfdiParser {
  static parse(xmlString: string, userId: string = 'default-user'): ParsedCfdiResult {
    try {
      if (typeof xmlString !== 'string' || !xmlString.trim() || xmlString.length > 5 * 1024 * 1024) {
        throw new Error('El archivo XML está vacío o excede el límite de 5 MB.');
      }
      validateXmlLexical(xmlString);
      const validation = XMLValidator.validate(xmlString, { allowBooleanAttributes: false });
      if (validation !== true) throw new Error(`XML mal formado: ${validation.err.msg}`);
      const document = parser.parse(xmlString) as XmlNode;
      const roots = Object.keys(document).filter(key => !key.startsWith('?') && key !== '#text');
      if (roots.length !== 1 || roots[0].split(':').pop() !== 'Comprobante') throw new Error('El archivo no contiene un comprobante CFDI.');
      const rootNode = nodeObject(document[roots[0]]);
      const version = attr(rootNode, 'Version');
      if (!['3.3', '4.0'].includes(version)) throw new Error('Sólo se admiten CFDI 3.3 y 4.0.');
      const namespace = `http://www.sat.gob.mx/cfd/${version === '4.0' ? '4' : '3'}`;
      const root: Element = { name: roots[0], node: rootNode, namespaces: namespacesFor(rootNode, {}) };
      if (namespaceOf(root.name, root.namespaces) !== namespace) throw new Error('El namespace del comprobante CFDI es inválido.');
      const emisor = single(root, 'Emisor', namespace)!;
      const receptor = single(root, 'Receptor', namespace)!;
      const rfcEmisor = requiredRfc(emisor.node, 'emisor');
      const rfcReceptor = requiredRfc(receptor.node, 'receptor');
      const nombreEmisor = attr(emisor.node, 'Nombre').trim();
      const nombreReceptor = attr(receptor.node, 'Nombre').trim();
      if (version === '4.0' && (!nombreEmisor || !nombreReceptor)) throw new Error('Falta el nombre del emisor o receptor.');
      const fecha = attr(rootNode, 'Fecha');
      if (!validDate(fecha)) throw new Error('La fecha de emisión es inválida.');
      const currency = attr(rootNode, 'Moneda');
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('La moneda del CFDI es inválida.');
      const tipo = attr(rootNode, 'TipoDeComprobante');
      if (!['I', 'E', 'T', 'N', 'P'].includes(tipo)) throw new Error('El tipo de comprobante es inválido.');
      if ((tipo === 'P' || tipo === 'T') !== (currency === 'XXX')) throw new Error('La moneda XXX corresponde a comprobantes de traslado o pago.');
      const currencyDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
      const subtotal = amount(rootNode, 'SubTotal');
      const total = amount(rootNode, 'Total');
      const descuento = amount(rootNode, 'Descuento', false);
      if (descuento > subtotal) throw new Error('El descuento no puede superar el subtotal.');
      if (!equalAmounts(total, round(total, currencyDigits), 6)) throw new Error('El total excede los decimales permitidos para la moneda.');
      const complemento = single(root, 'Complemento', namespace)!;
      const timbre = single(complemento, 'TimbreFiscalDigital', TFD_NAMESPACE)!;
      const uuidSat = attr(timbre.node, 'UUID').toUpperCase();
      if (!UUID_PATTERN.test(uuidSat)) throw new Error('El timbre fiscal debe contener un UUID válido.');
      if (attr(timbre.node, 'Version') !== '1.1' || !validDate(attr(timbre.node, 'FechaTimbrado'))) throw new Error('El timbre fiscal 1.1 o su fecha son inválidos.');

      const conceptosNode = single(root, 'Conceptos', namespace)!;
      const conceptElements = children(conceptosNode, 'Concepto', namespace);
      if (!conceptElements.length) throw new Error('El CFDI no contiene conceptos.');
      let conceptSubtotal = 0;
      let conceptDiscount = 0;
      let conceptTransferred = 0;
      let conceptWithheld = 0;
      const conceptTransferredByTax: Record<string, number> = {};
      const conceptWithheldByTax: Record<string, number> = {};
      const conceptos = conceptElements.map(concept => {
        const importe = amount(concept.node, 'Importe');
        const discount = amount(concept.node, 'Descuento', false);
        const descripcion = attr(concept.node, 'Descripcion').trim();
        if (!descripcion) throw new Error('Un concepto no tiene descripción.');
        if (amount(concept.node, 'Cantidad') <= 0) throw new Error('La cantidad de un concepto debe ser positiva.');
        amount(concept.node, 'ValorUnitario');
        if (discount > importe) throw new Error('El descuento de un concepto supera su importe.');
        conceptSubtotal += importe;
        conceptDiscount += discount;
        const conceptTaxes = taxes(single(concept, 'Impuestos', namespace, false), namespace, true);
        conceptTransferred += conceptTaxes.transferred;
        conceptWithheld += conceptTaxes.withheld;
        for (const [taxCode, value] of Object.entries(conceptTaxes.transferredByTax)) {
          conceptTransferredByTax[taxCode] = (conceptTransferredByTax[taxCode] || 0) + value;
        }
        for (const [taxCode, value] of Object.entries(conceptTaxes.withheldByTax)) {
          conceptWithheldByTax[taxCode] = (conceptWithheldByTax[taxCode] || 0) + value;
        }
        return { claveProdServ: attr(concept.node, 'ClaveProdServ') || undefined, descripcion, importe };
      });
      checkAmount(conceptSubtotal, subtotal, currencyDigits, 'la suma de conceptos y el subtotal');
      checkAmount(conceptDiscount, descuento, currencyDigits, 'la suma de descuentos');

      const impuestosNode = single(root, 'Impuestos', namespace, false);
      const { transferred, iva, withheld, transferredByTax, withheldByTax } = taxes(impuestosNode, namespace);
      const totalTransferred = impuestosNode ? amount(impuestosNode.node, 'TotalImpuestosTrasladados', false) : 0;
      const totalWithheld = impuestosNode ? amount(impuestosNode.node, 'TotalImpuestosRetenidos', false) : 0;
      checkAmount(transferred, totalTransferred, currencyDigits, 'los impuestos trasladados');
      checkAmount(withheld, totalWithheld, currencyDigits, 'los impuestos retenidos');
      checkAmount(conceptTransferred, totalTransferred, currencyDigits, 'los traslados de los conceptos');
      checkAmount(conceptWithheld, totalWithheld, currencyDigits, 'las retenciones de los conceptos');
      for (const taxCode of ['001', '002', '003']) {
        checkAmount(conceptTransferredByTax[taxCode] || 0, transferredByTax[taxCode] || 0, currencyDigits, `los traslados del impuesto ${taxCode}`);
        checkAmount(conceptWithheldByTax[taxCode] || 0, withheldByTax[taxCode] || 0, currencyDigits, `las retenciones del impuesto ${taxCode}`);
      }
      const totalCalculado = round(subtotal - descuento + totalTransferred - totalWithheld, currencyDigits);
      checkAmount(totalCalculado, total, currencyDigits, 'el total (subtotal menos descuentos más traslados menos retenciones)');
      if ((tipo === 'P' || tipo === 'T') && (total !== 0 || subtotal !== 0)) throw new Error('Los comprobantes de pago o traslado deben tener total y subtotal cero.');
      const cfdi: CfdiRecord = {
        id: internalId(),
        userId,
        uuidSat,
        rfcEmisor,
        rfcReceptor,
        nombreEmisor: nombreEmisor || undefined,
        nombreReceptor: nombreReceptor || undefined,
        total,
        subtotal,
        iva: round(iva, currencyDigits),
        retenciones: totalWithheld,
        descuento,
        currency,
        formaPago: attr(rootNode, 'FormaPago') || undefined,
        usoCfdi: attr(receptor.node, 'UsoCFDI') || undefined,
        fechaEmision: fecha,
        tipoComprobante: tipo as CfdiRecord['tipoComprobante'],
        statusSat: 'no_verificado',
        isEfos: false,
        conceptos,
        sourceType: 'xml',
      };
      return {
        success: true,
        cfdi,
        deterministicMathValidation: {
          subtotal,
          ivaCalculado: cfdi.iva,
          impuestosTrasladadosCalculados: totalTransferred,
          descuento,
          retencionesCalculadas: totalWithheld,
          totalCalculado,
          totalDeclarado: total,
          coincideExacto: true,
        },
      };
    } catch (error: unknown) {
      return { success: false, error: `Error al importar CFDI: ${error instanceof Error ? error.message : 'Estructura inválida'}` };
    }
  }
}
