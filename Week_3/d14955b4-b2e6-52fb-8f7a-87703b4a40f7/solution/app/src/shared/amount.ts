const CURRENCY_EXPONENTS = {
  JPY: 0, KRW: 0, CLP: 0,
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, BRL: 2,
  KWD: 3, BHD: 3, JOD: 3,
} as const;

export type Currency = keyof typeof CURRENCY_EXPONENTS;

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.hasOwn(CURRENCY_EXPONENTS, value);
}

export function formatAmount(amountMinor: number, currency: Currency): string {
  const exponent = CURRENCY_EXPONENTS[currency];
  const unit = 10 ** exponent;
  const whole = Math.floor(amountMinor / unit);
  if (exponent === 0) return `${whole} ${currency}`;
  const fraction = String(amountMinor % unit).padStart(exponent, '0');
  return `${whole}.${fraction} ${currency}`;
}
