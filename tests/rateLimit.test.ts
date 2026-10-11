import assert from 'node:assert/strict';
import {before, beforeEach, after, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import type {Pool} from 'pg';
import {databaseRateLimit} from '../src/server/rateLimit';
import {applyTestMigrations} from './helpers/migrations';

const db = new PGlite();
const database = {query: (sql: string, values?: unknown[]) => db.query(sql, values)} as unknown as Pick<Pool, 'query'>;
before(async () => {await db.waitReady; await applyTestMigrations(db);});
beforeEach(async () => {await db.exec('TRUNCATE TABLE app_rate_limits');});
after(async () => {await db.close();});

test('concurrent requests through separate limiter instances share one atomic quota', async () => {
  const first = databaseRateLimit(database, 'shared');
  const second = databaseRateLimit(database, 'shared');
  const results = await Promise.all(Array.from({length: 20}, (_, index) => (index % 2 ? first : second).consume('same-account', {max: 3, window: 60})));
  assert.equal(results.filter(result => result.allowed).length, 3);
  for (const result of results.filter(result => !result.allowed)) assert.ok(result.retryAfter! >= 1 && result.retryAfter! <= 60);
  const persisted = await db.query<{count: number}>('SELECT count FROM app_rate_limits');
  assert.equal(persisted.rows[0].count, 4);
  const third = databaseRateLimit(database, 'shared');
  assert.equal((await third.consume('same-account', {max: 3, window: 60})).allowed, false);
});

test('expired windows restart the quota and blocked requests cannot grow the counter without bound', async () => {
  const limiter = databaseRateLimit(database, 'expiry');
  assert.equal((await limiter.consume('key', {max: 1, window: 30})).allowed, true);
  for (let index = 0; index < 10; index++) assert.equal((await limiter.consume('key', {max: 1, window: 30})).allowed, false);
  assert.equal((await db.query<{count: number}>('SELECT count FROM app_rate_limits')).rows[0].count, 2);
  await db.exec("UPDATE app_rate_limits SET expires_at=clock_timestamp()-interval '1 second'");
  const fresh = await limiter.consume('key', {max: 1, window: 30});
  assert.deepEqual(fresh, {allowed: true, retryAfter: null});
  assert.equal((await db.query<{count: number}>('SELECT count FROM app_rate_limits')).rows[0].count, 1);
});

test('quota keys retain hashes and isolate operations without storing account, email or IP text', async () => {
  const sensitive = 'account@example.test:192.0.2.123:synthetic-session';
  assert.equal((await databaseRateLimit(database, 'auth').consume(sensitive, {max: 1, window: 60})).allowed, true);
  assert.equal((await databaseRateLimit(database, 'sat').consume(sensitive, {max: 1, window: 60})).allowed, true);
  const keys = await db.query<{key: string}>('SELECT key FROM app_rate_limits');
  assert.equal(keys.rows.length, 2);
  assert.notEqual(keys.rows[0].key, keys.rows[1].key);
  assert.ok(keys.rows.every(row => /^[a-f0-9]{64}$/.test(row.key)));
  assert.ok(!JSON.stringify(keys.rows).includes('account@example.test'));
  assert.ok(!JSON.stringify(keys.rows).includes('192.0.2.123'));
});

test('invalid quota rules fail before database state changes', async () => {
  const limiter = databaseRateLimit(database);
  for (const rule of [{max: 0, window: 60}, {max: 1.5, window: 60}, {max: 10001, window: 60}, {max: 1, window: 0}, {max: 1, window: 86401}]) await assert.rejects(limiter.consume('invalid', rule));
  assert.equal((await db.query<{count: number}>('SELECT count(*)::int AS count FROM app_rate_limits')).rows[0].count, 0);
});
