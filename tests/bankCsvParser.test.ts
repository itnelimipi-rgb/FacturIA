import test from 'node:test';
import assert from 'node:assert/strict';
import { bankCsvTransactionId, decodeBankCsvBytes, MAX_BANK_CSV_ROWS, parseBankAmount, parseBankCsv, parseBankDate, revalidateBankCsv } from '../src/lib/bankCsvParser';

const context = { userId: 'user-1', accountId: 'account-1' };

test('imports UTF-8 BOM, signed decimal amounts and normalizes both supported date formats', () => {
  const result = parseBankCsv(String.fromCharCode(0xfeff) + 'fecha,descripción,monto,moneda\r\n2026-10-08,"Pago proveedor, sucursal",-12400.50,MXN\r\n08-10-2026,Depósito,+1000.25,USD', context);
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].amount, -12400.5);
  assert.equal(result.transactions[0].description, 'Pago proveedor, sucursal');
  assert.equal(result.transactions[1].date, '2026-10-08');
  assert.equal(result.transactions[1].currency, 'USD');
  assert.equal(result.transactions[1].amount, 1000.25);
  assert.equal(result.transactions[0].userId, context.userId);
  assert.equal(result.transactions[0].accountId, context.accountId);
  assert.equal(result.transactions[0].status, 'discrepancia');
});

test('imports semicolon delimiters, escaped quotes and multiline descriptions', () => {
  const result = parseBankCsv('fecha;descripcion;monto\n2024-02-29;"Compra ""oficina""\nSucursal centro";-12.05', context);
  assert.deepEqual(result.errors, []);
  assert.equal(result.delimiter, ';');
  assert.equal(result.transactions[0].currency, 'MXN');
  assert.equal(result.transactions[0].description, 'Compra "oficina"\nSucursal centro');
  assert.equal(result.transactions[0].amount, -12.05);
});

test('stable IDs retain identical rows as distinct movements and prevent duplicate reimports', () => {
  const text = 'fecha,descripcion,monto\n2026-10-08,Comisión,-100\n2026-10-08,Comisión,-100';
  const first = parseBankCsv(text, context).transactions;
  const second = parseBankCsv(text, context).transactions;
  assert.equal(first.length, 2);
  assert.notEqual(first[0].id, first[1].id);
  assert.deepEqual(first.map(transaction => transaction.id), second.map(transaction => transaction.id));
  const otherAccount = parseBankCsv(text, { ...context, accountId: 'account-2' }).transactions;
  const otherUser = parseBankCsv(text, { ...context, userId: 'user-2' }).transactions;
  assert.notEqual(first[0].id, otherAccount[0].id);
  assert.notEqual(first[0].id, otherUser[0].id);
});

test('canonical CSV ID helper retains published legacy IDs for repeated Unicode bank rows', () => {
  const text = 'fecha,descripcion,monto\n2026-10-08,Comisión,-100\n2026-10-08,Comisión,-100';
  const rows = parseBankCsv(text, context).transactions;
  const expected = ['bank-csv-4c99ca28af9a1fd4', 'bank-csv-4d99cbbb724cce11'];
  assert.deepEqual(rows.map(transaction => transaction.id), expected);
  assert.deepEqual(rows.map((transaction, occurrence) => bankCsvTransactionId(context, transaction, occurrence)), expected);
});

test('a spreadsheet-edited copy keeps the identity of the original rows, so saving it again adds nothing', () => {
  const original = parseBankCsv('fecha,descripcion,monto,moneda\n2026-10-01,Papeleria,-116.00,MXN\n2026-10-02,Cliente,2320.00,MXN', context);
  const edited = parseBankCsv('fecha,descripcion,monto,moneda\r\n01/10/2026,Papeleria,-116,MXN\r\n02/10/2026,Cliente,2320,MXN\r\n', context);
  assert.deepEqual(edited.errors, []);
  assert.deepEqual(edited.transactions.map(transaction => transaction.id), original.transactions.map(transaction => transaction.id));
});

