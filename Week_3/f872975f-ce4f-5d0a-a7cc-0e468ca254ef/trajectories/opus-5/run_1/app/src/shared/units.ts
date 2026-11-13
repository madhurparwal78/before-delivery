export type Unit = 'mm' | 'in';

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Splits a decimal literal into an exact integer numerator over a power of ten. */
function exactDecimal(text: string): { value: bigint; scale: number } | null {
  const match = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/.exec(text);
  if (match === null) return null;
  const [, sign = '', whole = '', fraction = '', exponent] = match;
  if (whole === '' && fraction === '') return null;
  let value = BigInt(`${whole === '' ? '0' : whole}${fraction}`);
  let scale = fraction.length;
  if (exponent !== undefined) {
    const shift = Number(exponent);
    if (shift >= 0) {
      value *= 10n ** BigInt(shift);
    } else {
      scale += -shift;
    }
  }
  if (sign === '-') value = -value;
  return { value, scale };
}

/** Converts a decimal inch literal to whole millimetres, rounded half away from zero. */
export function inchesTextToMm(text: string): number | null {
  const decimal = exactDecimal(text);
  if (decimal === null) return null;
  const denominator = 10n ** BigInt(decimal.scale + 1);
  const magnitude = roundHalfUp(abs(decimal.value) * 254n, denominator);
  return Number(decimal.value < 0n ? -magnitude : magnitude);
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** Converts a JSON number of inches to whole millimetres, rounded half away from zero. */
export function inchesNumberToMm(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return inchesTextToMm(String(value));
}

export function mmToSixteenths(mm: number): number {
  const magnitude = Number(roundHalfUp(BigInt(Math.abs(Math.trunc(mm))) * 160n, 254n));
  return mm < 0 ? -magnitude : magnitude;
}

function reduceSixteenths(part: number): { numerator: number; denominator: number } {
  let numerator = part;
  let denominator = 16;
  while (numerator % 2 === 0 && numerator !== 0) {
    numerator /= 2;
    denominator /= 2;
  }
  return { numerator, denominator };
}

/** Renders millimetres as inches to the nearest sixteenth, as a whole number and reduced fraction. */
export function formatInches(mm: number): string {
  const sixteenths = mmToSixteenths(mm);
  if (sixteenths === 0) return '0 in';
  const negative = sixteenths < 0;
  const total = Math.abs(sixteenths);
  const whole = Math.floor(total / 16);
  const part = total % 16;
  const sign = negative ? '-' : '';
  if (part === 0) return `${sign}${whole} in`;
  const { numerator, denominator } = reduceSixteenths(part);
  if (whole === 0) return `${sign}${numerator}/${denominator} in`;
  return `${sign}${whole} ${numerator}/${denominator} in`;
}

export function formatMillimetres(mm: number): string {
  return `${mm} mm`;
}

export function formatLength(mm: number, unit: Unit): string {
  return unit === 'in' ? formatInches(mm) : formatMillimetres(mm);
}

/** Reads a length typed in the current unit as whole millimetres. */
export function parseLengthField(text: string, unit: Unit): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (unit === 'mm') {
    if (!/^\d+$/.test(trimmed)) return null;
    return Number(trimmed);
  }
  if (!/^\d*(\.\d*)?$/.test(trimmed)) return null;
  return inchesTextToMm(trimmed);
}
