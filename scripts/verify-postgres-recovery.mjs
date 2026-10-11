import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const dataDirectory = path.join(root, '.facturia-local/postgres/data');
const backupsDirectory = path.join(root, '.facturia-local/backups');
const postgresBin = 'C:/Program Files/PostgreSQL/18/bin';
const requiredTables = ['user', 'session', 'account', 'verification', 'app_profiles', 'app_documents', 'app_bank_transactions', 'app_audit_events', 'app_migrations'];
const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`;
const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Restrict this rehearsal to the private cluster configured for this repository. */
export function localConnection(value) {
  const url = new URL(value ?? '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== '54329' ||
      url.pathname !== '/facturia_staging' || decodeURIComponent(url.username) !== 'facturia_app' || !url.password || url.search || url.hash) {
    throw new Error('La prueba sólo admite la conexión local aislada de FacturIA.');
  }
  return {host: '127.0.0.1', port: 54329, database: 'facturia_staging', user: 'facturia_app', password: decodeURIComponent(url.password), ssl: false, connectionTimeoutMillis: 10_000};
}

/** No user-supplied database name is accepted for creation or deletion. */
export function assertTemporaryDatabase(name, createdByThisRun) {
  if (!createdByThisRun || !/^facturia_restore_check_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(name)) {
    throw new Error('La base temporal no pertenece a esta ejecución.');
  }
  return name;
}

/** The existing template supplies plpgsql; never create or alter extensions. */
export function archiveWithoutExtensions(list) {
  return list.split(/\r?\n/).filter(line => !/^\d+; \d+ \d+ (?:EXTENSION |COMMENT - EXTENSION )/.test(line)).join('\n');
}

function privateChildEnvironment(connection) {
  const childEnvironment = {...process.env, PGHOST: connection.host, PGPORT: String(connection.port), PGDATABASE: connection.database,
    PGUSER: connection.user, PGPASSWORD: connection.password, PGCONNECT_TIMEOUT: '10', PGSSLMODE: 'disable'};
  // libpq treats even an empty PGSERVICE as a service name. Remove inherited
  // service/options selectors rather than requesting a nonexistent empty service.
  for (const name of ['PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']) delete childEnvironment[name];
  return childEnvironment;
}

async function runPostgresTool(program, args, connection, {capture = false} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(postgresBin, `${program}.exe`), args, {env: privateChildEnvironment(connection), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let exceeded = false;
    const timer = setTimeout(() => { exceeded = true; child.kill(); }, 120_000);
    child.stdout.on('data', chunk => {
      if (capture) stdout += chunk.toString('utf8');
      if (stdout.length > 1_048_576) { exceeded = true; child.kill(); }
    });
    // Tool diagnostics may contain sensitive SQL or file contents. Never forward them.
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); reject(new Error(`No se pudo iniciar ${program}.`)); });
    child.once('close', code => {
      clearTimeout(timer);
      if (exceeded || code !== 0) reject(new Error(`${program} no completó la operación (salida ${code ?? 'desconocida'}).`));
      else resolve(stdout);
    });
  });
}

function normalizedDirectory(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function verifyAdminCluster(client) {
  const identity = (await client.query("SELECT current_user AS role,current_database() AS database,current_setting('data_directory') AS directory,current_setting('port') AS port,current_setting('listen_addresses') AS addresses,current_setting('server_version_num') AS version")).rows[0];
  assert.equal(identity.role, 'facturia_local');
  assert.equal(identity.database, 'postgres');
  assert.equal(normalizedDirectory(identity.directory), normalizedDirectory(dataDirectory));
  assert.equal(identity.port, '54329');
  assert.equal(identity.addresses, '127.0.0.1');
  assert.ok(Number(identity.version) >= 180000 && Number(identity.version) < 190000);
}

async function schema(client) {
  const tables = (await client.query("SELECT c.relname AS name,c.relkind,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','m') ORDER BY c.relname")).rows;
  for (const name of requiredTables) assert.ok(tables.some(table => table.name === name), `Falta una tabla requerida: ${name}`);
  const columns = (await client.query("SELECT c.relname AS table_name,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','S') ORDER BY c.relname,a.attnum")).rows;
  const constraints = (await client.query("SELECT c.relname AS table_name,k.conname,k.convalidated,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname")).rows;
  assert.ok(constraints.every(constraint => constraint.convalidated), 'Hay restricciones sin validar.');
  const indexes = (await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
  const views = (await client.query("SELECT c.relname AS name,c.relkind,pg_get_viewdef(c.oid,true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY c.relname")).rows;
  const functions = (await client.query("SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.proname,arguments")).rows;
  const triggers = (await client.query("SELECT c.relname AS table_name,t.tgname,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname")).rows;
  const policies = (await client.query("SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows;
  const enums = (await client.query("SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder")).rows;
  const sequences = (await client.query("SELECT sequence_name,data_type,start_value,minimum_value,maximum_value,increment,cycle_option FROM information_schema.sequences WHERE sequence_schema='public' ORDER BY sequence_name")).rows;
  const extensions = (await client.query('SELECT extname,extversion FROM pg_extension ORDER BY extname')).rows;
  assert.deepEqual(extensions.map(extension => extension.extname), ['plpgsql'], 'Revisar manualmente las extensiones antes de recuperar esta base.');
  const extraSchemas = (await client.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg_%'")).rows;
  assert.equal(extraSchemas.length, 0, 'Revisar manualmente los esquemas adicionales antes de recuperar esta base.');
  return {tables, columns, constraints, indexes, views, functions, triggers, policies, enums, sequences, extensions};
}

async function contentFingerprints(client, definition) {
  const result = [];
  for (const table of definition.tables) {
    const fingerprint = (await client.query(`SELECT count(*)::text AS rows,md5(COALESCE(string_agg(row_hash,E'\n' ORDER BY row_hash),'')) AS content FROM (SELECT md5(to_jsonb(record)::text) AS row_hash FROM public.${quoteIdentifier(table.name)} record) rows`)).rows[0];
    result.push({table: table.name, ...fingerprint});
  }
  for (const sequence of definition.sequences) {
    const state = (await client.query(`SELECT last_value::text,is_called FROM public.${quoteIdentifier(sequence.sequence_name)}`)).rows[0];
    result.push({sequence: sequence.sequence_name, ...state});
  }
  return result;
}

async function exerciseConstraints(client) {
  const ownerA = `recovery-a-${randomUUID()}`;
  const ownerB = `recovery-b-${randomUUID()}`;
  const doc = `recovery-doc-${randomUUID()}`;
  const uuid = randomUUID();
  let checked = 0;
  await client.query('BEGIN');
  try {
    await client.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3),($4,$5,$6)', [ownerA, 'Recovery A', `${ownerA}@example.test`, ownerB, 'Recovery B', `${ownerB}@example.test`]);
    await client.query('INSERT INTO app_profiles(user_id,rfc,business_name,regime_code) VALUES($1,$2,$3,$4),($5,$6,$7,$8)', [ownerA, 'XAXX010101000', 'Recovery A', '626', ownerB, 'XEXX010101000', 'Recovery B', '626']);
    await client.query('INSERT INTO app_documents(id,user_id,uuid_sat,payload) VALUES($1,$2,$3,$4)', [doc, ownerA, uuid, '{}']);
    async function rejects(sql, values, code) {
      await client.query('SAVEPOINT constraint_probe');
      try { await client.query(sql, values); assert.fail('La restricción aceptó datos inválidos.'); }
      catch (error) { assert.equal(error.code, code); checked++; }
      finally { await client.query('ROLLBACK TO SAVEPOINT constraint_probe'); }
    }
    await rejects('INSERT INTO app_bank_transactions(id,user_id,payload,matched_cfdi_id) VALUES($1,$2,$3,$4)', [randomUUID(), ownerB, '{}', doc], '23503');
    await rejects('INSERT INTO app_documents(id,user_id,uuid_sat,payload) VALUES($1,$2,$3,$4)', [randomUUID(), ownerA, uuid, '{}'], '23505');
    await client.query('INSERT INTO app_bank_transactions(id,user_id,payload,matched_cfdi_id) VALUES($1,$2,$3,$4)', [randomUUID(), ownerA, '{}', doc]);
    await rejects('INSERT INTO app_bank_transactions(id,user_id,payload,matched_cfdi_id) VALUES($1,$2,$3,$4)', [randomUUID(), ownerA, '{}', doc], '23505');
    await rejects('UPDATE app_profiles SET rfc=$1 WHERE user_id=$2', ['INVALID', ownerB], '23514');
  } finally { await client.query('ROLLBACK'); }
  return checked;
}

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function loadSmoke(pool, repository) {
  const owner = `recovery-load-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const documents = Array.from({length: 200}, (_, index) => ({id: `${owner}-doc-${index}`, userId: owner, uuidSat: randomUUID(), rfcEmisor: 'AAA010101AAA', rfcReceptor: 'XAXX010101000', total: 100 + index, subtotal: 100 + index, iva: 0, retenciones: 0, fechaEmision: '2026-10-01T12:00:00', tipoComprobante: 'I', statusSat: 'no_verificado', isEfos: false, sourceType: 'xml', currency: 'MXN'}));
  const transactions = Array.from({length: 200}, (_, index) => ({id: `${owner}-bank-${index}`, userId: owner, accountId: 'load-check', amount: -(100 + index), currency: 'MXN', date: '2026-10-01', description: 'Movimiento sintético para medir conciliación', status: 'discrepancia'}));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [owner, 'Recovery load smoke', `${owner}@example.test`]);
    await client.query('INSERT INTO app_profiles(user_id,rfc,business_name,regime_code,created_at) VALUES($1,$2,$3,$4,$5)', [owner, 'XAXX010101000', 'Recovery load smoke', '626', createdAt]);
    await client.query('INSERT INTO app_documents(id,user_id,uuid_sat,payload) SELECT item.id,$1,item.uuid_sat,item.payload FROM jsonb_to_recordset($2::jsonb) item(id text,uuid_sat uuid,payload jsonb)', [owner, JSON.stringify(documents.map(payload => ({id: payload.id, uuid_sat: payload.uuidSat, payload})))]);
    await client.query('INSERT INTO app_bank_transactions(id,user_id,payload) SELECT item.id,$1,item.payload FROM jsonb_to_recordset($2::jsonb) item(id text,payload jsonb)', [owner, JSON.stringify(transactions.map(payload => ({id: payload.id, payload})))]);
    await client.query('COMMIT');
    const durations = [];
    const start = performance.now();
    async function read() {
      const started = performance.now();
      const result = await repository.get(owner);
      assert.equal(result.cfdis.length, 200);
      assert.equal(result.transactions.length, 200);
      assert.ok(result.transactions.every(transaction => transaction.status === 'conciliado'));
      durations.push(performance.now() - started);
    }
    for (let batch = 0; batch < 10; batch++) await Promise.all([read(), read()]);
    const elapsedMs = performance.now() - start;
    durations.sort((a, b) => a - b);
    return {documents: 200, transactions: 200, reads: durations.length, concurrency: 2, elapsedMs: Math.round(elapsedMs), p50Ms: Math.round(durations[Math.ceil(durations.length * 0.5) - 1]), p95Ms: Math.round(durations[Math.ceil(durations.length * 0.95) - 1])};
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally {
    await client.query('DELETE FROM "user" WHERE id=$1', [owner]);
    client.release();
  }
}

