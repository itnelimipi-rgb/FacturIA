import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localConnection, assertTemporaryDatabase, archiveWithoutExtensions } from '../scripts/verify-postgres-recovery.mjs';

test('recovery refuses remote hosts, other clusters, privileged roles and connection options before connecting', () => {
  for (const value of [undefined, 'postgresql://facturia_app:fake@remote.example:54329/facturia_staging',
    'postgresql://facturia_app:fake@localhost:54329/facturia_staging', 'postgresql://facturia_app:fake@127.0.0.1:5432/facturia_staging',
    'postgresql://facturia_local:fake@127.0.0.1:54329/facturia_staging', 'postgresql://facturia_app:fake@127.0.0.1:54329/postgres',
    'postgresql://facturia_app@127.0.0.1:54329/facturia_staging', 'postgresql://facturia_app:fake@127.0.0.1:54329/facturia_staging?sslmode=disable']) {
    assert.throws(() => localConnection(value));
  }
  assert.deepEqual(localConnection('postgresql://facturia_app:fake%40password@127.0.0.1:54329/facturia_staging'), {
    host: '127.0.0.1', port: 54329, database: 'facturia_staging', user: 'facturia_app', password: 'fake@password', ssl: false, connectionTimeoutMillis: 10_000
  });
});

test('cleanup requires a generated UUID name and evidence that this execution created it', () => {
  const name = 'facturia_restore_check_15934317-52d6-4fd9-a19f-887b68dac20c';
  assert.equal(assertTemporaryDatabase(name, true), name);
  for (const target of ['facturia_staging', 'postgres', 'facturia_restore_check_existing', `${name};DROP DATABASE facturia_staging`, 'facturia_restore_check_15934317-52d6-1fd9-a19f-887b68dac20c']) {
    assert.throws(() => assertTemporaryDatabase(target, true));
  }
  assert.throws(() => assertTemporaryDatabase(name, false));
});

test('restore inventory omits extension creation and extension comments while retaining application data and constraints', () => {
  const inventory = [
    '; Archive created by pg_dump',
    '2; 3079 16384 EXTENSION - plpgsql postgres',
    '340; 0 0 COMMENT - EXTENSION plpgsql postgres',
    '215; 1259 16400 TABLE public app_documents facturia_app',
    '333; 0 16400 TABLE DATA public app_documents facturia_app',
    '319; 2606 16412 FK CONSTRAINT public app_documents app_documents_user_id_fkey facturia_app',
    '321; 0 0 COMMENT public TABLE app_documents facturia_app'
  ].join('\n');
  const filtered = archiveWithoutExtensions(inventory);
  assert.ok(!filtered.includes('EXTENSION'));
  assert.ok(filtered.includes('TABLE DATA public app_documents'));
  assert.ok(filtered.includes('FK CONSTRAINT'));
  assert.ok(filtered.includes('COMMENT public TABLE'));
});
