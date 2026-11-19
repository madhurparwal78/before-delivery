/** The one place numbers become text, for storage, API answers and screens. */

/** Expands exponential notation into plain decimal notation. */
function toPlainDecimal(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (!match) return text;
  const sign = match[1];
  const intPart = match[2];
  const fracPart = match[3] ?? '';
  const exponent = Number(match[4]);
  const digits = intPart + fracPart;
  const pointAt = intPart.length + exponent;
  if (pointAt <= 0) return sign + '0.' + '0'.repeat(-pointAt) + digits;
  if (pointAt >= digits.length) return sign + digits + '0'.repeat(pointAt - digits.length);
  return sign + digits.slice(0, pointAt) + '.' + digits.slice(pointAt);
}

function stripTrailingZeros(text: string): string {
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

/** The shortest JSON text that reads back as the same double. */
export function numberText(value: number): string {
  return JSON.stringify(value) ?? '0';
}

/** Numbers on screen: whole numbers plain, others at 6 significant digits. */
export function displayNumber(value: number): string {
  if (Number.isInteger(value)) return stripTrailingZeros(toPlainDecimal(numberText(value)));
  return stripTrailingZeros(toPlainDecimal(value.toPrecision(6)));
}

/** Rounds half away from zero to the given number of decimal places. */
export function roundHalfAwayFromZero(value: number, places: number): number {
  return Number(value.toFixed(places));
}

/** Whole percents, rounded half up. */
export function percentHalfUp(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.floor(Number(((part * 100) / whole).toFixed(10)) + 0.5);
}
