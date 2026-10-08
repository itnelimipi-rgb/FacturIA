import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatoria para aplicar migraciones');
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, max: 1});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('facturia:migrations'))");
  await client.query('CREATE TABLE IF NOT EXISTS app_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const directory = new URL('../db/migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    const existing = await client.query('SELECT name FROM app_migrations WHERE name=$1', [name]);
    if (existing.rowCount) continue;
    await client.query(readFileSync(new URL(name, directory), 'utf8'));
    await client.query('INSERT INTO app_migrations(name) VALUES($1)', [name]);
    console.log(`Migración aplicada: ${name}`);
  }
  await client.query('COMMIT');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally {client.release(); await pool.end();}
