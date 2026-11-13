import { type Decimal, divideRoundHalfEven, toFixed } from './decimal.js';

const view = new DataView(new ArrayBuffer(8));

/** The exact value of a finite double as a decimal, with no error of its own. */
function exactDecimalOfDouble(value: number): Decimal {
  if (value === 0) return { units: 0n, scale: 0 };
  view.setFloat64(0, value);
  const high = view.getUint32(0);
  const low = view.getUint32(4);
  const negative = (high & 0x80000000) !== 0;
  const exponent = (high >>> 20) & 0x7ff;
  const fraction = ((BigInt(high) & 0xfffffn) << 32n) | BigInt(low);
  const mantissa = exponent === 0 ? fraction : fraction | 1n << 52n;
  const power = (exponent === 0 ? 1 : exponent) - 1075;
  let units: bigint;
  let scale: number;
  if (power >= 0) {
    units = mantissa << BigInt(power);
    scale = 0;
  } else {
    units = mantissa * 5n ** BigInt(-power);
    scale = -power;
  }
  return { units: negative ? -units : units, scale };
}

/** Half-even rounding of a double to `scale` decimals, decided on its exact value. */
export function roundToScale(value: number, scale: number): number {
  const exact = exactDecimalOfDouble(value);
  if (exact.scale <= scale) return value === 0 ? 0 : value;
  const divisor = 10n ** BigInt(exact.scale - scale);
  const units = divideRoundHalfEven(exact.units, divisor);
  if (units === 0n) return 0;
  return Number(toFixed({ units, scale }, scale));
}

export function round4(value: number): number {
  return roundToScale(value, 4);
}

export function roundWholeHalfEven(value: number): number {
  const exact = exactDecimalOfDouble(value);
  const units = divideRoundHalfEven(exact.units, 10n ** BigInt(exact.scale));
  return Number(units);
}
