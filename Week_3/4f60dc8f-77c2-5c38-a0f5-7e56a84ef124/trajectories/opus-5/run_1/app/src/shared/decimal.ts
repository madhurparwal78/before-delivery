/** An exact non-negative rational `numerator / denominator`. Used for dimensions, never money. */
export type Rational = { numerator: bigint; denominator: bigint };

const pow10 = (n: number): bigint => 10n ** BigInt(n);

export const rationalFromDecimalString = (text: string): Rational => {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!match) throw new Error(`not a non-negative decimal: ${text}`);
  const fraction = match[2] ?? '';
  return {
    numerator: BigInt(`${match[1] || '0'}${fraction}`),
    denominator: pow10(fraction.length),
  };
};

export const rationalScale = (value: Rational, by: Rational): Rational => ({
  numerator: value.numerator * by.numerator,
  denominator: value.denominator * by.denominator,
});

/** Rounds to `decimals` places, halves up, and renders with trailing zeros kept. */
export const rationalToFixed = (value: Rational, decimals: number): string => {
  const scaled = value.numerator * pow10(decimals);
  const rounded = (2n * scaled + value.denominator) / (2n * value.denominator);
  const scale = pow10(decimals);
  const whole = (rounded / scale).toString();
  return decimals === 0
    ? whole
    : `${whole}.${(rounded % scale).toString().padStart(decimals, '0')}`;
};

export const rationalToNumber = (value: Rational): number => Number(rationalToFixed(value, 9));

/** Millimetres to inches, exactly one twenty-five-point-four-th. */
export const INCH_PER_MILLIMETRE: Rational = { numerator: 10n, denominator: 254n };
