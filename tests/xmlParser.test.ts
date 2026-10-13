import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { XmlCfdiParser } from '../src/lib/xmlParser';

// Synthetic fixture: intentionally contains no real fiscal certificate or taxpayer data.
// Import success only means structural/arithmetic validation, never SAT verification.
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
 Version="4.0" Fecha="2026-10-01T12:30:00" SubTotal="150.00" Descuento="10.00" Moneda="MXN" Total="165.40" TipoDeComprobante="I" FormaPago="03">
 <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Proveedor &amp; Asociados" />
 <cfdi:Receptor Rfc="XAXX010101000" Nombre="Público en general" UsoCFDI="G03" />
 <cfdi:Conceptos>
  <cfdi:Concepto ClaveProdServ="01010101" Descripcion="Servicio A" Cantidad="1" ValorUnitario="100.00" Importe="100.00" Descuento="10.00">
   <cfdi:Impuestos><cfdi:Traslados>
    <cfdi:Traslado Base="90.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="14.40" />
    <cfdi:Traslado Base="90.00" Impuesto="003" TipoFactor="Cuota" TasaOCuota="5.000000" Importe="5.00" />
   </cfdi:Traslados><cfdi:Retenciones><cfdi:Retencion Base="90.00" Impuesto="001" TipoFactor="Tasa" TasaOCuota="0.020000" Importe="2.00" /></cfdi:Retenciones></cfdi:Impuestos>
  </cfdi:Concepto>
  <cfdi:Concepto ClaveProdServ="01010101" Descripcion="Servicio B" Cantidad="1" ValorUnitario="50.00" Importe="50.00">
   <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="50.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="8.00" /></cfdi:Traslados></cfdi:Impuestos>
  </cfdi:Concepto>
 </cfdi:Conceptos>
 <cfdi:Impuestos TotalImpuestosTrasladados="27.40" TotalImpuestosRetenidos="2.00">
  <cfdi:Retenciones><cfdi:Retencion Impuesto="001" Importe="2.00" /></cfdi:Retenciones>
  <cfdi:Traslados>
   <cfdi:Traslado Base="90.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="14.40" />
   <cfdi:Traslado Base="50.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="8.00" />
   <cfdi:Traslado Base="90.00" Impuesto="003" TipoFactor="Cuota" TasaOCuota="5.000000" Importe="5.00" />
  </cfdi:Traslados>
 </cfdi:Impuestos>
 <cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="12345678-abcd-4321-8abc-123456789abc" FechaTimbrado="2026-10-01T12:31:00" /></cfdi:Complemento>
