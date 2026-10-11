import { betterAuth } from 'better-auth';
import { getPool, databaseConfigured } from './db';
import { HttpError } from './http';
import type { Pool } from 'pg';
import { databaseRateLimit } from './rateLimit';
import {sendAuthMail, mailConfigured, type AuthMail} from './mail';

export function createConfiguredAuth(overrides: {database?: Pool; baseURL?: string; secret?: string; allowSignUp?: boolean; sendMail?: (mail: AuthMail) => Promise<void>; requireEmailVerification?: boolean} = {}) {
  const baseURL = overrides.baseURL ?? process.env.BETTER_AUTH_URL;
  if (!baseURL) throw new HttpError(503, 'El entorno de cuentas todavía no está configurado.');
  const database = overrides.database ?? getPool();
  const mailEnabled = !!overrides.sendMail || mailConfigured();
  const mailer = overrides.sendMail ?? sendAuthMail;
  const requireEmailVerification = overrides.requireEmailVerification ?? process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
  if (requireEmailVerification && !mailEnabled) throw new HttpError(503, 'Configura el correo antes de exigir verificación de cuentas.');
  return betterAuth({
    database, baseURL, secret: overrides.secret ?? process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [baseURL],
    emailAndPassword: { enabled: true, disableSignUp: !(overrides.allowSignUp ?? process.env.ALLOW_SIGNUP === 'true'), minPasswordLength: 12,
      requireEmailVerification, resetPasswordTokenExpiresIn: 900, revokeSessionsOnPasswordReset: true,
      ...(mailEnabled ? {sendResetPassword: async ({user, url}: {user: {email: string}; url: string}) => mailer({to: user.email, url, kind: 'password-reset'})} : {}),
    },
    ...(mailEnabled ? {emailVerification: {sendOnSignUp: true, autoSignInAfterVerification: false, expiresIn: 3600,
      sendVerificationEmail: async ({user, url}: {user: {email: string}; url: string}) => mailer({to: user.email, url, kind: 'verification'}),
    }} : {}),
    rateLimit: { enabled: true, window: 60, max: 50, customStorage: databaseRateLimit(database) },
    advanced: { useSecureCookies: baseURL.startsWith('https:'),
      // A long-lived Node service can dispatch SMTP without making an existing
      // account's reset request slower than a nonexistent account's request.
      ...(overrides.sendMail ? {} : {backgroundTasks: {handler: (task: Promise<unknown>) => {
        void task.catch(() => console.error('FacturIA auth mail delivery failed'));
      }}}),
    },
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
