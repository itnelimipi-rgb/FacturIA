import { EfosEntry } from './types';

/**
 * Mock inicial de la lista negra del SAT (Artículo 69-B del Código Fiscal de la Federación).
 * Incluye contribuyentes catalogados como "Presunto", "Definitivo", etc.
 */
export const INITIAL_EFOS_BLACKLIST: EfosEntry[] = [
  {
    rfc: 'FAL8501019A1',
    nombreRazonSocial: 'FACTURAS FANTASMA Y ASOCIADOS S.A. DE C.V.',
    situacion: 'Definitivo',
    fechaPublicacionDof: '2024-02-15'
  },
  {
    rfc: 'SIM920314XYZ',
    nombreRazonSocial: 'SIMULACION DE OPERACIONES TOTALES S.A. DE C.V.',
    situacion: 'Definitivo',
    fechaPublicacionDof: '2023-11-20'
  },
  {
    rfc: 'CON010101AA9',
    nombreRazonSocial: 'CONSULTORIA INTEGRAL OPACA S.C.',
    situacion: 'Presunto',
    fechaPublicacionDof: '2025-01-10'
  }
];

export class EfosService {
  private static blacklist: Map<string, EfosEntry> = new Map(
    INITIAL_EFOS_BLACKLIST.map(entry => [entry.rfc.toUpperCase().trim(), entry])
  );

  /**
   * Consulta si un RFC específico se encuentra en la lista de EFOS del SAT
   */
  static checkRfc(rfc: string): { isEfos: boolean; entry?: EfosEntry; isDefinitivo: boolean } {
    if (!rfc) return { isEfos: false, isDefinitivo: false };
    const normalized = rfc.toUpperCase().trim();
    const entry = this.blacklist.get(normalized);

    if (entry) {
      return {
        isEfos: true,
        entry,
        isDefinitivo: entry.situacion === 'Definitivo'
      };
    }

    return {
      isEfos: false,
      isDefinitivo: false
    };
  }

  /**
   * Registra dinámicamente un RFC en la lista negra (útil para pruebas y sincronización DOF)
   */
  static addBlacklistEntry(entry: EfosEntry): void {
    this.blacklist.set(entry.rfc.toUpperCase().trim(), entry);
  }

  /**
   * Devuelve todos los registros de la lista negra
   */
  static getAll(): EfosEntry[] {
    return Array.from(this.blacklist.values());
  }
}