</cfdi:Comprobante>`;
const paymentXml = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'sample-payment20.xml'), 'utf8');
const creditXml = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'sample-credit-note.xml'), 'utf8');
const invoiceUuid = '12345678-ABCD-4321-8ABC-123456789ABC';
const referenceUuid = (index: number) => `${index.toString(16).padStart(8, '0').toUpperCase()}-0000-0000-0000-000000000001`;
const paymentNode = () => paymentXml.match(/<pago20:Pago\s[\s\S]*?<\/pago20:Pago>/)![0];
const relatedNode = () => paymentXml.match(/<pago20:DoctoRelacionado\s[\s\S]*?\/>/)![0];

test('imports actual XML structure, decodes names, preserves owner and never asserts SAT validity', () => {
  const result = XmlCfdiParser.parse(xml, 'owner-123');
  assert.equal(result.success, true, result.error);
  assert.equal(result.cfdi?.userId, 'owner-123');
  assert.equal(result.cfdi?.uuidSat, '12345678-ABCD-4321-8ABC-123456789ABC');
  assert.equal(result.cfdi?.statusSat, 'no_verificado');
  assert.equal(result.cfdi?.nombreEmisor, 'Proveedor & Asociados');
  assert.equal(result.cfdi?.currency, 'MXN');
  assert.equal(result.cfdi?.formaPago, '03');
  assert.equal(result.cfdi?.usoCfdi, 'G03');
  assert.equal(result.cfdi?.conceptos?.length, 2);
});

test('imports the synthetic upload fixture used for manual browser QA', () => {
  const fixture = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'sample-cfdi40.xml'), 'utf8');
  const result = XmlCfdiParser.parse(fixture);
  assert.equal(result.success, true, result.error);
  assert.equal(result.cfdi?.total, 116);
  assert.equal(result.cfdi?.iva, 16);
  assert.equal(result.cfdi?.statusSat, 'no_verificado');
});

test('discounts, all tax transfers, and multiple IVA lines participate in the total exactly once', () => {
  const result = XmlCfdiParser.parse(xml);
  assert.equal(result.success, true, result.error);
  assert.equal(result.cfdi?.subtotal, 150);
  assert.equal(result.cfdi?.descuento, 10);
  assert.equal(result.cfdi?.iva, 22.4);
  assert.equal(result.cfdi?.retenciones, 2);
  assert.equal(result.cfdi?.total, 165.4);
  assert.equal(result.deterministicMathValidation?.impuestosTrasladadosCalculados, 27.4);
  assert.equal(result.deterministicMathValidation?.totalCalculado, 165.4);
});

test('accepts CFDI 3.3 and an alternative namespace prefix', () => {
  const alternative = xml.replaceAll('cfdi:', 'invoice:').replace('xmlns:cfdi=', 'xmlns:invoice=')
    .replace('Version="4.0"', 'Version="3.3"').replace('http://www.sat.gob.mx/cfd/4', 'http://www.sat.gob.mx/cfd/3');
  const result = XmlCfdiParser.parse(alternative);
  assert.equal(result.success, true, result.error);
});

test('accepts a default CFDI namespace and default timbre namespace', () => {
  const alternative = xml.replaceAll('cfdi:', '').replace('xmlns:cfdi=', 'xmlns=')
    .replaceAll('tfd:', '').replace('xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"', '')
    .replace('<TimbreFiscalDigital ', '<TimbreFiscalDigital xmlns="http://www.sat.gob.mx/TimbreFiscalDigital" ');
  const result = XmlCfdiParser.parse(alternative);
  assert.equal(result.success, true, result.error);
});

test('preserves E as a credit note type rather than changing it into an expense', () => {
  const result = XmlCfdiParser.parse(xml.replace('TipoDeComprobante="I"', 'TipoDeComprobante="E"'));
  assert.equal(result.success, true, result.error);
  assert.equal(result.cfdi?.tipoComprobante, 'E');
});

test('imports credit-note references and declared payment method without altering amounts or SAT status', () => {
  const result = XmlCfdiParser.parse(creditXml, 'credit-owner');
  assert.equal(result.success, true, result.error);
  assert.equal(result.cfdi?.tipoComprobante, 'E');
  assert.equal(result.cfdi?.metodoPago, 'PUE');
  assert.equal(result.cfdi?.total, 58);
  assert.deepEqual(result.cfdi?.relatedCfdis, [{type: '01', uuids: [invoiceUuid]}]);
  assert.equal(result.cfdi?.paymentComplement, undefined);
  assert.equal(result.cfdi?.statusSat, 'no_verificado');
});

test('preserves PPD and normalizes lowercase reference UUIDs, including multiple relation groups', () => {
  const input = creditXml.replace('MetodoPago="PUE"', 'MetodoPago="PPD"')
    .replace(invoiceUuid, invoiceUuid.toLowerCase())
    .replace('</cfdi:CfdiRelacionados>', `</cfdi:CfdiRelacionados><cfdi:CfdiRelacionados TipoRelacion="04"><cfdi:CfdiRelacionado UUID="${referenceUuid(9)}"/></cfdi:CfdiRelacionados>`);
  const result = XmlCfdiParser.parse(input);
  assert.equal(result.success, true, result.error);
  assert.equal(result.cfdi?.metodoPago, 'PPD');
  assert.deepEqual(result.cfdi?.relatedCfdis, [{type: '01', uuids: [invoiceUuid]}, {type: '04', uuids: [referenceUuid(9)]}]);
});

test('imports Pagos 2.0 partial payment as documentary metadata while retaining root total zero and XXX', () => {
  const result = XmlCfdiParser.parse(paymentXml, 'payment-owner');
  assert.equal(result.success, true, result.error);
  assert.equal(result.cfdi?.userId, 'payment-owner');
  assert.equal(result.cfdi?.tipoComprobante, 'P');
  assert.equal(result.cfdi?.currency, 'XXX');
  assert.equal(result.cfdi?.total, 0);
  assert.equal(result.cfdi?.subtotal, 0);
  assert.equal(result.cfdi?.retenciones, 0);
  assert.equal(result.cfdi?.statusSat, 'no_verificado');
  assert.equal(result.cfdi?.metodoPago, undefined);
  assert.deepEqual(result.cfdi?.paymentComplement, {version: '2.0', totalPaymentsMxn: '58.00', payments: [{
    date: '2026-10-02T12:00:00', form: '03', currency: 'MXN', amount: '58.00', exchangeRate: undefined,
    relatedDocuments: [{uuid: invoiceUuid, currency: 'MXN', installment: 1, equivalence: undefined,
      previousBalance: '116.00', paidAmount: '58.00', remainingBalance: '58.00', taxObject: '01'}],
  }]});
});

test('resolves valid alternative prefixes and local default namespaces on new documentary nodes', () => {
  const alternative = paymentXml.replaceAll('pago20:', 'receipt:').replace('xmlns:pago20=', 'xmlns:receipt=');
  assert.equal(XmlCfdiParser.parse(alternative).success, true);
  const defaults = paymentXml.replace(/ xmlns:pago20="[^"]+"/, '').replaceAll('pago20:', '')
    .replace('<Pagos ', '<Pagos xmlns="http://www.sat.gob.mx/Pagos20" ');
  assert.equal(XmlCfdiParser.parse(defaults).success, true);
});

test('balances use exact six-decimal arithmetic and keep the written decimals', () => {
  const input = paymentXml.replace('MontoTotalPagos="58.00"', 'MontoTotalPagos="0.10"')
    .replace('Monto="58.00"', 'Monto="0.100000"').replace('ImpSaldoAnt="116.00"', 'ImpSaldoAnt="0.300000"')
    .replace('ImpPagado="58.00"', 'ImpPagado="0.100000"').replace('ImpSaldoInsoluto="58.00"', 'ImpSaldoInsoluto="0.200000"');
  const result = XmlCfdiParser.parse(input);
  assert.equal(result.success, true, result.error);
  assert.equal(result.cfdi?.paymentComplement?.payments[0].relatedDocuments[0].remainingBalance, '0.200000');
});

test('rounds the combined declared payments once rather than rounding each payment first', () => {
  const smallPayment = paymentNode().replace('Monto="58.00"', 'Monto="0.004999"')
    .replace('ImpSaldoAnt="116.00"', 'ImpSaldoAnt="0.009998"')
    .replace('ImpPagado="58.00"', 'ImpPagado="0.004999"').replace('ImpSaldoInsoluto="58.00"', 'ImpSaldoInsoluto="0.004999"');
  const input = paymentXml.replace(paymentNode(), smallPayment + smallPayment).replace('MontoTotalPagos="58.00"', 'MontoTotalPagos="0.01"');
  const result = XmlCfdiParser.parse(input);
  assert.equal(result.success, true, result.error);
  assert.equal(result.cfdi?.paymentComplement?.payments.length, 2);
  assert.equal(result.cfdi?.paymentComplement?.totalPaymentsMxn, '0.01');
  assert.equal(XmlCfdiParser.parse(input.replace('MontoTotalPagos="0.01"', 'MontoTotalPagos="0.00"')).success, false);
});

test('converts declared foreign payments to MXN using the exact exchange rate and half-up rounding', () => {
  const input = paymentXml.replace('MonedaP="MXN"', 'MonedaP="USD" TipoCambioP="17.123456"')
    .replace('MonedaDR="MXN"', 'MonedaDR="USD"').replace('Monto="58.00"', 'Monto="10.00"')
    .replace('ImpSaldoAnt="116.00"', 'ImpSaldoAnt="20.00"').replace('ImpPagado="58.00"', 'ImpPagado="10.00"')
    .replace('ImpSaldoInsoluto="58.00"', 'ImpSaldoInsoluto="10.00"').replace('MontoTotalPagos="58.00"', 'MontoTotalPagos="171.23"');
  const result = XmlCfdiParser.parse(input);
  assert.equal(result.success, true, result.error);
  assert.equal(result.cfdi?.paymentComplement?.payments[0].exchangeRate, '17.123456');
  assert.equal(result.cfdi?.paymentComplement?.payments[0].currency, 'USD');
  assert.equal(XmlCfdiParser.parse(input.replace('MontoTotalPagos="171.23"', 'MontoTotalPagos="171.24"')).success, false);
  assert.equal(XmlCfdiParser.parse(input.replace('17.123456', '17.123500').replace('171.23', '171.24')).success, true);
});

test('preserves ten-decimal EquivalenciaDR without mixing document and payment currencies', () => {
  const input = paymentXml.replace('MonedaP="MXN"', 'MonedaP="EUR" TipoCambioP="17.000000"')
    .replace('MonedaDR="MXN"', 'MonedaDR="USD" EquivalenciaDR="1.0465711361"')
    .replace('Monto="58.00"', 'Monto="100.00"').replace('MontoTotalPagos="58.00"', 'MontoTotalPagos="1700.00"')
    .replace('ImpSaldoAnt="116.00"', 'ImpSaldoAnt="200.000000"').replace('ImpPagado="58.00"', 'ImpPagado="104.657113"')
    .replace('ImpSaldoInsoluto="58.00"', 'ImpSaldoInsoluto="95.342887"');
  const result = XmlCfdiParser.parse(input);
  assert.equal(result.success, true, result.error);
  const document = result.cfdi?.paymentComplement?.payments[0].relatedDocuments[0];
  assert.equal(document?.equivalence, '1.0465711361');
  assert.equal(document?.currency, 'USD');
  assert.equal(document?.paidAmount, '104.657113');
});

test('admits several related documents per payment without reusing their fiscal identity', () => {
  const first = relatedNode().replace('ImpPagado="58.00"', 'ImpPagado="29.00"').replace('ImpSaldoInsoluto="58.00"', 'ImpSaldoInsoluto="87.00"');
  const second = first.replace(invoiceUuid, referenceUuid(10));
  const result = XmlCfdiParser.parse(paymentXml.replace(relatedNode(), first + second));
  assert.equal(result.success, true, result.error);
  assert.equal(result.cfdi?.paymentComplement?.payments[0].relatedDocuments.length, 2);
});

test('rejects aggregate related payments greater than Monto even when each individual balance is consistent', () => {
  const second = relatedNode().replace(invoiceUuid, referenceUuid(10));
  const result = XmlCfdiParser.parse(paymentXml.replace(relatedNode(), relatedNode() + second));
  assert.equal(result.success, false);
  assert.match(result.error || '', /no pueden superar Monto/);
});

test('a foreign-currency reference cannot bypass the same-currency subtotal limit', () => {
  const firstMxn = relatedNode();
  const secondMxn = relatedNode().replace(invoiceUuid, referenceUuid(10));
  const foreign = relatedNode().replace(invoiceUuid, referenceUuid(11))
    .replace('MonedaDR="MXN"', 'MonedaDR="USD" EquivalenciaDR="1"');
  const result = XmlCfdiParser.parse(paymentXml.replace(relatedNode(), firstMxn + secondMxn + foreign));
  assert.equal(result.success, false);
  assert.equal(result.cfdi, undefined);
  assert.match(result.error || '', /no pueden superar Monto/);
});

test('admits the pilot payment limit and rejects the next payment before creating a record', () => {
  const input = paymentXml.replace(paymentNode(), Array.from({length: 100}, paymentNode).join(''))
    .replace('MontoTotalPagos="58.00"', 'MontoTotalPagos="5800.00"');
  assert.equal(XmlCfdiParser.parse(input).success, true);
  const excess = XmlCfdiParser.parse(input.replace('</pago20:Pagos>', paymentNode() + '</pago20:Pagos>'));
  assert.equal(excess.success, false);
  assert.match(excess.error || '', /100 nodos Pago/);
});

test('bounds total related-document count across all payments', () => {
  const many = Array.from({length: 1001}, (_, index) => relatedNode().replace(invoiceUuid, referenceUuid(index))).join('');
  const result = XmlCfdiParser.parse(paymentXml.replace(relatedNode(), many));
  assert.equal(result.success, false);
  assert.match(result.error || '', /1000 en total/);
});

test('bounds related-CFDI groups and aggregate UUID references', () => {
  const group = `<cfdi:CfdiRelacionados TipoRelacion="01"><cfdi:CfdiRelacionado UUID="${invoiceUuid}"/></cfdi:CfdiRelacionados>`;
  const excessGroups = creditXml.replace(/<cfdi:CfdiRelacionados[\s\S]*?<\/cfdi:CfdiRelacionados>/, group.repeat(21));
  assert.match(XmlCfdiParser.parse(excessGroups).error || '', /20 grupos/);
  const references = Array.from({length: 1001}, (_, index) => `<cfdi:CfdiRelacionado UUID="${referenceUuid(index)}"/>`).join('');
  const excessReferences = creditXml.replace(/<cfdi:CfdiRelacionado[^>]*\/>/, references);
  assert.match(XmlCfdiParser.parse(excessReferences).error || '', /1000 referencias/);
});

const invalidDocumentaryCases: Array<[string, string]> = [
  ['payment without Pagos', paymentXml.replace(/<pago20:Pagos[\s\S]*?<\/pago20:Pagos>/, '')],
  ['duplicate Pagos', paymentXml.replace('</pago20:Pagos>', '</pago20:Pagos>' + paymentXml.match(/<pago20:Pagos[\s\S]*?<\/pago20:Pagos>/)![0])],
  ['payment legacy CFDI 3.3', paymentXml.replace('Version="4.0"', 'Version="3.3"').replace('http://www.sat.gob.mx/cfd/4', 'http://www.sat.gob.mx/cfd/3')],
  ['payment legacy complement version', paymentXml.replace('<pago20:Pagos Version="2.0">', '<pago20:Pagos Version="1.0">')],
  ['payment legacy complement namespace', paymentXml.replace('http://www.sat.gob.mx/Pagos20', 'http://www.sat.gob.mx/Pagos')],
  ['payment forged namespace', paymentXml.replace('http://www.sat.gob.mx/Pagos20', 'https://example.invalid/Pagos20')],
  ['forged Pagos beside the legitimate complement', paymentXml.replace('</pago20:Pagos>', '</pago20:Pagos><forged:Pagos xmlns:forged="https://example.invalid/Pagos20" Version="2.0"/>')],
  ['payment forged local namespace alias', paymentXml.replace('<pago20:Pago ', '<pago20:Pago xmlns:pago20="https://example.invalid/Pagos20" ')],
  ['payment with wrong-case Totales', paymentXml.replaceAll('pago20:Totales', 'pago20:totales')],
  ['payment without Totales', paymentXml.replace(/<pago20:Totales[^>]*\/>/, '')],
  ['duplicate Totales', paymentXml.replace('<pago20:Totales ', '<pago20:Totales MontoTotalPagos="58.00"/><pago20:Totales ')],
  ['payment without Pago', paymentXml.replace(paymentNode(), '')],
  ['payment without related documents', paymentXml.replace(relatedNode(), '')],
  ['invalid partial-payment date', paymentXml.replace('FechaPago="2026-10-02T12:00:00"', 'FechaPago="2026-02-30T12:00:00"')],
  ['payment missing form', paymentXml.replace(' FormaDePagoP="03"', '')],
  ['payment missing tax object', paymentXml.replace(' ObjetoImpDR="01"', '')],
  ['payment amount zero', paymentXml.replace('Monto="58.00"', 'Monto="0"')],
  ['payment amount seventh decimal', paymentXml.replace('Monto="58.00"', 'Monto="58.0000001"')],
  ['payment amount excessive integer digits', paymentXml.replace('Monto="58.00"', 'Monto="10000000000"')],
  ['payment total third decimal', paymentXml.replace('MontoTotalPagos="58.00"', 'MontoTotalPagos="58.000"')],
  ['missing previous balance', paymentXml.replace(' ImpSaldoAnt="116.00"', '')],
  ['missing paid amount', paymentXml.replace(' ImpPagado="58.00"', '')],
  ['missing remaining balance', paymentXml.replace(' ImpSaldoInsoluto="58.00"', '')],
  ['paid amount zero', paymentXml.replace('ImpPagado="58.00"', 'ImpPagado="0"').replace('ImpSaldoInsoluto="58.00"', 'ImpSaldoInsoluto="116.00"')],
  ['inconsistent remaining balance', paymentXml.replace('ImpSaldoInsoluto="58.00"', 'ImpSaldoInsoluto="57.99"')],
  ['paid amount exceeds previous balance', paymentXml.replace('ImpPagado="58.00"', 'ImpPagado="116.01"')],
  ['balance seventh decimal', paymentXml.replace('ImpSaldoAnt="116.00"', 'ImpSaldoAnt="116.0000001"')],
  ['installment zero', paymentXml.replace('NumParcialidad="1"', 'NumParcialidad="0"')],
  ['installment too large', paymentXml.replace('NumParcialidad="1"', 'NumParcialidad="1000"')],
  ['installment fraction', paymentXml.replace('NumParcialidad="1"', 'NumParcialidad="1.5"')],
  ['installment leading zero', paymentXml.replace('NumParcialidad="1"', 'NumParcialidad="01"')],
  ['XXX payment currency', paymentXml.replace('MonedaP="MXN"', 'MonedaP="XXX"')],
  ['XXX related-document currency', paymentXml.replace('MonedaDR="MXN"', 'MonedaDR="XXX"')],
  ['foreign payment missing exchange rate', paymentXml.replace('MonedaP="MXN"', 'MonedaP="USD"')],
  ['MXN payment exchange rate not one', paymentXml.replace('MonedaP="MXN"', 'MonedaP="MXN" TipoCambioP="1.01"')],
  ['payment exchange rate zero', paymentXml.replace('MonedaP="MXN"', 'MonedaP="MXN" TipoCambioP="0"')],
  ['payment exchange rate seventh decimal', paymentXml.replace('MonedaP="MXN"', 'MonedaP="MXN" TipoCambioP="1.0000000"')],
  ['different currencies missing equivalence', paymentXml.replace('MonedaDR="MXN"', 'MonedaDR="USD"')],
  ['same-currency equivalence not one', paymentXml.replace('MonedaDR="MXN"', 'MonedaDR="MXN" EquivalenciaDR="0.9999999999"')],
  ['equivalence zero', paymentXml.replace('MonedaDR="MXN"', 'MonedaDR="USD" EquivalenciaDR="0"')],
  ['equivalence eleventh decimal', paymentXml.replace('MonedaDR="MXN"', 'MonedaDR="USD" EquivalenciaDR="1.04657113611"')],
  ['invalid related-document UUID', paymentXml.replace(invoiceUuid, '12345678-ABCD-4321-8ABC-12345678-9ABC')],
  ['payment self reference', paymentXml.replace(invoiceUuid, '22222222-abcd-4321-8abc-123456789abc')],
  ['duplicate payment reference with case variation', paymentXml.replace(relatedNode(), relatedNode() + relatedNode().replace(invoiceUuid, invoiceUuid.toLowerCase()))],
  ['incorrect payment concept product code', paymentXml.replace('ClaveProdServ="84111506"', 'ClaveProdServ="01010101"')],
  ['incorrect payment concept unit', paymentXml.replace('ClaveUnidad="ACT"', 'ClaveUnidad="E48"')],
  ['payment root payment method', paymentXml.replace('TipoDeComprobante="P"', 'TipoDeComprobante="P" MetodoPago="PUE"')],
  ['payment root payment form', paymentXml.replace('TipoDeComprobante="P"', 'TipoDeComprobante="P" FormaPago="03"')],
  ['payment root discount', paymentXml.replace('SubTotal="0"', 'SubTotal="0" Descuento="0"')],
  ['another type contains Pagos', paymentXml.replace('TipoDeComprobante="P"', 'TipoDeComprobante="I"').replace('Moneda="XXX"', 'Moneda="MXN"')],
  ['forged related-CFDI namespace', creditXml.replace('<cfdi:CfdiRelacionados ', '<cfdi:CfdiRelacionados xmlns:cfdi="https://example.invalid/cfd/4" ')],
  ['forged related-CFDI local alias', creditXml.replace('<cfdi:CfdiRelacionado ', '<cfdi:CfdiRelacionado xmlns:cfdi="https://example.invalid/cfd/4" ')],
  ['wrong-case related-CFDI element', creditXml.replaceAll('cfdi:CfdiRelacionado ', 'cfdi:cfdiRelacionado ')],
  ['empty relation group', creditXml.replace(/<cfdi:CfdiRelacionado[^>]*\/>/, '')],
  ['invalid relation type', creditXml.replace('TipoRelacion="01"', 'TipoRelacion="99"')],
  ['relation self reference', creditXml.replace(invoiceUuid, '33333333-abcd-4321-8abc-123456789abc')],
  ['duplicate relation reference', creditXml.replace(/<cfdi:CfdiRelacionado[^>]*\/>/, `<cfdi:CfdiRelacionado UUID="${invoiceUuid}"/><cfdi:CfdiRelacionado UUID="${invoiceUuid.toLowerCase()}"/>`)],
  ['invalid declared payment method', creditXml.replace('MetodoPago="PUE"', 'MetodoPago="OTHER"')],
];
for (const [name, input] of invalidDocumentaryCases) {
  test(`rejects ${name} without accepting partial documentary metadata`, () => {
    const result = XmlCfdiParser.parse(input);
    assert.equal(result.success, false, `${name} unexpectedly succeeded`);
    assert.equal(result.cfdi, undefined);
    assert.ok(result.error);
  });
}

test('accepts names omitted in CFDI 3.3 while requiring RFCs', () => {
  const oldInvoice = xml.replace('Version="4.0"', 'Version="3.3"')
    .replace('http://www.sat.gob.mx/cfd/4', 'http://www.sat.gob.mx/cfd/3')
    .replace(/ Nombre="[^"]+"/g, '');
  const result = XmlCfdiParser.parse(oldInvoice);
  assert.equal(result.success, true, result.error);
  assert.equal(result.cfdi?.nombreEmisor, undefined);
  assert.equal(result.cfdi?.nombreReceptor, undefined);
});

test('rejects switching IVA for IEPS in the summary even when the grand total still matches', () => {
  const summaryStart = xml.indexOf('<cfdi:Impuestos TotalImpuestosTrasladados');
  const changed = xml.slice(0, summaryStart) + xml.slice(summaryStart).replace('Impuesto="002"', 'Impuesto="003"');
  const result = XmlCfdiParser.parse(changed);
  assert.equal(result.success, false);
  assert.match(result.error || '', /impuesto 002/);
});

test('accepts predefined and numeric XML character references', () => {
  const result = XmlCfdiParser.parse(xml.replace('Proveedor &amp; Asociados', 'Proveedor &amp; Asociados &#38; Socios &#x00D1;'));
  assert.equal(result.success, true, result.error);
  assert.match(result.cfdi?.nombreEmisor || '', /& Asociados & Socios Ñ/);
});

test('preserves literal ampersands in comments and CDATA without treating them as entities', () => {
  const result = XmlCfdiParser.parse(xml.replace('</cfdi:Comprobante>', '<cfdi:Addenda><!-- &undefined; <!DOCTYPE ignored> --><Texto><![CDATA[Texto &undefined; <sin analizar>]]></Texto></cfdi:Addenda></cfdi:Comprobante>'));
  assert.equal(result.success, true, result.error);
});

const invalidCases: Array<[string, string]> = [
  ['empty input', ''],
  ['arbitrary XML', '<hello Total="165.40" UUID="12345678-abcd-4321-8abc-123456789abc" />'],
  ['unclosed XML', xml.replace('</cfdi:Comprobante>', '')],
  ['duplicate attribute', xml.replace('SubTotal="150.00"', 'SubTotal="150.00" SubTotal="150.00"')],
  ['duplicate root', xml + xml.replace(/<\?xml[^?]+\?>/, '')],
  ['wrong namespace', xml.replace('http://www.sat.gob.mx/cfd/4', 'https://example.com/cfd/4')],
  ['fake timbre namespace', xml.replace('http://www.sat.gob.mx/TimbreFiscalDigital', 'https://example.com/tfd')],
  ['unsupported version', xml.replace('Version="4.0"', 'Version="2.0"')],
  ['missing timbre', xml.replace(/<cfdi:Complemento>.*<\/cfdi:Complemento>/, '')],
  ['missing UUID', xml.replace(/ UUID="[^"]+"/, '')],
  ['invalid UUID groups', xml.replace('12345678-abcd-4321-8abc-123456789abc', '12345678-abcd-4321-8abc-12345678-abcd')],
  ['missing emisor', xml.replace(/<cfdi:Emisor[^>]+\/>/, '')],
  ['duplicate emisor', xml.replace('<cfdi:Emisor', '<cfdi:Emisor Rfc="AAA010101AAA" Nombre="Fake"/><cfdi:Emisor')],
  ['invalid RFC', xml.replace('AAA010101AAA', 'RFC_DESCONOCIDO')],
  ['invalid calendar date', xml.replace('2026-10-01T12:30:00', '2026-02-30T12:30:00')],
  ['invalid time', xml.replace('2026-10-01T12:30:00', '2026-10-01T24:30:00')],
  ['invalid timbre date', xml.replace('2026-10-01T12:31:00', '2026-13-01T12:31:00')],
  ['missing currency', xml.replace('Moneda="MXN"', '')],
  ['invalid currency shape', xml.replace('Moneda="MXN"', 'Moneda="pesos"')],
  ['unexpected XXX currency', xml.replace('Moneda="MXN"', 'Moneda="XXX"')],
  ['invalid type', xml.replace('TipoDeComprobante="I"', 'TipoDeComprobante="X"')],
  ['nonnumeric total', xml.replace('Total="165.40"', 'Total="NaN"')],
  ['infinite total', xml.replace('Total="165.40"', 'Total="Infinity"')],
  ['scientific notation', xml.replace('Total="165.40"', 'Total="1.654e2"')],
  ['negative total', xml.replace('Total="165.40"', 'Total="-165.40"')],
  ['unsafe magnitude', xml.replace('Total="165.40"', 'Total="999999999999999999999999"')],
  ['one cent discrepancy', xml.replace('Total="165.40"', 'Total="165.41"')],
  ['excess currency precision', xml.replace('Total="165.40"', 'Total="165.404"')],
  ['subtotal mismatch', xml.replace('SubTotal="150.00"', 'SubTotal="151.00"')],
  ['discount mismatch', xml.replace('Descuento="10.00"', 'Descuento="11.00"')],
  ['tax summary mismatch', xml.replace('TotalImpuestosTrasladados="27.40"', 'TotalImpuestosTrasladados="28.40"')],
  ['line tax mismatch', xml.replace('Importe="14.40"', 'Importe="13.40"')],
  ['missing concepts', xml.replace(/<cfdi:Conceptos>[\s\S]*?<\/cfdi:Conceptos>/, '<cfdi:Conceptos/>')],
  ['undefined entity', xml.replace('Proveedor &amp; Asociados', 'Proveedor &undefined; Asociados')],
  ['unescaped ampersand', xml.replace('Proveedor &amp; Asociados', 'Proveedor & Asociados')],
  ['unescaped less-than inside attribute', xml.replace('Descripcion="Servicio A"', 'Descripcion="Servicio < A"')],
  ['literal null', xml.replace('Servicio A', 'Servicio \u0000 A')],
  ['null character reference', xml.replace('Servicio A', 'Servicio &#0; A')],
  ['surrogate character reference', xml.replace('Servicio A', 'Servicio &#xD800; A')],
  ['out of range character reference', xml.replace('Servicio A', 'Servicio &#x110000; A')],
  ['DTD entity injection', '<!DOCTYPE cfdi:Comprobante [<!ENTITY secret SYSTEM "file:///etc/passwd">]>' + xml.replace(/<\?xml[^?]+\?>/, '')],
];

for (const [name, input] of invalidCases) {
  test(`rejects ${name} without creating a fiscal record`, () => {
    const result = XmlCfdiParser.parse(input);
    assert.equal(result.success, false, `${name} unexpectedly succeeded`);
    assert.equal(result.cfdi, undefined);
    assert.ok(result.error);
  });
}
