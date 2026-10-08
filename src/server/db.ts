import { Pool } from 'pg';
import { HttpError } from './http';

let pool: Pool | undefined;
export function databaseConfigured() {
  if (!process.env.DATABASE_URL || (process.env.BETTER_AUTH_SECRET?.length ?? 0) < 32 || !process.env.BETTER_AUTH_URL) return false;
  try { return ['http:', 'https:'].includes(new URL(process.env.BETTER_AUTH_URL).protocol); }
  catch { return false; }
}
export function getPool() {
  if (!process.env.DATABASE_URL) throw new HttpError(503, 'El entorno funcional necesita PostgreSQL. La demo sigue disponible en /demo.');
  pool ??= new Pool({connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000});
  return pool;
}
