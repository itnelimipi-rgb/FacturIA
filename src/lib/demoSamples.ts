/** Synthetic CFDI for the demo profile; it has no fiscal validity. */
export function demoSampleXml(kind: 'invoice' | 'efos'): File {
  const efos = kind === 'efos';
  const amount = efos ? '8500.00' : '12400.00';
  const sampleDate = efos ? '2026-09-06T12:00:00' : '2026-09-05T12:00:00';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="${sampleDate}" SubTotal="${amount}" Total="${amount}" TipoDeComprobante="I" Moneda="MXN" FormaPago="03" MetodoPago="PUE">
  <cfdi:Emisor Rfc="${efos ? 'FAL8501019A1' : 'DES890101XYZ'}" Nombre="${efos ? 'PROVEEDOR DE EJEMPLO EFOS' : 'DESPACHO CONTABLE DE EJEMPLO'}" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="GARM900101XYZ" Nombre="CLIENTE DE DEMOSTRACION" UsoCFDI="G03" RegimenFiscalReceptor="626" DomicilioFiscalReceptor="01000"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="84111500" ClaveUnidad="E48" Cantidad="1" Descripcion="Servicios de ejemplo para demostracion" ValorUnitario="${amount}" Importe="${amount}" ObjetoImp="01"/></cfdi:Conceptos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="${efos ? 'F47AC10B-58CC-4372-A567-0E02B2C3D479' : '9B1DEE92-30C4-4B2C-82DA-123456789ABC'}" FechaTimbrado="${sampleDate}"/></cfdi:Complemento>
</cfdi:Comprobante>`;
  return new File([xml], efos ? 'ejemplo_alerta_proveedor.xml' : 'ejemplo_factura_12400.xml', {type: 'application/xml'});
}
