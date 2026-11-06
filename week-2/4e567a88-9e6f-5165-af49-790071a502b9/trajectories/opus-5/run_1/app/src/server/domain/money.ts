export const MICRO_PER_CREDIT = 1000000n;
export const MICRO_PER_UNIT_SCALE = 1000000n;

/** The one place a micro-credit amount is rounded: half up, on a positive denominator. */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Denominator must be positive');
  const doubled = numerator * 2n + (numerator >= 0n ? denominator : -denominator);
  const twice = denominator * 2n;
  const quotient = doubled / twice;
  const remainder = doubled % twice;
  return remainder < 0n ? quotient - 1n : quotient;
}

/** units (scaled by 1e6) times a micro-credits-per-unit rate, rounded once. */
export function amountMicro(unitsMicro: bigint, microPerUnit: bigint): bigint {
  return roundHalfUp(unitsMicro * microPerUnit, MICRO_PER_UNIT_SCALE);
}

function groupThousands(digits: string): string {
  let out = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ',';
    out += digits[index];
  }
  return out;
}

/** Credits with two decimals and comma thousands separators, for example `3,180.00`. */
export function formatCredits(micro: bigint): string {
  const sign = micro < 0n ? '-' : '';
  const cents = roundHalfUp(micro < 0n ? -micro : micro, 10000n);
  const whole = cents / 100n;
  const fraction = cents % 100n;
  return `${sign}${groupThousands(whole.toString())}.${fraction.toString().padStart(2, '0')}`;
}

/** A whole number of credits with comma thousands separators, for example `1,000`. */
export function formatWholeCredits(credits: bigint): string {
  const sign = credits < 0n ? '-' : '';
  const value = credits < 0n ? -credits : credits;
  return `${sign}${groupThousands(value.toString())}`;
}

/** A rate in credits per unit with six decimals. */
export function formatRate(microPerUnit: bigint): string {
  const whole = microPerUnit / MICRO_PER_CREDIT;
  const fraction = microPerUnit % MICRO_PER_CREDIT;
  return `${groupThousands(whole.toString())}.${fraction.toString().padStart(6, '0')}`;
}

/** An exact decimal string with no exponent and no trailing zeros. */
export function exactUnits(unitsMicro: bigint): string {
  const sign = unitsMicro < 0n ? '-' : '';
  const value = unitsMicro < 0n ? -unitsMicro : unitsMicro;
  const whole = value / MICRO_PER_UNIT_SCALE;
  const fraction = (value % MICRO_PER_UNIT_SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

function fixedDecimals(unitsMicro: bigint, decimals: number): string {
  const scale = 10n ** BigInt(6 - decimals);
  const scaled = roundHalfUp(unitsMicro, scale);
  if (decimals === 0) return groupThousands(scaled.toString());
  const divisor = 10n ** BigInt(decimals);
  const whole = scaled / divisor;
  const fraction = scaled % divisor;
  return `${groupThousands(whole.toString())}.${fraction.toString().padStart(decimals, '0')}`;
}

/** Whole numbers for images, two decimals for megapixels, one decimal for seconds. */
export function formatUnits(unitsMicro: bigint, unit: string): string {
  if (unit === 'image') return fixedDecimals(unitsMicro, 0);
  if (unit === 'megapixel') return fixedDecimals(unitsMicro, 2);
  return fixedDecimals(unitsMicro, 1);
}
