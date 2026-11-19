/** Money lives in whole pennies. Nothing in the app multiplies or divides money as a float. */
export type Pennies = number;

export function isMoneyString(value: unknown): value is string {
  return typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value);
}

export function parseMoney(value: string): Pennies {
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  const [whole, part] = digits.split('.');
  const pennies = Number(whole) * 100 + Number(part);
  return negative ? -pennies : pennies;
}

export function moneyString(pennies: Pennies): string {
  const negative = pennies < 0;
  const value = Math.abs(pennies);
  return `${negative ? '-' : ''}${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

export function moneyLabel(pennies: Pennies): string {
  const negative = pennies < 0;
  const value = Math.abs(pennies);
  const whole = String(Math.floor(value / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}£${whole}.${String(value % 100).padStart(2, '0')}`;
}

/** Half up, away from zero, on an exact rational. */
export function halfUpDivide(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  const top = Math.abs(numerator);
  const whole = Math.floor(top / denominator);
  const rest = top - whole * denominator;
  const rounded = rest * 2 >= denominator ? whole + 1 : whole;
  return sign * rounded;
}

/** A percentage as published: a string of up to one decimal, such as `15` or `12.5`. */
export function isPercentString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(\.\d)?$/.test(value);
}

export function percentTenths(value: string): number {
  const [whole, part] = value.split('.');
  return Number(whole) * 10 + (part ? Number(part) : 0);
}

export function percentString(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  const part = tenths % 10;
  return part === 0 ? String(whole) : `${whole}.${part}`;
}

/** Adds a margin given in tenths of a percent, half up to the penny. */
export function addMargin(pennies: Pennies, marginTenths: number): Pennies {
  return halfUpDivide(pennies * (1000 + marginTenths), 1000);
}

/** A percentage of an amount, half up to the penny. */
export function percentOf(pennies: Pennies, percentTenthsValue: number): Pennies {
  return halfUpDivide(pennies * percentTenthsValue, 1000);
}

/** Splits an amount to the penny, with the earlier shares taking the extra pennies. */
export function splitToPennies(total: Pennies, shares: number): Pennies[] {
  if (shares <= 0) return [];
  const base = Math.floor(total / shares);
  const extra = total - base * shares;
  return Array.from({ length: shares }, (_unused, index) => base + (index < extra ? 1 : 0));
}

/** The typed price forms an operator may send on the bid page. */
export function parseTypedPrice(value: unknown): Pennies | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(text) && !/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const digits = text.replace(/,/g, '');
  const [whole, part = ''] = digits.split('.');
  const pennies = Number(whole) * 100 + Number(part.padEnd(2, '0'));
  return Number.isFinite(pennies) ? pennies : null;
}

/** An amount typed into a desk field, in pounds and pence. */
export function parseTypedAmount(value: unknown): Pennies | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, part = ''] = text.split('.');
  return Number(whole) * 100 + Number(part.padEnd(2, '0'));
}

/** A statement amount, which may be quoted with thousands commas and negative for money out. */
export function parseStatementAmount(value: string): Pennies | null {
  const text = value.trim().replace(/^"|"$/g, '').replace(/,/g, '').replace(/^£/, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const digits = negative ? text.slice(1) : text;
  const [whole, part = ''] = digits.split('.');
  const pennies = Number(whole) * 100 + Number(part.padEnd(2, '0'));
  return negative ? -pennies : pennies;
}
