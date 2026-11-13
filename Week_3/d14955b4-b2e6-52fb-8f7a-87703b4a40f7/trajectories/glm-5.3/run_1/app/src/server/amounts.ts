export const CURRENCIES: Record<string, number> = {
  JPY: 0, KRW: 0, CLP: 0,
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, BRL: 2,
  KWD: 3, BHD: 3, JOD: 3,
};

export function currencyExponent(code: string): number | null {
  const exponent = CURRENCIES[code];
  return exponent === undefined ? null : exponent;
}

export function formatAmount(minor: number, code: string): string {
  const exponent = CURRENCIES[code] ?? 2;
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const whole = Math.floor(absolute / 10 ** exponent).toString();
  const text = exponent === 0 ? whole : `${whole}.${String(absolute % 10 ** exponent).padStart(exponent, '0')}`;
  return `${negative ? '-' : ''}${text} ${code}`;
}
