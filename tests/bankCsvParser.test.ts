import test from 'node:test';
import assert from 'node:assert/strict';
import { bankCsvTransactionId, MAX_BANK_CSV_ROWS, parseBankCsv } from '../src/lib/bankCsvParser';

const context = { userId: 'user-1', accountId: 'account-1' };

test('imports UTF-8 BOM, signed decimal amounts and normalizes both supported date formats', () => {
  const result = parseBankCsv('\uFEFFfecha,descripción,monto,moneda\r\n2026-10-08,"Pago proveedor, sucursal",-12400.50,MXN\r\n08-10-2026,Depósito,+1000.25,USD', context);
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

test('rejects impossible dates and imports nothing when any row is invalid', () => {
  const result = parseBankCsv('fecha,descripcion,monto\n2026-10-08,Correcta,50\n2026-02-29,Incorrecta,30\n31-04-2026,Incorrecta,40', context);
  assert.deepEqual(result.transactions, []);
  assert.equal(result.errors.length, 2);
  assert.deepEqual(result.errors.map(error => error.row), [3, 4]);
  assert.match(result.errors[0].message, /Fecha inválida/);
});

test('rejects ambiguous thousands, comma decimals, scientific notation, excess precision and zero', () => {
  for (const amount of ['"1,000.50"', '"1000,50"', '1.000', '1e3', 'Infinity', '0', '-0.00', '1000000000', '']) {
    const result = parseBankCsv(`fecha,descripcion,monto\n2026-10-08,Pago,${amount}`, context);
    assert.equal(result.transactions.length, 0, amount);
    assert.match(result.errors[0].message, /Monto inválido/, amount);
  }
});

test('rejects mismatched columns, empty descriptions and invalid currency', () => {
  const result = parseBankCsv('fecha,descripcion,monto,moneda\n2026-10-08,Pago,10,MXN,extra\n2026-10-08,,10,MXN\n2026-10-08,Pago,10,pesos', context);
  assert.equal(result.errors.length, 3);
  assert.deepEqual(result.transactions, []);
  assert.match(result.errors[0].message, /columnas/);
  assert.match(result.errors[1].message, /descripción/);
  assert.match(result.errors[2].message, /Moneda inválida/);
});

test('rejects duplicated or unknown headers, malformed quoting and missing context', () => {
  for (const text of ['fecha,descripcion,monto,monto\n2026-10-08,Pago,10,10', 'fecha,descripcion,monto,extra\n2026-10-08,Pago,10,1', 'fecha,descripcion,monto\n2026-10-08,"Pago,10', 'fecha,descripcion,monto\n2026-10-08,"Pago"error,10']) {
    const result = parseBankCsv(text, context);
    assert.equal(result.errors.length, 1);
    assert.deepEqual(result.transactions, []);
  }
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
