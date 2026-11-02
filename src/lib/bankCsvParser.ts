import { BankTransaction } from './types';
import { MINUS_SIGN, searchable, stripAccents } from './text';

export const MAX_BANK_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_BANK_CSV_ROWS = 5000;
const HEADER_SEARCH_ROWS = 25;
const MAX_AMOUNT = 999999999.99;

export type BankCsvDelimiter = ',' | ';' | '\t' | '|';

/** Raw values of one bank row, as written in the file (or corrected by the user). */
export interface BankCsvRowFields {
  date: string;
  description: string;
  amount: string;
  currency: string;
}

export interface BankCsvRow {
  line: number;
  fields: BankCsvRowFields;
}

export interface BankCsvError {
  row: number;
  message: string;
  fields?: BankCsvRowFields;
}

/** Conventions detected once per file, so every row is read the same way. */
export interface BankCsvLayout {
  headerLine: number;
  columns: string[];
  decimal: '.' | ',';
  dayFirst: boolean;
}

export interface BankCsvResult {
  /** All-or-nothing: empty while any row still has an error. */
  transactions: BankTransaction[];
  errors: BankCsvError[];
  delimiter: BankCsvDelimiter;
  /** Every data row, so a reviewer can correct or drop the rows with errors. */
  rows: BankCsvRow[];
  /** Rows that are already valid, even when other rows still need a correction. */
  validTransactions: BankTransaction[];
  layout?: BankCsvLayout;
}

export interface BankCsvContext {
  userId: string;
  accountId: string;
}

interface CsvRow {
  line: number;
  cells: string[];
}

function readRows(text: string, delimiter: BankCsvDelimiter): CsvRow[] {
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
    if (rows.length > MAX_BANK_CSV_ROWS + HEADER_SEARCH_ROWS) throw new Error(`Se permiten hasta ${MAX_BANK_CSV_ROWS} movimientos por archivo.`);
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

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === delimiter) count++;
  }
  return count;
}

/** The delimiter that splits the most lines into the same number of columns. */
function detectDelimiter(text: string): BankCsvDelimiter {
  const lines = text.split(/\r?\n/).filter(line => line.trim()).slice(0, 40);
  let best: BankCsvDelimiter = ',';
  let bestScore = 0;
  for (const delimiter of [',', ';', '\t', '|'] as const) {
    const frequency = new Map<number, number>();
    for (const line of lines) {
      const count = countOutsideQuotes(line, delimiter);
      if (count > 0) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    }
    let agreeing = 0;
    let columns = 0;
    for (const [count, times] of frequency) if (times > agreeing || (times === agreeing && count > columns)) { agreeing = times; columns = count; }
    const score = agreeing * 100 + columns;
    if (score > bestScore) { best = delimiter; bestScore = score; }
  }
  return best;
}

function normalizeHeader(value: string): string {
  return searchable(value)
    .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

type ColumnRole = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'currency' | 'reference';
const ROLE_PATTERNS: Array<[ColumnRole, RegExp]> = [
  ['date', /^(fecha|fec|dia|date|fecha de operacion|fecha operacion|fecha de movimiento|fecha movimiento|fecha de aplicacion|fecha aplicacion|fecha valor|fecha de transaccion|fecha transaccion|fecha y hora|fecha de cargo|fecha de abono|transaction date|posting date)$/],
  ['description', /^(descripcion|concepto|detalle|movimiento|description|glosa|leyenda|narrativa|descripcion del movimiento|concepto del movimiento|concepto referencia|descripcion referencia|detalle del movimiento|details)$/],
  ['amount', /^(monto|importe|cantidad|amount|valor|monto del movimiento|importe del movimiento)$/],
  ['debit', /^(cargo|cargos|retiro|retiros|debito|debitos|egreso|egresos|salida|salidas|debit|debits|withdrawal|withdrawals)$/],
  ['credit', /^(abono|abonos|deposito|depositos|credito|creditos|ingreso|ingresos|entrada|entradas|credit|credits|deposit|deposits)$/],
  ['currency', /^(moneda|divisa|currency|moneda del movimiento)$/],
  ['reference', /^(referencia|ref|no referencia|numero de referencia|referencia numerica|referencia alfanumerica|folio|reference)$/],
];

type ColumnMap = Partial<Record<ColumnRole, number>>;

/** Map known Spanish and English bank headers; unknown columns (saldo, sucursal…) are ignored. */
function mapColumns(cells: string[]): {map: ColumnMap; error?: string} | null {
  const map: ColumnMap = {};
  const headers = cells.map(normalizeHeader);
  for (const [index, header] of headers.entries()) {
    const role = ROLE_PATTERNS.find(([, pattern]) => pattern.test(header))?.[0];
    if (!role) continue;
    if (map[role] === undefined) map[role] = index;
    else if (role === 'amount' || role === 'debit' || role === 'credit') return {map, error: `Hay dos columnas de ${cells[index] || 'importe'}. Deja sólo una para que no haya dudas sobre el importe.`};
  }
  const hasAmount = map.amount !== undefined || map.debit !== undefined || map.credit !== undefined;
  if (map.date === undefined || !hasAmount) return null;
  if (map.description === undefined) {
    if (map.reference === undefined) return null;
    map.description = map.reference;
    delete map.reference;
  }
  return {map};
}

const MONTHS: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7,
  ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};

function calendarDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function datePart(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
    .replace(/[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?: ?[ap]\.? ?m\.?)?(?:Z|[+-]\d{2}:?\d{2})?$/i, '').trim();
}

/** ISO, day-first (or month-first when the file says so), two-digit years and month names. */
export function parseBankDate(value: string, dayFirst = true): string | null {
  const text = datePart(value);
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})$/.exec(text);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[3]);
    const year = numeric[4].length === 2 ? 2000 + Number(numeric[4]) : Number(numeric[4]);
    return dayFirst ? calendarDate(year, second, first) : calendarDate(year, first, second);
  }
  const named = /^(\d{1,2})[-/ .]+([a-z]{3,10})\.?[-/ .,]+(\d{4}|\d{2})$/i.exec(stripAccents(text));
  if (named) {
    const month = MONTHS[named[2].toLowerCase().slice(0, 3)];
    const year = named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3]);
    return month ? calendarDate(year, month, Number(named[1])) : null;
  }
  return null;
}

function cleanAmount(value: string): {digits: string; negative: boolean} | null {
  let text = value.trim().split(MINUS_SIGN).join('-');
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
  if (/-$/.test(text)) { negative = !negative; text = text.slice(0, -1).trim(); }
  text = text.replace(/^(?:MXN|USD|EUR|M\.?N\.?)\s*/i, '').replace(/\s*(?:MXN|USD|EUR|M\.?N\.?)$/i, '');
  text = text.replace(/\$/g, '').replace(/\s+/g, '');
  if (/^[+-]/.test(text)) { if (text[0] === '-') negative = !negative; text = text.slice(1); }
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null;
  return {digits: text, negative};
}

/**
 * Exact cents from bank notation: "$1,234.56", "1.234,56", "(116.00)" or "116.00-".
 * A lone group such as "1.000" is rejected when its separator is the file's decimal mark.
 */
export function parseBankAmount(value: string, decimal: '.' | ',' = '.'): number | null {
  const cleaned = cleanAmount(value);
  if (!cleaned) return null;
  const {digits, negative} = cleaned;
  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  let normalized: string;
  if (lastDot === -1 && lastComma === -1) normalized = digits;
  else if (lastDot !== -1 && lastComma !== -1) {
    const mark = lastDot > lastComma ? '.' : ',';
    const grouping = mark === '.' ? ',' : '.';
    const position = digits.lastIndexOf(mark);
    const whole = digits.slice(0, position);
    const fraction = digits.slice(position + 1);
    if (!new RegExp(`^\\d{1,3}(?:\\${grouping}\\d{3})+$`).test(whole) || !/^\d{1,2}$/.test(fraction)) return null;
    normalized = `${whole.split(grouping).join('')}.${fraction}`;
  } else {
    const separator = lastDot !== -1 ? '.' : ',';
    const parts = digits.split(separator);
    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) normalized = `${parts[0]}.${parts[1]}`;
    else if (/^\d{1,3}$/.test(parts[0]) && parts.slice(1).every(part => /^\d{3}$/.test(part))) {
      if (separator === decimal && parts.length === 2) return null;
      normalized = parts.join('');
    } else return null;
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100) / 100;
  return negative ? -rounded : rounded;
}

