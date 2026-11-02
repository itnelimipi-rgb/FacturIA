/** "Facturación" → "Facturacion": compare words regardless of accents. */
export const stripAccents = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '');

/** Lowercase, accent-free text for searches. */
export const searchable = (value: string) => stripAccents(value).toLowerCase();

/** The typographic minus sign (U+2212) that some banks and spreadsheets export. */
export const MINUS_SIGN = String.fromCharCode(0x2212);
