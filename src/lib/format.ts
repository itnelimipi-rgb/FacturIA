/** "$1,234.50" for pesos and "USD 1,234.50" for other currencies; amounts are never converted. */
export function formatMoney(amount: number, currency = 'MXN'): string {
  const code = /^[A-Z]{3}$/.test(currency) && currency !== 'XXX' ? currency : 'MXN';
  return new Intl.NumberFormat('es-MX', {style: 'currency', currency: code, minimumFractionDigits: 2}).format(amount);
}

/** Signed amount for a bank movement: "+$2,320.00" or "−$348.00". */
export function formatSignedMoney(amount: number, currency = 'MXN'): string {
  return `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${formatMoney(Math.abs(amount), currency)}`;
}

/** Written calendar day ("4 oct 2026"), independent of the browser's time zone. */
export function formatDay(value: string): string {
  const day = value.slice(0, 10);
  const date = new Date(`${day}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-MX', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}).format(date).replace('.', '');
}
