export const CURRENCIES = {
  GBP: { exponent: 2, symbol: '£' },
  EUR: { exponent: 2, symbol: '€' },
  USD: { exponent: 2, symbol: '$' },
  JPY: { exponent: 0, symbol: '¥' },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const ACCOUNT_CURRENCIES: readonly CurrencyCode[] = ['EUR', 'GBP', 'USD', 'JPY'];
export const RATE_CURRENCIES: readonly CurrencyCode[] = ['EUR', 'USD', 'JPY'];

export const isCurrencyCode = (value: unknown): value is CurrencyCode =>
  typeof value === 'string' && Object.hasOwn(CURRENCIES, value);

export const exponentOf = (currency: CurrencyCode): number => CURRENCIES[currency].exponent;

/** Rates are exact decimals with four decimal places, held as integers scaled by 10^4. */
export const RATE_SCALE = 10_000n;

export const parseRateToE4 = (text: string): bigint | null => {
  const match = /^(\d{1,4})(?:\.(\d{1,4}))?$/.exec(text.trim());
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? '').padEnd(4, '0');
  const value = whole * RATE_SCALE + BigInt(fraction);
  if (value < 1n || value > 1000n * RATE_SCALE) return null;
  return value;
};

export const formatRate = (rateE4: bigint): string => {
  const whole = rateE4 / RATE_SCALE;
  const fraction = (rateE4 % RATE_SCALE).toString().padStart(4, '0');
  return `${whole}.${fraction}`;
};

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** Rounds a positive rational n/d to the nearest integer, halves away from zero. */
export const roundHalfUp = (numerator: bigint, denominator: bigint): bigint =>
  (2n * numerator + denominator) / (2n * denominator);

/**
 * The published conversion: round_half_up(pence x rate x 10^exponent / 100).
 * This is the only place GBP pence become account-currency minor units.
 */
export const convertPence = (pence: bigint, rateE4: bigint, currency: CurrencyCode): bigint =>
  roundHalfUp(pence * rateE4 * pow10(exponentOf(currency)), 100n * RATE_SCALE);

export const VAT_PERCENT = 20n;

export const vatOn = (subtotalMinor: bigint): bigint =>
  roundHalfUp(subtotalMinor * VAT_PERCENT, 100n);

export type MilestoneSplit = {
  depositMinor: bigint;
  lookDevMinor: bigint;
  finalDeliveryMinor: bigint;
};

/** Deposit 40% floored, look-dev 30% floored, final delivery the remainder. */
export const splitMilestones = (totalMinor: bigint): MilestoneSplit => {
  const depositMinor = (totalMinor * 40n) / 100n;
  const lookDevMinor = (totalMinor * 30n) / 100n;
  return {
    depositMinor,
    lookDevMinor,
    finalDeliveryMinor: totalMinor - depositMinor - lookDevMinor,
  };
};

const groupThousands = (digits: string): string => {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
};

/** The published display format: symbol, comma thousands, exponent decimals. */
export const formatMoney = (amountMinor: bigint, currency: CurrencyCode): string => {
  const { exponent, symbol } = CURRENCIES[currency];
  const negative = amountMinor < 0n;
  const magnitude = negative ? -amountMinor : amountMinor;
  const scale = pow10(exponent);
  const whole = groupThousands((magnitude / scale).toString());
  const body =
    exponent === 0 ? whole : `${whole}.${(magnitude % scale).toString().padStart(exponent, '0')}`;
  return `${negative ? '-' : ''}${symbol}${body}`;
};

/** Kill Bill amounts: major units with exactly as many decimals as the exponent. */
export const formatMajorUnits = (amountMinor: bigint, currency: CurrencyCode): string => {
  const exponent = exponentOf(currency);
  const scale = pow10(exponent);
  const whole = (amountMinor / scale).toString();
  return exponent === 0
    ? whole
    : `${whole}.${(amountMinor % scale).toString().padStart(exponent, '0')}`;
};

export const CHANGE_ORDER_NET_PENCE = 18_000n;
