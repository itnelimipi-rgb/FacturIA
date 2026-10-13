import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {serializeDocumentsCsv} from '../src/lib/workspaceExport';
import {XmlCfdiParser} from '../src/lib/xmlParser';
import {cfdiSchema} from '../src/lib/validation';
import {buildLocalAssistantContext} from '../src/lib/localAssistant';
const owner = {id:'csv-owner', rfc:'XAXX010101000', businessName:'Reporte sintético', regimeCode:'601', createdAt:'2026-10-01T12:00:00Z'};
const read = (name: string) => {
  const parsed = XmlCfdiParser.parse(readFileSync(new URL(`./fixtures/${name}`,import.meta.url),'utf8'),owner.id);
  assert.ok(parsed.success && parsed.cfdi, parsed.error); return parsed.cfdi;
};
const invoice = read('sample-cfdi40.xml');
const payment = read('sample-payment20.xml');
const credit = read('sample-credit-note.xml');
const snapshot = {profile:owner, transactions:[], cfdis:[invoice,payment,credit]};

test('document CSV distinguishes P zero XXX, declared payment MXN, and positive E credit note without netting', () => {
  const csv = serializeDocumentsCsv(snapshot);
  const rows = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(rows.length,4);
  assert.match(rows[0], /"total_cfdi"/); assert.match(rows[0], /"total_pagos_declarado_mxn"/);
  assert.match(rows[2], /"P",/); assert.match(rows[2], /"XXX",0\.00,0\.00/); assert.ok(rows[2].endsWith(',58.00'));
  assert.match(rows[3], /"E",/); assert.match(rows[3], /"MXN",58\.00,50\.00/);
  assert.ok(rows[3].includes(`"01:${invoice.uuidSat}"`));
  assert.doesNotMatch(csv,/rawXml|Certificado|Sello/);
});
test('document report protects spreadsheet textual cells and rejects cross-account rows', () => {
  const csv = serializeDocumentsCsv({...snapshot,cfdis:[{...invoice,nombreEmisor:'=HYPERLINK("https://invalid.test")',nombreReceptor:'\t@SUM(A1)'}]});
  assert.ok(csv.includes('"\'=HYPERLINK(""https://invalid.test"")"'));
  assert.ok(csv.includes('"\'\t@SUM(A1)"'));
  assert.throws(() => serializeDocumentsCsv({...snapshot,cfdis:[{...invoice,userId:'foreign'}]}));
});
test('document report keeps six-decimal declared values instead of rounding all currencies to cents', () => {
  const csv = serializeDocumentsCsv({...snapshot,cfdis:[{...invoice,total:1.123456,subtotal:1.123456,iva:0,retenciones:0,currency:'USD'}]});
  assert.match(csv, /"USD",1\.123456,1\.123456,0\.00,0\.00/);
  assert.equal(serializeDocumentsCsv({profile:null,cfdis:[],transactions:[]}).split('\r\n').length,2);
});
test('payment metadata rejects inconsistent JSON amounts even when mixed currencies are supplied', () => {
  assert.ok(cfdiSchema.safeParse(payment).success);
  const changed = structuredClone(payment);
  const pay = changed.paymentComplement!.payments[0];
  pay.relatedDocuments.push({...pay.relatedDocuments[0],uuid:'AAAAAAAA-ABCD-4321-8ABC-123456789ABC'});
  pay.relatedDocuments.push({...pay.relatedDocuments[0],uuid:'BBBBBBBB-ABCD-4321-8ABC-123456789ABC',currency:'USD',equivalence:'1'});
  assert.equal(cfdiSchema.safeParse(changed).success,false);
});
test('malformed decimal strings fail validation without a BigInt crash and totals cannot be forged', () => {
  for (const bad of ['1e2','NaN','-1','1.1234567','invalid','']) {
    const changed = structuredClone(payment); changed.paymentComplement!.payments[0].relatedDocuments[0].paidAmount=bad;
    let accepted=true; assert.doesNotThrow(()=>{accepted=cfdiSchema.safeParse(changed).success;}); assert.equal(accepted,false,bad);
  }
  const changed=structuredClone(payment); changed.paymentComplement!.totalPaymentsMxn='99.00';
  assert.equal(cfdiSchema.safeParse(changed).success,false);
  assert.equal(cfdiSchema.safeParse({...payment,paymentComplement:undefined}).success,false);
});
test('non-monetary XXX from payment XML never enters assistant monetary summaries or private payment details', () => {
  const context=buildLocalAssistantContext({...snapshot,cfdis:[payment]});
  assert.deepEqual(context.metrics,[]);
  assert.doesNotMatch(context.json,/paidAmount|previousBalance|remainingBalance|equivalence|totalPaymentsMxn/);
});
