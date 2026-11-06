/**
 * Shifts a number by `places` decimal digits through its decimal string form, so
 * that scaling never introduces the binary error that `value * 10 ** places` does.
 */
function shiftDecimal(value: number, places: number): number {
  const text = String(value);
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!parts) return value * 10 ** places;
  const [, sign, whole, fraction, exponent] = parts;
  const shifted = (exponent ? Number.parseInt(exponent, 10) : 0) + places;
  return Number(`${sign}${whole}${fraction ? `.${fraction}` : ''}e${shifted}`);
}

/** Rounds half away from zero to `decimals` places. */
export function roundHalfUp(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return value;
  const shifted = shiftDecimal(value, decimals);
  const rounded = shifted < 0 ? -Math.round(-shifted) : Math.round(shifted);
  return shiftDecimal(rounded, -decimals);
}

/** Formats half-away-from-zero to a fixed number of decimals. */
export function fixed(value: number, decimals: number): string {
  return roundHalfUp(value, decimals).toFixed(decimals);
}

/**
 * Shortest JSON number form that reads back as the same value, with no exponent
 * and no trailing `.0`, as the coverage report's byte form requires.
 */
export function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('non-finite number');
  if (Object.is(value, -0)) return '0';
  const plain = String(value);
  if (!plain.includes('e') && !plain.includes('E')) return plain;
  const negative = value < 0;
  const magnitude = Math.abs(value);
  let text = magnitude.toFixed(20);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  if (Number(text) !== magnitude) {
    for (let digits = 1; digits <= 100; digits += 1) {
      const candidate = magnitude.toFixed(digits);
      if (Number(candidate) === magnitude) {
        text = candidate.replace(/0+$/, '').replace(/\.$/, '');
        break;
      }
    }
  }
  return `${negative ? '-' : ''}${text}`;
}

/** Service intervals read back without trailing zeros, as `250` or `120.5`. */
export function intervalText(hours: number): string {
  return canonicalNumber(roundHalfUp(hours, 1));
}
