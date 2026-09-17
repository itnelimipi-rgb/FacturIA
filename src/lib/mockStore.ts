import { Profile, BankTransaction, CfdiRecord, CashFlowMetrics } from './types';
import { SEED_PROFILE, SEED_CFDIS, SEED_TRANSACTIONS } from './seed';
import { MatchingEngineService } from './MatchingEngineService';
import { EfosService } from './efosService';

const STORAGE_KEY_TXS = 'facturia_bank_transactions_v1';
const STORAGE_KEY_CFDIS = 'facturia_cfdis_v1';
const STORAGE_KEY_PROFILE = 'facturia_profile_v1';

export class FacturiaStore {
  /**
   * Obtiene el perfil activo
   */
  static getProfile(): Profile {
    if (typeof window === 'undefined') return SEED_PROFILE;
    const stored = localStorage.getItem(STORAGE_KEY_PROFILE);
    if (stored) {
      try { return JSON.parse(stored); } catch (_) {}
    }
    return SEED_PROFILE;
  }

  /**
   * Obtiene las transacciones bancarias actuales
   */
  static getTransactions(): BankTransaction[] {
    if (typeof window === 'undefined') return SEED_TRANSACTIONS;
    const stored = localStorage.getItem(STORAGE_KEY_TXS);
    if (stored) {
      try { return JSON.parse(stored); } catch (_) {}
    }
    this.saveTransactions(SEED_TRANSACTIONS);
    return SEED_TRANSACTIONS;
  }

  /**
   * Guarda las transacciones en almacenamiento local
   */
  static saveTransactions(txs: BankTransaction[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY_TXS, JSON.stringify(txs));
  }

  /**
   * Obtiene los CFDIs registrados
   */
  static getCfdis(): CfdiRecord[] {
    if (typeof window === 'undefined') return SEED_CFDIS;
    const stored = localStorage.getItem(STORAGE_KEY_CFDIS);
    if (stored) {
      try { return JSON.parse(stored); } catch (_) {}
    }
    this.saveCfdis(SEED_CFDIS);
    return SEED_CFDIS;
  }

  /**
   * Guarda los CFDIs en almacenamiento local
   */
  static saveCfdis(cfdis: CfdiRecord[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY_CFDIS, JSON.stringify(cfdis));
  }

  /**
   * Resetea el estado a los datos semilla iniciales
   */
  static resetToSeed(): { transactions: BankTransaction[]; cfdis: CfdiRecord[] } {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_TXS);
      localStorage.removeItem(STORAGE_KEY_CFDIS);
      localStorage.removeItem(STORAGE_KEY_PROFILE);
    }
    this.saveTransactions(SEED_TRANSACTIONS);
    this.saveCfdis(SEED_CFDIS);
    return { transactions: SEED_TRANSACTIONS, cfdis: SEED_CFDIS };
  }

  /**
   * Registra un nuevo CFDI procesado y re-evalúa transacciones no conciliadas
   */
  static addCfdi(cfdi: CfdiRecord): { updatedTransactions: BankTransaction[]; updatedCfdis: CfdiRecord[] } {
    const currentCfdis = this.getCfdis();
    // Validar si el RFC emisor está en EFOS
    const efosCheck = EfosService.checkRfc(cfdi.rfcEmisor);
    if (efosCheck.isEfos) {
      cfdi.isEfos = true;
    }

    const updatedCfdis = [cfdi, ...currentCfdis];
    this.saveCfdis(updatedCfdis);

    // Re-evaluar transacciones que no estaban conciliadas
    const currentTxs = this.getTransactions();
    const updatedTxs = MatchingEngineService.evaluateBatch(currentTxs, updatedCfdis);
    this.saveTransactions(updatedTxs);

    return { updatedTransactions: updatedTxs, updatedCfdis };
  }

  /**
   * Resuelve una transacción ambigua en 1-clic vinculando el CFDI seleccionado
   */
  static resolveAmbiguous(transactionId: string, selectedCfdiId: string): BankTransaction[] {
    const currentTxs = this.getTransactions();
    const updated = currentTxs.map(tx => {
      if (tx.id === transactionId) {
        return {
          ...tx,
          status: 'conciliado' as const,
          matchedCfdiId: selectedCfdiId,
          candidateCfdiIds: undefined,
          alertReason: undefined
        };
      }
      return tx;
    });

    this.saveTransactions(updated);
    return updated;
  }

  /**
   * Desvincula un CFDI para volver a abrir la transacción como discrepancia o ambigua
   */
  static unmatchTransaction(transactionId: string): BankTransaction[] {
    const currentTxs = this.getTransactions();
    const cfdis = this.getCfdis();

    const updated = currentTxs.map(tx => {
      if (tx.id === transactionId) {
        return {
          ...tx,
          status: 'discrepancia' as const,
          matchedCfdiId: null,
          alertReason: 'Movimiento desvinculado manualmente por el usuario'
        };
      }
      return tx;
    });

    const evaluated = MatchingEngineService.evaluateBatch(updated, cfdis);
    this.saveTransactions(evaluated);
    return evaluated;
  }

  /**
   * Calcula las métricas del Escudo de Flujo de Caja
   */
  static getMetrics(): CashFlowMetrics {
    const txs = this.getTransactions();
    const cfdis = this.getCfdis();
    return MatchingEngineService.calculateCashFlowShieldMetrics(txs, cfdis);
  }
}
