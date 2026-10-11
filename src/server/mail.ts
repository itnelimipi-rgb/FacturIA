import nodemailer from 'nodemailer';
import {z} from 'zod';
import {HttpError} from './http';
import {createHash} from 'node:crypto';
import {enforceAccountLimit} from './rateLimit';

export type AuthMail = {to: string; kind: 'verification' | 'password-reset'; url: string};
const smtpSchema = z.object({
  host: z.string().trim().min(1).max(253).refine(value => !/[\s/:]/.test(value)),
  port: z.coerce.number().int().min(1).max(65535),
  from: z.email(), user: z.string().min(1), password: z.string().min(1),
});
export function smtpConfigured() {
  return smtpSchema.safeParse({host: process.env.SMTP_HOST, port: process.env.SMTP_PORT,
    from: process.env.SMTP_FROM, user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD}).success;
}
export function mailConfigured() {
  const provider = process.env.MAIL_PROVIDER ?? (smtpConfigured() ? 'smtp' : 'disabled');
  return provider === 'resend'
    ? z.string().min(8).max(1000).safeParse(process.env.RESEND_API_KEY).success && z.email().safeParse(process.env.EMAIL_FROM).success
    : provider === 'smtp' && smtpConfigured();
}
let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
export async function sendAuthMail(mail: AuthMail) {
  if (!mailConfigured()) throw new HttpError(503, 'El envío de correo todavía no está configurado.');
  const base = new URL(process.env.BETTER_AUTH_URL!);
  const target = new URL(mail.url);
  if (target.origin !== base.origin || !z.email().safeParse(mail.to).success) throw new Error('Invalid authentication mail');
  const dailyLimit = Number(process.env.MAIL_DAILY_LIMIT ?? '20');
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 100) throw new Error('Invalid mail daily limit');
  await enforceAccountLimit('workspace', 'auth-mail-daily', dailyLimit, 86400);
  const action = mail.kind === 'verification' ? 'Verifica tu correo' : 'Restablece tu contraseña';
  const text = `${action} en FacturIA:\n\n${mail.url}\n\nSi no solicitaste esta acción, puedes ignorar este correo.`;
  if (process.env.MAIL_PROVIDER === 'resend') {
    const idempotencyKey = createHash('sha256').update(JSON.stringify(mail)).digest('hex');
    try {
      const response = await fetch('https://api.resend.com/emails', {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Idempotency-Key': idempotencyKey},
        body: JSON.stringify({from: process.env.EMAIL_FROM, to: [mail.to], subject: `FacturIA · ${action}`, text}),
      });
      // Delivery is asynchronous at the provider. A successful acceptance is
      // never presented as proof that the recipient already received the email.
      if (!response.ok) {await response.body?.cancel(); throw new Error('AuthMailDeliveryError');}
      await response.body?.cancel();
      return;
    } catch {throw new Error('AuthMailDeliveryError');}
  }
  const config = smtpSchema.parse({host: process.env.SMTP_HOST, port: process.env.SMTP_PORT,
    from: process.env.SMTP_FROM, user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD});
  transport ??= nodemailer.createTransport({host: config.host, port: config.port,
    secure: config.port === 465, requireTLS: true,
    auth: {user: config.user, pass: config.password},
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  });
  try {
    await transport.sendMail({from: config.from, to: mail.to, subject: `FacturIA · ${action}`,
      text,
    });
  } catch {throw new Error('AuthMailDeliveryError');}
}
