import { databaseConfigured, getPool } from '../../../server/db';
import { getAuth } from '../../../server/auth';

export const dynamic = 'force-dynamic';
export async function GET() {
  if (!databaseConfigured()) {
    if (process.env.DATABASE_URL || process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_SECRET) {
      return Response.json({status: 'unavailable', mode: 'workspace'}, {status: 503});
    }
    return Response.json({status: 'ok', mode: 'demo', workspace: 'not_configured'});
  }
  try {
    getAuth();
    await getPool().query('SELECT 1 FROM "user", session, account, verification, app_profiles, app_documents, app_bank_transactions, app_audit_events LIMIT 0');
    return Response.json({status: 'ok', mode: 'workspace'});
  } catch { return Response.json({status: 'unavailable', mode: 'workspace'}, {status: 503}); }
}