test('rejects impossible dates and imports nothing until each invalid row is corrected or removed', () => {
  const result = parseBankCsv('fecha,descripcion,monto\n2026-10-08,Correcta,50\n2026-02-29,Incorrecta,30\n31-04-2026,Incorrecta,40', context);
  assert.deepEqual(result.transactions, []);
  assert.equal(result.validTransactions.length, 1);
  assert.equal(result.errors.length, 2);
  assert.deepEqual(result.errors.map(error => error.row), [3, 4]);
  assert.match(result.errors[0].message, /Fecha inválida/);
  assert.deepEqual(result.errors[0].fields, {date: '2026-02-29', description: 'Incorrecta', amount: '30', currency: ''});
});

test('corrected rows get the same identity as a corrected file and removed rows are never imported', () => {
  const invalid = parseBankCsv('fecha,descripcion,monto\n2026-10-08,Correcta,50\n2026-02-30,Imprenta,-348\n2026-10-09,Sobrante,10', context);
  const rows = invalid.rows.map(row => row.line === 3 ? {...row, fields: {...row.fields, date: '2026-10-04'}} : row).filter(row => row.line !== 4);
  const corrected = revalidateBankCsv(invalid, rows, context);
  assert.deepEqual(corrected.errors, []);
  const expected = parseBankCsv('fecha,descripcion,monto\n2026-10-08,Correcta,50\n2026-10-04,Imprenta,-348', context);
  assert.deepEqual(corrected.transactions.map(transaction => transaction.id), expected.transactions.map(transaction => transaction.id));
  assert.equal(corrected.transactions.some(transaction => transaction.description === 'Sobrante'), false);
  const stillInvalid = revalidateBankCsv(invalid, invalid.rows, context);
  assert.deepEqual(stillInvalid.transactions, []);
  assert.equal(stillInvalid.errors.length, 1);
});

test('reads bank exports with a preamble, charge and deposit columns, thousands separators and a reference', () => {
  const text = ['Cuenta:,123456', 'Periodo:,Septiembre 2026', 'Fecha,Concepto,Referencia,Cargo,Abono,Saldo',
    '07/09/2026,SPEI CLIENTE,,,"5,800.00","39,000.00"', '08/09/2026,PAGO PAPELERIA,ALFA1,"1,160.00",,"37,840.00"',
    '09/09/2026,AJUSTE,,(25.50),,', 'Total,,,"1,185.50","5,800.00",'].join('\r\n');
  const result = parseBankCsv(text, context);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.transactions.map(transaction => [transaction.date, transaction.description, transaction.amount]), [
    ['2026-09-07', 'SPEI CLIENTE', 5800], ['2026-09-08', 'PAGO PAPELERIA · Ref. ALFA1', -1160], ['2026-09-09', 'AJUSTE', -25.5],
  ]);
  assert.deepEqual(result.layout?.columns, ['Fecha', 'Concepto', 'Referencia', 'Cargo', 'Abono']);
  assert.match(parseBankCsv('fecha,descripcion,cargo,abono\n2026-10-01,Doble,10,20', context).errors[0].message, /cargo y abono a la vez/);
});

test('reads comma decimals, month names, two-digit years and spreadsheet encodings', () => {
  const result = parseBankCsv('Fecha;Descripción;Importe\n08-oct-2026;Depósito;1.234,56\n09/10/26;Comisión;-90,00\n10 OCT 2026;Pago;1234', context);
  assert.deepEqual(result.errors, []);
  assert.equal(result.delimiter, ';');
  assert.deepEqual(result.transactions.map(transaction => [transaction.date, transaction.amount]), [['2026-10-08', 1234.56], ['2026-10-09', -90], ['2026-10-10', 1234]]);
  const latin1 = Uint8Array.from([...'fecha,descripcion,monto\n2026-10-08,Dep'].map(character => character.charCodeAt(0)).concat(0xf3, ...[...'sito,10'].map(character => character.charCodeAt(0))));
  assert.match(decodeBankCsvBytes(latin1), /Depósito/);
  assert.equal(decodeBankCsvBytes(new TextEncoder().encode('Depósito')), 'Depósito');
});

