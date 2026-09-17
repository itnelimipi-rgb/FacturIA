import { MatchingResult, CashFlowMetrics, BankTransaction, CfdiRecord } from './types';

export interface BankTxInput {
  id: string;
  amount: number;
  date: Date | string;
  type: 'ingreso' | 'egreso';
}

export interface CfdiInput {
  id: string;
  total: number;
  fecha: Date | string;
  rfc: string;
  isEfos: boolean;
}

export class MatchingEngineService {
  /**
   * Evalúa de forma determinista y pura la conciliación de un movimiento bancario
   * frente a un conjunto de comprobantes CFDI candidatos.
   *
   * Reglas de negocio:
   * 1. Detección inmediata de EFOS (Art. 69-B del SAT) -> Discrepancia con alerta roja.
   * 2. Ventana de tolerancia: +/- 3 días naturales y margen de centavos <= 0.01.
   * 3. Estados:
   *    - 1 match exacto => 'conciliado'
   *    - >1 matches exactos => 'ambiguo' (requiere selección de usuario)
   *    - 0 matches => 'discrepancia' (movimiento sin factura / no deducible)
   */
  static evaluateTransaction(
    bankTx: BankTxInput,
    cfdis: CfdiInput[]
  ): MatchingResult {
    // Conversión segura de fecha bancaria
    const bankDate = typeof bankTx.date === 'string' ? new Date(bankTx.date) : bankTx.date;
    const absBankAmount = Math.abs(bankTx.amount);

    // 1. Detección inmediata de EFOS en candidatos vinculados o coincidentes
    const efosHit = cfdis.find(c => c.isEfos);
    if (efosHit) {
      return {
        status: 'discrepancia',
        alertReason: `Alerta EFOS Art. 69-B en RFC: ${efosHit.rfc} (Empresa que Factura Operaciones Simuladas)`
      };
    }

    // 2. Filtro estricto: Tolerancia de +/- 3 días naturales y coincidencia de monto exacta (márgen centavos <= 0.01)
    const exactMatches = cfdis.filter(c => {
      const cfdiDate = typeof c.fecha === 'string' ? new Date(c.fecha) : c.fecha;
      const amountDiff = Math.abs(c.total - absBankAmount);
      // Diferencia en días naturales normalizando horas a días completos
      const timeDiffMs = Math.abs(cfdiDate.getTime() - bankDate.getTime());
      const dayDiff = timeDiffMs / (1000 * 3600 * 24);

      return amountDiff <= 0.01 && dayDiff <= 3.0001;
    });

    // 3. Clasificación de los tres estados deterministas
    if (exactMatches.length === 1) {
      return {
        status: 'conciliado',
        matchedCfdiId: exactMatches[0].id
      };
    } else if (exactMatches.length > 1) {
      return {
        status: 'ambiguo',
        candidateCfdiIds: exactMatches.map(m => m.id)
      };
    } else {
      return {
        status: 'discrepancia',
        alertReason: 'Movimiento bancario sin comprobante fiscal CFDI correspondiente'
      };
    }
  }

  /**
   * Cálculo determinista del "Escudo de Flujo de Caja" y métricas fiscales en tiempo real.
   * CERO llamadas a LLM: todas las operaciones matemáticas se ejecutan con precisión pura.
   */
  static calculateCashFlowShieldMetrics(
    transactions: BankTransaction[],
    cfdis: CfdiRecord[]
  ): CashFlowMetrics {
    let totalBankBalance = 0;
    let totalIncome = 0;
    let totalExpense = 0;
    let nonDeductibleExpenseDiscrepancies = 0;
    let projectedRetentionsResico = 0;

    let conciliadoCount = 0;
    let ambiguoCount = 0;
    let discrepanciaCount = 0;

    // Mapa de CFDIs para consulta O(1)
    const cfdiMap = new Map<string, CfdiRecord>();
    for (const c of cfdis) {
      cfdiMap.set(c.id, c);
    }

    for (const tx of transactions) {
      const amount = tx.amount;
      totalBankBalance += amount;

      if (amount > 0) {
        totalIncome += amount;
      } else {
        totalExpense += Math.abs(amount);
      }

      if (tx.status === 'conciliado') {
        conciliadoCount++;
        // Si está conciliado, acumulamos retenciones reales del comprobante
        if (tx.matchedCfdiId && cfdiMap.has(tx.matchedCfdiId)) {
          const matched = cfdiMap.get(tx.matchedCfdiId)!;
          projectedRetentionsResico += Number(matched.retenciones || 0);
        }
      } else if (tx.status === 'ambiguo') {
        ambiguoCount++;
      } else {
        discrepanciaCount++;
        // Si es un egreso (gasto) y cae en discrepancia, es dinero que salió del banco sin comprobante deducible
        if (amount < 0) {
          nonDeductibleExpenseDiscrepancies += Math.abs(amount);
        }
      }
    }

    // Impacto fiscal directo estimado de gastos no deducibles:
    // En México para personas morales / físicas con actividad empresarial:
    // 30% ISR directo + 16% de IVA no acreditable = ~46% del monto no deducible
    const nonDeductibleImpactEstimated = Math.round(nonDeductibleExpenseDiscrepancies * 0.46 * 100) / 100;

    return {
      totalBankBalance: Math.round(totalBankBalance * 100) / 100,
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpense: Math.round(totalExpense * 100) / 100,
      nonDeductibleExpenseDiscrepancies: Math.round(nonDeductibleExpenseDiscrepancies * 100) / 100,
      nonDeductibleImpactEstimated,
      projectedRetentionsResico: Math.round(projectedRetentionsResico * 100) / 100,
      conciliadoCount,
      ambiguoCount,
      discrepanciaCount
    };
  }

  /**
   * Ejecuta la evaluación en lote de todas las transacciones bancarias
   */
  static evaluateBatch(
    transactions: BankTransaction[],
    cfdis: CfdiRecord[]
  ): BankTransaction[] {
    const cfdiInputs: CfdiInput[] = cfdis.map(c => ({
      id: c.id,
      total: c.total,
      fecha: c.fechaEmision,
      rfc: c.rfcEmisor,
      isEfos: c.isEfos
    }));

    return transactions.map(tx => {
      // Si el usuario ya resolvió manualmente la transacción, preservamos el match
      if (tx.status === 'conciliado' && tx.matchedCfdiId) {
        return tx;
      }

      const input: BankTxInput = {
        id: tx.id,
        amount: tx.amount,
        date: tx.date,
        type: tx.amount >= 0 ? 'ingreso' : 'egreso'
      };

      const result = this.evaluateTransaction(input, cfdiInputs);

      return {
        ...tx,
        status: result.status,
        matchedCfdiId: result.matchedCfdiId || null,
        candidateCfdiIds: result.candidateCfdiIds || [],
        alertReason: result.alertReason
      };
    });
  }
}
