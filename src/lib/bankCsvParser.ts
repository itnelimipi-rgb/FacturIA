import { BankTransaction } from './types';

export const MAX_BANK_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_BANK_CSV_ROWS = 5000;

export interface BankCsvError {
  row: number;
  message: string;
}

export interface BankCsvResult {
  transactions: BankTransaction[];
  errors: BankCsvError[];
  delimiter: ',' | ';';
}

interface CsvRow {
  line: number;
  cells: string[];
}

function readRows(text: string, delimiter: ',' | ';'): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let rowLine = 1;

  const endCell = () => {
    cells.push(cell.trim());
    cell = '';
    closedQuote = false;
  };
  const endRow = () => {
    endCell();
    if (cells.some(value => value !== '')) rows.push({ line: rowLine, cells });
    if (rows.length > MAX_BANK_CSV_ROWS + 1) throw new Error(`Se permiten hasta ${MAX_BANK_CSV_ROWS} movimientos por archivo.`);
    cells = [];
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        cell += char;
        if (char === '\n') line++;
      }
      continue;
    }
    if (char === delimiter) {
      endCell();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      endRow();
      line++;
      rowLine = line;
    } else if (char === '"') {
      if (cell.trim() || closedQuote) throw new Error(`Comillas inesperadas en la línea ${line}.`);
      cell = '';
      quoted = true;
    } else {
      if (closedQuote && char.trim()) throw new Error(`Contenido después de comillas en la línea ${line}.`);
      if (!closedQuote) cell += char;
    }
  }
  if (quoted) throw new Error(`Falta cerrar una comilla en la línea ${rowLine}.`);
  endRow();
  return rows;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function normalizeDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const local = /^(\d{2})([-/])(\d{2})\2(\d{4})$/.exec(value);
  if (!iso && !local) return null;
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(local![4]), Number(local![3]), Number(local![1])];
  if (year < 1900 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function stableHash(value: string): string {
  let hash1 = 2166136261;
  let hash2 = 2246822519;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    hash1 = Math.imul(hash1 ^ code, 16777619);
    hash2 = Math.imul(hash2 ^ code, 3266489917);
  }
  return (hash1 >>> 0).toString(16).padStart(8, '0') + (hash2 >>> 0).toString(16).padStart(8, '0');
}

/** CSV normalizado: fecha,descripcion,monto[,moneda]. No infiere importes ni formatos bancarios. */
export function parseBankCsv(text: string, context: { userId: string; accountId: string }): BankCsvResult {
  const result: BankCsvResult = { transactions: [], errors: [], delimiter: ',' };
  const fail = (message: string, row = 1) => {
    result.errors.push({ row, message });
    return result;
  };
  if (!context.userId.trim() || !context.accountId.trim()) return fail('Selecciona el usuario y la cuenta antes de importar.');
  if (new TextEncoder().encode(text).length > MAX_BANK_CSV_BYTES) return fail('El archivo supera el límite de 2 MB.');
  const csv = text.replace(/^\uFEFF/, '');
  if (!csv.trim()) return fail('El archivo está vacío.');
  // Los encabezados no necesitan separadores dentro de comillas.
  const headerLine = csv.split(/\r?\n/, 1)[0];
  result.delimiter = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ',';

  let rows: CsvRow[];
  try {
    rows = readRows(csv, result.delimiter);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Estructura CSV inválida.');
  }
  const headers = rows[0]?.cells.map(normalizeHeader) || [];
  if (new Set(headers).size !== headers.length) return fail('Hay encabezados repetidos.');
  const required = ['fecha', 'descripcion', 'monto'];
  if (required.some(header => !headers.includes(header))) return fail('Encabezados requeridos: fecha,descripcion,monto. Moneda es opcional.');
  if (headers.some(header => ![...required, 'moneda'].includes(header))) return fail('Usa únicamente las columnas fecha,descripcion,monto y moneda.');
  if (rows.length < 2) return fail('El archivo no contiene movimientos.');
  const column = (row: CsvRow, name: string) => row.cells[headers.indexOf(name)] || '';
  const occurrences = new Map<string, number>();

  for (const row of rows.slice(1)) {
    if (row.cells.length !== headers.length) {
      result.errors.push({ row: row.line, message: 'El número de columnas no coincide con los encabezados.' });
      continue;
    }
    const date = normalizeDate(column(row, 'fecha'));
    const description = column(row, 'descripcion');
    const rawAmount = column(row, 'monto');
    const amount = Number(rawAmount);
    const currency = (column(row, 'moneda') || 'MXN').toUpperCase();
    const problems: string[] = [];
    if (!date) problems.push('Fecha inválida: usa AAAA-MM-DD o DD-MM-AAAA (1900–2100)');
    if (!description || description.length > 500) problems.push('La descripción debe contener entre 1 y 500 caracteres');
    if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(rawAmount) || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 999999999.99) {
      problems.push('Monto inválido: usa signo y punto decimal, sin separadores de miles; no se permite cero');
    }
    if (!/^[A-Z]{3}$/.test(currency)) problems.push('Moneda inválida: usa un código de tres letras, por ejemplo MXN');
    if (problems.length) {
      result.errors.push({ row: row.line, message: problems.join('. ') + '.' });
      continue;
    }
    const normalizedAmount = Math.round(amount * 100) / 100;
    const key = JSON.stringify([context.userId, context.accountId, date, description, normalizedAmount, currency]);
    const occurrence = occurrences.get(key) || 0;
    occurrences.set(key, occurrence + 1);
    result.transactions.push({
      id: `bank-csv-${stableHash(`${key}:${occurrence}`)}`,
      userId: context.userId,
      accountId: context.accountId,
      date: date!,
      description,
      amount: normalizedAmount,
      currency,
      status: 'discrepancia',
      matchedCfdiId: null,
      candidateCfdiIds: [],
      alertReason: 'Pendiente de conciliar con un CFDI.'
    });
  }
  // Evita importaciones parciales invisibles: el usuario debe corregir todas las filas.
  if (result.errors.length) result.transactions = [];
  return result;
}
