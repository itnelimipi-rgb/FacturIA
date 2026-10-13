import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { CfdiPaymentComplement, CfdiRecord, CfdiRelation } from './types';

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
const PAYMENTS_NAMESPACE = 'http://www.sat.gob.mx/Pagos20';
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

/** Optional documentary nodes must not silently accept a same-name forged namespace. */
function documentaryChildren(parent: Element, localName: string, namespace: string): Element[] {
  for (const [name, value] of Object.entries(parent.node)) {
    if (name.startsWith('@_') || name.startsWith('?') || name === '#text') continue;
    const local = name.split(':').pop()!;
    if (local.toLowerCase() !== localName.toLowerCase()) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      const node = nodeObject(entry);
      if (local !== localName || namespaceOf(name, namespacesFor(node, parent.namespaces)) !== namespace) {
        throw new Error(`El nodo ${localName} tiene un nombre o namespace inválido.`);
      }
    }
  }
  return children(parent, localName, namespace);
}

function documentarySingle(parent: Element, name: string, namespace: string): Element {
  const matches = documentaryChildren(parent, name, namespace);
  if (matches.length !== 1) throw new Error(`El CFDI debe contener exactamente un nodo ${name}.`);
  return matches[0];
}

function declaredUuid(value: string, currentUuid: string): string {
  const uuid = value.toUpperCase();
  if (!UUID_PATTERN.test(uuid)) throw new Error('Una referencia documental no contiene un UUID válido.');
  if (uuid === currentUuid) throw new Error('Un comprobante no puede referirse a su propio UUID.');
  return uuid;
}

function relatedDocuments(root: Element, namespace: string, currentUuid: string): CfdiRelation[] | undefined {
  const groups = documentaryChildren(root, 'CfdiRelacionados', namespace);
  if (!groups.length) return undefined;
  if (groups.length > 20) throw new Error('El piloto admite como máximo 20 grupos de CFDI relacionados.');
  let referenceCount = 0;
  return groups.map(group => {
    const type = attr(group.node, 'TipoRelacion');
    if (!/^0[1-9]$/.test(type)) throw new Error('La clave TipoRelacion es inválida.');
    const references = documentaryChildren(group, 'CfdiRelacionado', namespace);
    referenceCount += references.length;
    if (!references.length || referenceCount > 1000) {
      throw new Error('Los grupos requieren CFDI relacionados y admiten como máximo 1000 referencias en total.');
    }
    const uuids = references.map(reference => declaredUuid(attr(reference.node, 'UUID'), currentUuid));
    if (new Set(uuids).size !== uuids.length) throw new Error('Un grupo contiene UUID relacionados duplicados.');
    return {type, uuids};
  });
}

/** Decimal strings retain source precision; integer arithmetic never passes through Number. */
function decimalAttribute(node: XmlNode, name: string, digits = 6, positive = false): {text: string; scaled: bigint} {
  const text = attr(node, name);
  // Bounded pilot amounts/rates keep parsing and rendering finite even for hostile XML.
  if (!new RegExp(`^\\d{1,10}(?:\\.\\d{1,${digits}})?$`).test(text)) {
    throw new Error(`El importe o tipo de cambio ${name} es inválido o excede la precisión admitida.`);
  }
  const [whole, fraction = ''] = text.split('.');
  const scaled = BigInt(whole + fraction.padEnd(digits, '0'));
  const scale = 10n ** BigInt(digits);
  if (scaled > 10_000_000_000n * scale || (positive && scaled === 0n)) {
    throw new Error(`El importe o tipo de cambio ${name} está fuera de los límites admitidos.`);
  }
  return {text, scaled};
}

function paymentCurrency(node: XmlNode, name: string): string {
  const currency = attr(node, name);
  if (!/^[A-Z]{3}$/.test(currency) || currency === 'XXX') throw new Error(`La moneda ${name} es inválida.`);
  return currency;
}