test('day-first dates are the default and month-first dates are recognized only when the file proves it', () => {
  assert.equal(parseBankDate('03/04/2026'), '2026-04-03');
  assert.equal(parseBankDate('2026-10-08T10:30:00'), '2026-10-08');
  assert.equal(parseBankDate('08/10/2026 10:30'), '2026-10-08');
  const american = parseBankCsv('date,description,amount\n10/25/2026,Coffee,-5\n10/03/2026,Refund,5', context);
  assert.deepEqual(american.errors, []);
  assert.deepEqual(american.transactions.map(transaction => transaction.date), ['2026-10-25', '2026-10-03']);
});

test('accepts unambiguous bank amounts and rejects ambiguous, scientific, excessive or zero values', () => {
  const minus = String.fromCharCode(0x2212);
  for (const [amount, expected] of [['"1,000.50"', 1000.5], ['"1000,50"', 1000.5], ['"$1,234.56"', 1234.56], ['(116.00)', -116], ['116.00-', -116], [`${minus}58.00`, -58], ['"-$1,160.00"', -1160]] as const) {
    const result = parseBankCsv(`fecha,descripcion,monto\n2026-10-08,Pago,${amount}`, context);
    assert.deepEqual(result.errors, [], amount);
    assert.equal(result.transactions[0].amount, expected, amount);
  }
  for (const amount of ['1.000', '1e3', 'Infinity', '0', '-0.00', '1000000000', '', '12.345']) {
    const result = parseBankCsv(`fecha,descripcion,monto\n2026-10-08,Pago,${amount}`, context);
    assert.equal(result.transactions.length, 0, amount);
    assert.match(result.errors[0].message, /Monto inválido/, amount);
  }
  assert.equal(parseBankAmount('1.000', ','), 1000);
  assert.equal(parseBankAmount('1.000', '.'), null);
});

test('rejects mismatched columns, empty descriptions and invalid currency', () => {
  const result = parseBankCsv('fecha,descripcion,monto,moneda\n2026-10-08,Pago,10,MXN,extra\n2026-10-08,,10,MXN\n2026-10-08,Pago,10,dinero', context);
  assert.equal(result.errors.length, 3);
  assert.deepEqual(result.transactions, []);
  assert.match(result.errors[0].message, /columnas/);
  assert.match(result.errors[1].message, /descripción/);
  assert.match(result.errors[2].message, /Moneda inválida/);
  assert.equal(parseBankCsv('fecha,descripcion,monto,moneda\n2026-10-08,Pago,10,pesos', context).transactions[0].currency, 'MXN');
});

test('rejects duplicated amount headers, malformed quoting and missing context; other columns are ignored', () => {
  for (const text of ['fecha,descripcion,monto,monto\n2026-10-08,Pago,10,10', 'fecha,descripcion,monto\n2026-10-08,"Pago,10', 'fecha,descripcion,monto\n2026-10-08,"Pago"error,10', 'columna,otra\n1,2']) {
    const result = parseBankCsv(text, context);
    assert.equal(result.errors.length, 1, text);
    assert.deepEqual(result.transactions, []);
  }
  const extra = parseBankCsv('fecha,descripcion,monto,saldo,sucursal\n2026-10-08,Pago,10,500,Centro', context);
  assert.deepEqual(extra.errors, []);
  assert.equal(extra.transactions[0].amount, 10);
  assert.match(parseBankCsv('fecha,descripcion,monto\n2026-10-08,Pago,10', { userId: '', accountId: '1' }).errors[0].message, /usuario y la cuenta/);
});

test('rejects too many rows and empty files without silently dropping data', () => {
  const tooLarge = 'fecha,descripcion,monto\n' + Array.from({ length: MAX_BANK_CSV_ROWS + 1 }, () => '2026-10-08,Pago,10').join('\n');
  const result = parseBankCsv(tooLarge, context);
  assert.deepEqual(result.transactions, []);
  assert.match(result.errors[0].message, /5000 movimientos/);
  assert.match(parseBankCsv('', context).errors[0].message, /vacío/);
  assert.match(parseBankCsv('fecha,descripcion,monto', context).errors[0].message, /no contiene movimientos/);
});
