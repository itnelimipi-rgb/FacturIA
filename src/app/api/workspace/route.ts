import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getPool } from '../../../server/db';
import { requireUser } from '../../../server/auth';
import { namespacedTransactionId, WorkspaceRepository } from '../../../server/workspaceRepository';
import { assertSameOrigin, errorResponse, HttpError, readJson } from '../../../server/http';
import { profileInputSchema, manualDocumentSchema, transactionSchema, cfdiSchema, WORKSPACE_TRANSACTION_LIMIT } from '../../../lib/validation';
import { XmlCfdiParser } from '../../../lib/xmlParser';
import type { CfdiRecord } from '../../../lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const actionSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('profile'), profile: profileInputSchema}),
  z.object({action: z.literal('xml'), rawXml: z.string().min(1).max(2_000_000)}),
  z.object({action: z.literal('manual'), document: manualDocumentSchema}),
  z.object({action: z.literal('transactions'), transactions: z.array(transactionSchema).min(1).max(WORKSPACE_TRANSACTION_LIMIT)}),
  z.object({action: z.literal('resolve'), transactionId: z.string().min(1).max(200), cfdiId: z.string().min(1).max(200)}),
  z.object({action: z.literal('unmatch'), transactionId: z.string().min(1).max(200)}),
  z.object({action: z.literal('resumeReconciliation'), transactionId: z.string().min(1).max(200)}),
]);
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return Response.json(await new WorkspaceRepository(getPool()).get(user.id), {headers: {'Cache-Control': 'no-store'}});
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const input = actionSchema.parse(await readJson(request));
    const repository = new WorkspaceRepository(getPool());
    if (input.action === 'profile') return Response.json(await repository.saveProfile(user.id, input.profile));
    const snapshot = await repository.get(user.id);
    if (!snapshot.profile) throw new HttpError(409, 'Configura primero tu perfil fiscal');
    switch (input.action) {
      case 'xml': {
        const parsed = XmlCfdiParser.parse(input.rawXml, user.id);
        if (!parsed.success || !parsed.cfdi) throw new HttpError(400, parsed.error || 'CFDI inválido');
        const document = cfdiSchema.parse(parsed.cfdi);
        if (document.rfcEmisor !== snapshot.profile.rfc && document.rfcReceptor !== snapshot.profile.rfc) throw new HttpError(400, 'El RFC de tu perfil no aparece como emisor ni receptor');
        document.isEfos = false;
        document.statusSat = 'no_verificado';
        return Response.json(await repository.addDocument(user.id, document, input.rawXml));
      }
      case 'manual': {
        const document: CfdiRecord = {...input.document, id: randomUUID(), userId: user.id, uuidSat: '', rfcReceptor: snapshot.profile.rfc,
          total: Math.round((input.document.subtotal + input.document.iva - input.document.retenciones) * 100) / 100,
          tipoComprobante: 'I', statusSat: 'no_verificado', isEfos: false, sourceType: 'manual'};
        return Response.json(await repository.addDocument(user.id, cfdiSchema.parse(document)));
      }
      case 'transactions': {
        const transactions = input.transactions.map(tx => ({...tx, userId: user.id, id: namespacedTransactionId(user.id, tx.id), status: 'discrepancia' as const, matchedCfdiId: null, candidateCfdiIds: [], reconciliationLocked: false}));
        return Response.json(await repository.addTransactions(user.id, transactions));
      }
      case 'resolve': return Response.json(await repository.resolve(user.id, input.transactionId, input.cfdiId));
      case 'unmatch': return Response.json(await repository.unmatch(user.id, input.transactionId));
      case 'resumeReconciliation': return Response.json(await repository.resumeReconciliation(user.id, input.transactionId));
    }
  } catch (error) { return errorResponse(error); }
}
