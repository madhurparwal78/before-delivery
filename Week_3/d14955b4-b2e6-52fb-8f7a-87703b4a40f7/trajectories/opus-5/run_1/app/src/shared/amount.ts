/** Published currencies and their minor-unit exponents. */
export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  CLP: 0,
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  BRL: 2,
  KWD: 3,
  BHD: 3,
  JOD: 3,
};

export function isPublishedCurrency(code: unknown): code is string {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENTS, code);
}

/**
 * Writes whole minor units in a published currency: exactly the currency's
 * decimals, a `.` decimal mark, no grouping, then a space and the code.
 */
export function formatAmount(amountMinor: number, currency: string): string {
  const exponent = CURRENCY_EXPONENTS[currency];
  if (exponent === undefined) return `${amountMinor} ${currency}`;
  const negative = amountMinor < 0;
  const digits = String(Math.abs(amountMinor)).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? '' : `.${digits.slice(digits.length - exponent)}`;
  return `${negative ? '-' : ''}${whole}${fraction} ${currency}`;
}