function payments(complement: Element, version: string, type: string, currentUuid: string): CfdiPaymentComplement | undefined {
  if (type === 'P' && version !== '4.0') throw new Error('El piloto sólo admite pagos en CFDI 4.0 con complemento Pagos 2.0; los pagos de CFDI 3.3 no están admitidos.');
  if (children(complement, 'Pagos', 'http://www.sat.gob.mx/Pagos').length) {
    throw new Error('El complemento Pagos 1.0 no está admitido; el piloto sólo admite CFDI 4.0 con Pagos 2.0.');
  }
  const paymentNodes = documentaryChildren(complement, 'Pagos', PAYMENTS_NAMESPACE);
  if (type !== 'P') {
    if (paymentNodes.length) throw new Error('El complemento Pagos requiere un comprobante de tipo P.');
    return undefined;
  }
  if (paymentNodes.length !== 1) throw new Error('El comprobante P requiere exactamente un complemento Pagos 2.0.');
  const paymentRoot = paymentNodes[0];
  if (attr(paymentRoot.node, 'Version') !== '2.0') throw new Error('El piloto sólo admite la versión 2.0 del complemento Pagos.');
  const totals = documentarySingle(paymentRoot, 'Totales', PAYMENTS_NAMESPACE);
  const declaredTotal = decimalAttribute(totals.node, 'MontoTotalPagos', 2);
  const paymentElements = documentaryChildren(paymentRoot, 'Pago', PAYMENTS_NAMESPACE);
  if (!paymentElements.length || paymentElements.length > 100) throw new Error('El complemento requiere pagos y el piloto admite como máximo 100 nodos Pago.');
  let relatedCount = 0;
  let totalMxnScaled12 = 0n;
  const records = paymentElements.map(payment => {
    const date = attr(payment.node, 'FechaPago');
    if (!validDate(date)) throw new Error('La fecha del pago es inválida.');
    const form = attr(payment.node, 'FormaDePagoP');
    if (!/^\d{2}$/.test(form)) throw new Error('La clave FormaDePagoP es inválida.');
    const currency = paymentCurrency(payment.node, 'MonedaP');
    const amount = decimalAttribute(payment.node, 'Monto', 6, true);
    const hasExchangeRate = payment.node['@_TipoCambioP'] !== undefined;
    if (currency !== 'MXN' && !hasExchangeRate) throw new Error('El pago en moneda distinta de MXN requiere TipoCambioP.');
    const exchangeRate = hasExchangeRate ? decimalAttribute(payment.node, 'TipoCambioP', 6, true) : undefined;
    if (currency === 'MXN' && exchangeRate && exchangeRate.scaled !== 1_000_000n) {
      throw new Error('TipoCambioP debe ser uno para un pago en MXN.');
    }
    totalMxnScaled12 += amount.scaled * (exchangeRate?.scaled ?? 1_000_000n);
    const documentElements = documentaryChildren(payment, 'DoctoRelacionado', PAYMENTS_NAMESPACE);
    relatedCount += documentElements.length;
    if (!documentElements.length || relatedCount > 1000) {
      throw new Error('Cada pago requiere documentos relacionados y el piloto admite como máximo 1000 en total.');
    }
    const seen = new Set<string>();
    let sameCurrencyPaid = 0n;
    const relatedDocuments = documentElements.map(document => {
      const uuid = declaredUuid(attr(document.node, 'IdDocumento'), currentUuid);
      if (seen.has(uuid)) throw new Error('Un pago contiene UUID de documentos relacionados duplicados.');
      seen.add(uuid);
      const documentCurrency = paymentCurrency(document.node, 'MonedaDR');
      const hasEquivalence = document.node['@_EquivalenciaDR'] !== undefined;
      if (documentCurrency !== currency && !hasEquivalence) throw new Error('Las monedas distintas requieren EquivalenciaDR.');
      const equivalence = hasEquivalence ? decimalAttribute(document.node, 'EquivalenciaDR', 10, true) : undefined;
      if (documentCurrency === currency && equivalence && equivalence.scaled !== 10_000_000_000n) {
        throw new Error('EquivalenciaDR debe ser uno cuando las monedas coinciden.');
      }
      const installmentText = attr(document.node, 'NumParcialidad');
      if (!/^[1-9]\d{0,2}$/.test(installmentText)) throw new Error('NumParcialidad debe estar entre 1 y 999.');
      const previous = decimalAttribute(document.node, 'ImpSaldoAnt');
      const paid = decimalAttribute(document.node, 'ImpPagado', 6, true);
      const remaining = decimalAttribute(document.node, 'ImpSaldoInsoluto');
      if (paid.scaled > previous.scaled || previous.scaled - paid.scaled !== remaining.scaled) {
        throw new Error('Los saldos del documento relacionado son inconsistentes: saldo anterior menos pago debe ser saldo insoluto.');
      }
      if (documentCurrency === currency) sameCurrencyPaid += paid.scaled;
      const taxObject = attr(document.node, 'ObjetoImpDR');
      if (!/^\d{2}$/.test(taxObject)) throw new Error('La clave ObjetoImpDR es inválida.');
      return {uuid, currency: documentCurrency, equivalence: equivalence?.text, installment: Number(installmentText),
        previousBalance: previous.text, paidAmount: paid.text, remainingBalance: remaining.text, taxObject};
    });
    if (sameCurrencyPaid > amount.scaled) {
      throw new Error('Los importes pagados en la misma moneda no pueden superar Monto.');
    }
    return {date, currency, amount: amount.text, form, exchangeRate: exchangeRate?.text, relatedDocuments};
  });
  // All products have scale 12. Round their sum once to MXN cents, half upwards.
  const computedTotalCents = (totalMxnScaled12 + 5_000_000_000n) / 10_000_000_000n;
  if (computedTotalCents !== declaredTotal.scaled) throw new Error('MontoTotalPagos no coincide con la suma de pagos expresados en MXN.');
  return {version: '2.0', totalPaymentsMxn: declaredTotal.text, payments: records};
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
      const metodoPago = attr(rootNode, 'MetodoPago');
      if (rootNode['@_MetodoPago'] !== undefined && !['PUE', 'PPD'].includes(metodoPago)) throw new Error('El método de pago es inválido.');
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
      const relatedCfdis = relatedDocuments(root, namespace, uuidSat);
      const paymentComplement = payments(complemento, version, tipo, uuidSat);

      const conceptosNode = single(root, 'Conceptos', namespace)!;
      const conceptElements = children(conceptosNode, 'Concepto', namespace);
      if (!conceptElements.length) throw new Error('El CFDI no contiene conceptos.');
      if (tipo === 'P') {
        const concept = conceptElements[0].node;
        if (conceptElements.length !== 1 || attr(concept, 'ClaveProdServ') !== '84111506'
          || attr(concept, 'ClaveUnidad') !== 'ACT' || attr(concept, 'Descripcion') !== 'Pago'
          || amount(concept, 'Cantidad') !== 1 || amount(concept, 'ValorUnitario') !== 0
          || amount(concept, 'Importe') !== 0 || attr(concept, 'ObjetoImp') !== '01'
          || concept['@_Descuento'] !== undefined || children(conceptElements[0], 'Impuestos', namespace).length) {
          throw new Error('El comprobante P requiere un único concepto Pago con clave 84111506, unidad ACT, cantidad uno, ObjetoImp 01 e importes cero.');
        }
        if (rootNode['@_FormaPago'] !== undefined || rootNode['@_MetodoPago'] !== undefined
          || rootNode['@_Descuento'] !== undefined || children(root, 'Impuestos', namespace).length
          || subtotal !== 0 || total !== 0) {
          throw new Error('El comprobante P requiere subtotal y total cero, sin FormaPago, MetodoPago, descuentos ni impuestos en el comprobante.');
        }
      }
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
        metodoPago: metodoPago ? metodoPago as 'PUE' | 'PPD' : undefined,
        usoCfdi: attr(receptor.node, 'UsoCFDI') || undefined,
        fechaEmision: fecha,
        tipoComprobante: tipo as CfdiRecord['tipoComprobante'],
        statusSat: 'no_verificado',
        isEfos: false,
        conceptos,
        sourceType: 'xml',
        relatedCfdis,
        paymentComplement,
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
