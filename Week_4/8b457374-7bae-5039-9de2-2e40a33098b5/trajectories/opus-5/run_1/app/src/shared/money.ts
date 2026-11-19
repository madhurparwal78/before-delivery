/** All money in Dotgain is integer pence. */

/** Renders pence as pounds with comma thousands separators, for example `1,234.05`. */
export function formatPence(pence: number): string {
  const negative = pence < 0;
  const abs = Math.abs(pence);
  const pounds = Math.trunc(abs / 100);
  const pennies = abs % 100;
  const grouped = String(pounds).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${String(pennies).padStart(2, '0')}`;
}

/** Renders pence as `£1,234.05`. */
export function formatMoney(pence: number): string {
  return `£${formatPence(pence)}`;
}

/** Renders pence as pounds with two decimals and no grouping, for Kill Bill amounts. */
export function penceToDecimal(pence: number): string {
  const pounds = Math.trunc(pence / 100);
  const pennies = pence % 100;
  return `${pounds}.${String(pennies).padStart(2, '0')}`;
}

const POUNDS_INPUT = /^(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parses the pounds input format: digits with optional comma thousands separators,
 * optionally followed by a point and one or two pence digits, with no `£` sign.
 * Returns null when the text is not in that form.
 */
export function parsePoundsToPence(text: string): number | null {
  const trimmed = text.trim();
  const match = POUNDS_INPUT.exec(trimmed);
  if (!match) return null;
  const whole = (match[1] ?? '').replace(/,/g, '');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return Number(whole) * 100 + Number(fraction);
}