export function normalizeBankCurrency(value: string): string | null {
  const text = stripAccents(value).toUpperCase().replace(/[.\s]/g, '');
  if (!text) return 'MXN';
  if (['MXN', 'MN', 'MXP', 'PESOS', 'PESO', 'PESOSMEXICANOS', 'NACIONAL'].includes(text)) return 'MXN';
  if (['USD', 'DLS', 'DLLS', 'DOLARES', 'DOLAR', 'USDOLARES', 'US$'].includes(text)) return 'USD';
  if (['EUR', 'EUROS', 'EURO'].includes(text)) return 'EUR';
  return /^[A-Z]{3}$/.test(text) ? text : null;
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

/** Preserve the original normalized CSV identity, including identical-row ordinal. */
export function bankCsvTransactionId(
  context: BankCsvContext,
  fields: Pick<BankTransaction, 'date' | 'description' | 'amount' | 'currency'>,
  occurrence: number,
): string {
  const key = JSON.stringify([context.userId, context.accountId, fields.date, fields.description, fields.amount, fields.currency]);
  return `bank-csv-${stableHash(`${key}:${occurrence}`)}`;
}

function detectDecimal(amounts: string[], delimiter: BankCsvDelimiter): '.' | ',' {
  let dot = 0;
  let comma = 0;
  for (const amount of amounts) {
    const digits = cleanAmount(amount)?.digits;
    if (!digits) continue;
    if (/\.\d{1,2}$/.test(digits)) dot++;
    else if (/,\d{1,2}$/.test(digits)) comma++;
  }
  if (comma > dot) return ',';
  if (dot > comma) return '.';
  return delimiter === ';' ? ',' : '.';
}

function detectDayFirst(dates: string[]): boolean {
  let dayFirst = false;
  let monthFirst = false;
  for (const value of dates) {
    const numeric = /^(\d{1,2})([-/.])(\d{1,2})\2(?:\d{4}|\d{2})$/.exec(datePart(value));
    if (!numeric) continue;
    if (Number(numeric[1]) > 12) dayFirst = true;
    else if (Number(numeric[3]) > 12) monthFirst = true;
  }
  return !(monthFirst && !dayFirst);
}

const SUMMARY_LABEL = /^(total|totales|saldo|suma|resumen)\b/i;
/** Bank exports often end with "Total" or "Saldo final" lines; they have no movement date. */
function isSummaryRow(cells: string[], dateCell: string): boolean {
  const date = stripAccents(dateCell.trim());
  return (!date || SUMMARY_LABEL.test(date)) && cells.some(cell => SUMMARY_LABEL.test(stripAccents(cell.trim())));
}

function rowFields(cells: string[], map: ColumnMap): {fields: BankCsvRowFields; problem?: string} {
  const cell = (role: ColumnRole) => map[role] === undefined ? '' : (cells[map[role]!] ?? '').trim();
  let description = cell('description');
  const reference = cell('reference');
  if (reference && description && !description.includes(reference)) description = `${description} · Ref. ${reference}`;
  let amount = cell('amount');
  let problem: string | undefined;
  if (map.amount === undefined) {
    const debit = cell('debit');
    const credit = cell('credit');
    const debitValue = debit ? parseBankAmount(debit, debit.includes(',') && !debit.includes('.') ? ',' : '.') : 0;
    const creditValue = credit ? parseBankAmount(credit, credit.includes(',') && !credit.includes('.') ? ',' : '.') : 0;
    if (debit && credit && debitValue !== 0 && creditValue !== 0) problem = 'La fila tiene cargo y abono a la vez. Deja sólo uno.';
    else if (debit && debitValue !== 0) amount = /^[-(]/.test(debit.split(MINUS_SIGN).join('-')) ? debit : `-${debit}`;
    else if (credit && creditValue !== 0) amount = credit;
    else amount = debit || credit;
  }
  return {fields: {date: cell('date'), description, amount, currency: cell('currency')}, problem};
}

function validateRows(rows: BankCsvRow[], context: BankCsvContext, layout: Pick<BankCsvLayout, 'decimal' | 'dayFirst'>, structural: Map<number, string>) {
  const transactions: BankTransaction[] = [];
  const errors: BankCsvError[] = [];
  const occurrences = new Map<string, number>();
  for (const row of rows) {
    const {fields} = row;
    const date = parseBankDate(fields.date, layout.dayFirst);
    const description = fields.description.trim();
    const amount = parseBankAmount(fields.amount, layout.decimal);
    const currency = normalizeBankCurrency(fields.currency);
    const problems: string[] = [];
    const known = structural.get(row.line);
    if (known) problems.push(known.replace(/\.$/, ''));
    if (!date) problems.push('Fecha inválida: usa AAAA-MM-DD o DD/MM/AAAA (1900–2100)');
    if (!description || description.length > 500) problems.push('La descripción debe contener entre 1 y 500 caracteres');
    if (amount === null || amount === 0 || Math.abs(amount) > MAX_AMOUNT) problems.push('Monto inválido: escribe el importe con hasta dos decimales, negativo si salió dinero; no se permite cero');
    if (!currency) problems.push('Moneda inválida: usa un código de tres letras, por ejemplo MXN');
    if (problems.length) {
      errors.push({row: row.line, message: problems.join('. ') + '.', fields: {...fields}});
      continue;
    }
    const key = JSON.stringify([context.userId, context.accountId, date, description, amount, currency]);
    const occurrence = occurrences.get(key) || 0;
    occurrences.set(key, occurrence + 1);
    transactions.push({
      id: bankCsvTransactionId(context, {date: date!, description, amount: amount!, currency: currency!}, occurrence),
      userId: context.userId,
      accountId: context.accountId,
      date: date!,
      description,
      amount: amount!,
      currency: currency!,
      status: 'discrepancia',
      matchedCfdiId: null,
      candidateCfdiIds: [],
      alertReason: 'Pendiente de conciliar con un CFDI.',
    });
  }
  return {transactions, errors};
}

/** Validate rows again after the user corrected or removed some of them. */
export function revalidateBankCsv(previous: BankCsvResult, rows: BankCsvRow[], context: BankCsvContext): BankCsvResult {
  const layout = previous.layout ?? {headerLine: 1, columns: [], decimal: '.', dayFirst: true};
  const {transactions, errors} = validateRows(rows, context, layout, new Map());
  return {...previous, rows, errors, validTransactions: transactions, transactions: errors.length ? [] : transactions};
}

/** Decode UTF-8 and fall back to Windows-1252, the encoding spreadsheet programs often use for CSV. */
export function decodeBankCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Bank CSV with detected columns: fecha, descripción/concepto and monto, or cargo/abono. */
export function parseBankCsv(text: string, context: BankCsvContext): BankCsvResult {
  const result: BankCsvResult = { transactions: [], errors: [], delimiter: ',', rows: [], validTransactions: [] };
  const fail = (message: string, row = 1) => {
    result.errors.push({ row, message });
    return result;
  };
  if (!context.userId.trim() || !context.accountId.trim()) return fail('Selecciona el usuario y la cuenta antes de importar.');
  if (new TextEncoder().encode(text).length > MAX_BANK_CSV_BYTES) return fail('El archivo supera el límite de 2 MB.');
  let csv = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!csv.trim()) return fail('El archivo está vacío.');
  const declared = /^sep=(.)\r?\n/i.exec(csv);
  if (declared) csv = csv.slice(declared[0].length);
  result.delimiter = declared && [',', ';', '\t', '|'].includes(declared[1]) ? declared[1] as BankCsvDelimiter : detectDelimiter(csv);

  let rows: CsvRow[];
  try {
    rows = readRows(csv, result.delimiter);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Estructura CSV inválida.');
  }
  let headerIndex = -1;
  let mapping: {map: ColumnMap; error?: string} | null = null;
  for (const [index, row] of rows.slice(0, HEADER_SEARCH_ROWS).entries()) {
    mapping = mapColumns(row.cells);
    if (mapping) { headerIndex = index; break; }
  }
  if (!mapping) return fail('No encontramos las columnas de fecha, descripción e importe. Usa encabezados como fecha, descripcion y monto (o cargo y abono).');
  if (mapping.error) return fail(mapping.error, rows[headerIndex].line);
  const header = rows[headerIndex];
  const dataRows = rows.slice(headerIndex + 1);
  if (!dataRows.length) return fail('El archivo no contiene movimientos.');
  if (dataRows.length > MAX_BANK_CSV_ROWS) return fail(`Se permiten hasta ${MAX_BANK_CSV_ROWS} movimientos por archivo.`);

  const structural = new Map<number, string>();
  for (const row of dataRows) {
    const extra = row.cells.slice(header.cells.length);
    const dateCell = mapping.map.date === undefined ? '' : row.cells[mapping.map.date] ?? '';
    if (isSummaryRow(row.cells, dateCell)) continue;
    const {fields, problem} = rowFields(row.cells, mapping.map);
    if (extra.some(value => value !== '')) structural.set(row.line, 'El número de columnas no coincide con los encabezados.');
    else if (problem) structural.set(row.line, problem);
    result.rows.push({line: row.line, fields});
  }
  if (!result.rows.length) return fail('El archivo no contiene movimientos.');
  const columns = Object.values(mapping.map).sort((left, right) => left - right).map(index => header.cells[index]).filter(Boolean);
  result.layout = {
    headerLine: header.line, columns,
    decimal: detectDecimal(result.rows.map(row => row.fields.amount), result.delimiter),
    dayFirst: detectDayFirst(result.rows.map(row => row.fields.date)),
  };
  const {transactions, errors} = validateRows(result.rows, context, result.layout, structural);
  result.errors = errors;
  result.validTransactions = transactions;
  // Avoid invisible partial imports: rows with errors must be corrected or removed explicitly.
  result.transactions = errors.length ? [] : transactions;
  return result;
}
