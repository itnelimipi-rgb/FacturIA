import type { CfdiParty } from './xmlParser';

export interface ProfileCandidate {
  rfc: string;
  name: string;
  regime: string;
  documents: number;
}

export interface ProfileSuggestion {
  candidates: ProfileCandidate[];
  /** Set only when one RFC appears in every document and no other RFC does. */
  detected?: ProfileCandidate;
}

export const REGIME_OPTIONS: Array<[code: string, label: string]> = [
  ['626', 'Régimen Simplificado de Confianza (RESICO)'],
  ['612', 'Actividades empresariales y profesionales'],
  ['601', 'General de ley personas morales'],
  ['605', 'Sueldos y salarios'],
  ['606', 'Arrendamiento'],
  ['621', 'Incorporación fiscal'],
  ['625', 'Plataformas tecnológicas'],
  ['616', 'Sin obligaciones fiscales'],
];

export function regimeLabel(code: string): string {
  const option = REGIME_OPTIONS.find(([value]) => code.startsWith(value));
  return option ? `${option[0]} · ${option[1]}` : code;
}

/**
 * The account owner is the RFC that appears in every uploaded CFDI, as issuer or receiver.
 * With a single document both parties qualify, so the person chooses.
 */
export function suggestProfile(documents: Array<{ emisor: CfdiParty; receptor: CfdiParty }>): ProfileSuggestion {
  const byRfc = new Map<string, { documents: number; names: Map<string, number>; regimes: Map<string, number> }>();
  for (const document of documents) {
    const seen = new Set<string>();
    for (const party of [document.emisor, document.receptor]) {
      const rfc = party.rfc.trim().toUpperCase();
      if (!rfc) continue;
      const entry = byRfc.get(rfc) ?? { documents: 0, names: new Map(), regimes: new Map() };
      if (!seen.has(rfc)) entry.documents++;
      seen.add(rfc);
      if (party.name.trim()) entry.names.set(party.name.trim(), (entry.names.get(party.name.trim()) ?? 0) + 1);
      if (party.regime) entry.regimes.set(party.regime, (entry.regimes.get(party.regime) ?? 0) + 1);
      byRfc.set(rfc, entry);
    }
  }
  const mostCommon = (values: Map<string, number>) => [...values].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? '';
  const candidates = [...byRfc].map(([rfc, entry]) => ({ rfc, name: mostCommon(entry.names), regime: mostCommon(entry.regimes), documents: entry.documents }))
    .sort((left, right) => right.documents - left.documents || left.rfc.localeCompare(right.rfc));
  const inEvery = candidates.filter(candidate => candidate.documents === documents.length);
  return { candidates, detected: documents.length > 1 && inEvery.length === 1 ? inEvery[0] : undefined };
}
