/**
 * Decimal scaling with half-away-from-zero rounding.
 *
 * Every displayed number in the app passes through here: the shortest decimal
 * form of the stored double is converted exactly with BigInt arithmetic, so a
 * value whose decimal form sits exactly half-way (100050 m -> 100.05 km) rounds
 * away from zero (100.1 km) rather than by binary accident.
 */

type DecimalParts = { mantissa: bigint; exponent: number };

function decimalParts(value: number): DecimalParts {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) {
    throw new Error(`not a finite decimal: ${text}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const intPart = match[2];
  const fracPart = match[3] ?? "";
  const exp = match[4] ? Number(match[4]) : 0;
  const mantissa = sign * BigInt(intPart + fracPart);
  return { mantissa, exponent: exp - fracPart.length };
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

function divideRoundHalfAway(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = (magnitude * 2n + denominator) / (denominator * 2n);
  return negative ? -quotient : quotient;
}

/** Rounds `value * num / den * 10^decimals` to a whole number, half away from zero. */
export function scaleRoundHalfAway(
  value: number,
  num: bigint,
  den: bigint,
  decimals: number,
): bigint {
  const { mantissa, exponent } = decimalParts(value);
  const shift = exponent + decimals;
  const numerator = shift >= 0 ? mantissa * num * pow10(shift) : mantissa * num;
  const denominator = shift >= 0 ? den : den * pow10(-shift);
  return divideRoundHalfAway(numerator, denominator);
}

/** Writes a scaled whole number as fixed-point text; a scaled zero carries no sign. */
export function formatScaled(scaled: bigint, decimals: number): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : "";
  const sign = negative && scaled !== 0n ? "-" : "";
  return `${sign}${whole}${fraction}`;
}

export function fixed(value: number, num: bigint, den: bigint, decimals: number): string {
  return formatScaled(scaleRoundHalfAway(value, num, den, decimals), decimals);
}

/** Rounds `value * num / den` to a whole number, half away from zero. */
export function roundRatio(value: number, num: bigint, den: bigint): number {
  return Number(scaleRoundHalfAway(value, num, den, 0));
}