export async function verifyRecovery(args = process.argv.slice(2)) {
  assert.ok(args.every(arg => ['--keep-restored', '--load-smoke'].includes(arg)), 'Opciones admitidas: --keep-restored y --load-smoke.');
  const connection = localConnection(process.env.DATABASE_URL);
  const adminPassword = (await readFile(path.join(root, '.facturia-local/postgres/bootstrap-password.local'), 'utf8')).trim();
  assert.match(adminPassword, /^[0-9a-f]{64}$/);
  const admin = new pg.Client({...connection, database: 'postgres', user: 'facturia_local', password: adminPassword});
  const source = new pg.Client(connection);
  const database = `facturia_restore_check_${randomUUID()}`;
  assertTemporaryDatabase(database, true);
  const fileId = `${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${randomUUID()}`;
  const backupFile = path.join(backupsDirectory, `facturia-${fileId}.dump`);
  const archiveList = path.join(backupsDirectory, `facturia-${fileId}.list`);
  const manifestFile = path.join(backupsDirectory, `facturia-${fileId}.json`);
  let created = false;
  let succeeded = false;
  let pool;
  let report;
  let failure;
  let stage = 'verificar conexión local';
  const started = performance.now();
  try {
    await admin.connect();
    await verifyAdminCluster(admin);
    await source.connect();
    const role = (await source.query('SELECT current_user AS name,current_database() AS database,rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert.equal(role.name, 'facturia_app');
    assert.equal(role.database, 'facturia_staging');
    assert.ok(!role.rolsuper && !role.rolcreatedb && !role.rolcreaterole && !role.rolreplication);
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await source.query("SET LOCAL statement_timeout='60s'");
    const definition = await schema(source);
    const fingerprints = await contentFingerprints(source, definition);
    const owners = (await source.query('SELECT p.user_id,(SELECT count(*)::int FROM app_documents d WHERE d.user_id=p.user_id) AS documents,(SELECT count(*)::int FROM app_bank_transactions t WHERE t.user_id=p.user_id) AS transactions FROM app_profiles p ORDER BY p.user_id')).rows;
    const originalXml = (await source.query('SELECT user_id,id,md5(raw_xml) AS content FROM app_documents WHERE raw_xml IS NOT NULL ORDER BY id LIMIT 1')).rows[0];
    const snapshot = (await source.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    await mkdir(backupsDirectory, {recursive: true});
    assert.equal(normalizedDirectory(await realpath(path.join(root, '.facturia-local'))), normalizedDirectory(path.join(root, '.facturia-local')));
    assert.equal(normalizedDirectory(await realpath(backupsDirectory)), normalizedDirectory(backupsDirectory));
    // Reserve a new path; pg_dump writes only the file reserved by this execution.
    await (await open(backupFile, 'wx', 0o600)).close();
    stage = 'crear respaldo consistente';
    await runPostgresTool('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--snapshot', snapshot, '--file', backupFile], connection);
    await source.query('COMMIT');
    const checksum = await fileHash(backupFile);
    const inventory = await runPostgresTool('pg_restore', ['--list', backupFile], connection, {capture: true});
    await writeFile(archiveList, archiveWithoutExtensions(inventory), {encoding: 'utf8', flag: 'wx', mode: 0o600});
    stage = 'crear clon nuevo';
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
    await admin.query(`CREATE DATABASE ${quoteIdentifier(database)} OWNER facturia_app ENCODING 'UTF8' TEMPLATE template0`);
    created = true;
    stage = 'restaurar clon';
    const restoredConnection = {...connection, database};
    await runPostgresTool('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '--use-list', archiveList, '--dbname', database, backupFile], restoredConnection);
    assert.equal(await fileHash(backupFile), checksum);
    pool = new pg.Pool({...restoredConnection, max: 3});
    const restored = await pool.connect();
    let constraintsChecked;
    try {
      stage = 'comparar esquema y contenido';
      const restoredDefinition = await schema(restored);
      assert.deepEqual(restoredDefinition, definition);
      assert.deepEqual(await contentFingerprints(restored, restoredDefinition), fingerprints);
      const foreignOwners = (await restored.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND c.relkind IN ('r','p','m','v','S') AND r.rolname<>$1", [connection.user])).rows;
      assert.equal(foreignOwners.length, 0);
      stage = 'probar restricciones restauradas';
      constraintsChecked = await exerciseConstraints(restored);
      assert.deepEqual(await contentFingerprints(restored, restoredDefinition), fingerprints);
    } finally { restored.release(); }
    stage = 'leer datos con repositorio de aplicación';
    const {WorkspaceRepository} = await import('../src/server/workspaceRepository.ts');
    const repository = new WorkspaceRepository(pool);
    for (const owner of owners) {
      const workspace = await repository.get(owner.user_id);
      assert.equal(workspace.profile.id, owner.user_id);
      assert.equal(workspace.cfdis.length, owner.documents);
      assert.equal(workspace.transactions.length, owner.transactions);
      assert.ok([...workspace.cfdis, ...workspace.transactions].every(record => record.userId === owner.user_id));
      assert.ok(workspace.cfdis.every(document => document.rawXml === undefined));
    }
    let xmlRead = false;
    if (originalXml) {
      const exported = await repository.getExport(originalXml.user_id);
      const restoredXml = exported.cfdis.find(document => document.id === originalXml.id)?.rawXml;
      assert.ok(typeof restoredXml === 'string');
      assert.equal(createHash('md5').update(restoredXml).digest('hex'), originalXml.content);
      xmlRead = true;
    }
    const smoke = args.includes('--load-smoke') ? await loadSmoke(pool, repository) : undefined;
    const finalConnection = await pool.connect();
    try { assert.deepEqual(await contentFingerprints(finalConnection, definition), fingerprints); }
    finally { finalConnection.release(); }
    report = {status: 'verified', completedAt: new Date().toISOString(), sourceDatabase: connection.database, restoredDatabase: database,
      backup: path.relative(root, backupFile).replaceAll('\\', '/'), backupBytes: (await stat(backupFile)).size, backupSha256: checksum,
      tables: fingerprints.filter(row => row.table).map(({table, rows}) => ({table, rows: Number(rows)})),
      schemaSha256: sha256(JSON.stringify(definition)), contentFingerprintsMatch: true, constraintsChecked,
      workspaceReads: owners.length, originalXmlRead: xmlRead, loadSmoke: smoke, durationMs: Math.round(performance.now() - started),
      restoredDatabaseKept: args.includes('--keep-restored')};
    succeeded = true;
  } catch {
    // Do not expose SQL errors, account/password hashes, XML, credentials or URLs.
    failure = new Error(`No se completó la recuperación local al ${stage}. El origen no se reemplazó.`);
  } finally {
    if (pool) await pool.end();
    await source.end().catch(() => {});
    try {
      if (created && !(succeeded && args.includes('--keep-restored'))) {
        assertTemporaryDatabase(database, created);
        await verifyAdminCluster(admin);
        const owner = (await admin.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1', [database])).rows[0]?.owner;
        assert.equal(owner, 'facturia_app');
        await admin.query(`DROP DATABASE ${quoteIdentifier(database)}`);
      }
    } catch {
      failure = new Error(`No se completó la limpieza del clon ${database}. La base de origen no se reemplazó.`);
    } finally { await admin.end(); }
  }
  if (failure) throw failure;
  await writeFile(manifestFile, `${JSON.stringify(report, null, 2)}\n`, {encoding: 'utf8', flag: 'wx', mode: 0o600});
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRecovery().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
    console.error(error.message.startsWith('No se completó') ? error.message : 'No se inició la recuperación: revisar PostgreSQL local, conexión y opciones. No se imprimen datos privados.');
    process.exitCode = 1;
  });
}
