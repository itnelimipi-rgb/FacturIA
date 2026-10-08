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
