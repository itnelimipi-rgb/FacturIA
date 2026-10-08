import { betterAuth } from 'better-auth';
import { getPool, databaseConfigured } from './db';
import { HttpError } from './http';
import type { Pool } from 'pg';

export function createConfiguredAuth(overrides: {database?: Pool; baseURL?: string; secret?: string; allowSignUp?: boolean} = {}) {
  const baseURL = overrides.baseURL ?? process.env.BETTER_AUTH_URL;
  if (!baseURL) throw new HttpError(503, 'El entorno de cuentas todavía no está configurado.');
  return betterAuth({
    database: overrides.database ?? getPool(), baseURL, secret: overrides.secret ?? process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [baseURL],
    emailAndPassword: { enabled: true, disableSignUp: !(overrides.allowSignUp ?? process.env.ALLOW_SIGNUP === 'true'), minPasswordLength: 12 },
    rateLimit: { enabled: true, window: 60, max: 50 },
    advanced: { useSecureCookies: baseURL.startsWith('https:') },
  });
}
let auth: ReturnType<typeof createConfiguredAuth> | undefined;
export function getAuth() {
  if (!databaseConfigured() || (process.env.BETTER_AUTH_SECRET?.length ?? 0) < 32) {
    throw new HttpError(503, 'Configura DATABASE_URL, BETTER_AUTH_URL y BETTER_AUTH_SECRET para activar el entorno funcional.');
  }
  const instance = auth ?? createConfiguredAuth();
  auth = instance;
  return instance;
}
export async function requireUser(request: Request) {
  const session = await getAuth().api.getSession({headers: request.headers});
  if (!session) throw new HttpError(401, 'Inicia sesión para acceder a tus datos');
  return session.user;
}
