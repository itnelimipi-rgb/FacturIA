import { NextRequest, NextResponse } from 'next/server';
import { MatchingEngineService } from '../../../lib/MatchingEngineService';
import { BankTransaction, CfdiRecord } from '../../../lib/types';

export async function POST(req: NextRequest) {
  try {
    const { transaction, transactions, cfdis } = await req.json();

    // Si se evalúa una sola transacción
    if (transaction && cfdis) {
      const result = MatchingEngineService.evaluateTransaction(
        {
          id: transaction.id,
          amount: transaction.amount,
          date: transaction.date,
          type: transaction.amount >= 0 ? 'ingreso' : 'egreso'
        },
        cfdis.map((c: CfdiRecord) => ({
          id: c.id,
          total: c.total,
          fecha: c.fechaEmision,
          rfc: c.rfcEmisor,
          isEfos: c.isEfos
        }))
      );

      return NextResponse.json({ success: true, result });
    }

    // Si se evalúa en lote (batch)
    if (transactions && cfdis) {
      const evaluated = MatchingEngineService.evaluateBatch(transactions, cfdis);
      const metrics = MatchingEngineService.calculateCashFlowShieldMetrics(evaluated, cfdis);

      return NextResponse.json({
        success: true,
        transactions: evaluated,
        metrics
      });
    }

    return NextResponse.json({ error: 'Faltan parámetros de entrada' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Error en evaluación de motor de matching' },
      { status: 500 }
    );
  }
}
