import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {parseBankCsv} from '../src/lib/bankCsvParser';

test('downloadable bank template imports both entry and exit with the current parser', () => {
  const csv = readFileSync(new URL('../public/plantilla-movimientos.csv', import.meta.url), 'utf8');
  const result = parseBankCsv(csv, {userId: 'template-user', accountId: 'cuenta-csv-01'});
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].amount, 1500);
  assert.equal(result.transactions[1].amount, -500);
  assert.ok(result.transactions.every(item => item.currency === 'MXN' && item.userId === 'template-user'));
});
