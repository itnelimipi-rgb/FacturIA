import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {getPool} from './db';
import {HttpError} from './http';

/** A single PostgreSQL upsert makes quotas atomic across replicas and restarts. */
export function databaseRateLimit(database: Pick<Pool, 'query'> = getPool(), namespace = 'auth') {
  let calls = 0;
  return {
    async consume(key: string, rule: {window: number; max: number}) {
      if (!Number.isInteger(rule.window) || rule.window < 1 || rule.window > 86400 ||
        !Number.isInteger(rule.max) || rule.max < 1 || rule.max > 10000) throw new Error('Invalid rate limit rule');
      // Never retain IP addresses, emails or session identifiers in this table.
      const digest = createHash('sha256').update(JSON.stringify([namespace, key])).digest('hex');
      const result = await database.query<{count: number; retry: number}>(
        `INSERT INTO app_rate_limits(key,count,window_started_at,expires_at)
         VALUES($1,1,clock_timestamp(),clock_timestamp()+$2*interval '1 second')
         ON CONFLICT(key) DO UPDATE SET
           count=CASE WHEN app_rate_limits.expires_at<=clock_timestamp() THEN 1 ELSE LEAST(app_rate_limits.count+1,$3+1) END,
           window_started_at=CASE WHEN app_rate_limits.expires_at<=clock_timestamp() THEN clock_timestamp() ELSE app_rate_limits.window_started_at END,
           expires_at=CASE WHEN app_rate_limits.expires_at<=clock_timestamp() THEN clock_timestamp()+$2*interval '1 second' ELSE app_rate_limits.expires_at END
         RETURNING count,GREATEST(1,ceil(extract(epoch FROM expires_at-clock_timestamp())))::int AS retry`,
        [digest, rule.window, rule.max],
      );
      // Periodic bounded housekeeping, independent of authentication data.
      if (++calls % 100 === 0) await database.query('DELETE FROM app_rate_limits WHERE key IN (SELECT key FROM app_rate_limits WHERE expires_at<clock_timestamp() LIMIT 1000)');
      const allowed = result.rows[0].count <= rule.max;
      return {allowed, retryAfter: allowed ? null : result.rows[0].retry};
    },
  };
}

const accountLimiters = new Map<string, ReturnType<typeof databaseRateLimit>>();
export async function enforceAccountLimit(userId: string, operation: string, max = 10, window = 60) {
  let limiter = accountLimiters.get(operation);
  if (!limiter) {limiter = databaseRateLimit(getPool(), operation); accountLimiters.set(operation, limiter);}
  const result = await limiter.consume(userId, {max, window});
  if (!result.allowed) throw new HttpError(429, `Demasiadas solicitudes. Intenta de nuevo en ${result.retryAfter} segundos.`);
}
