/**
 * Deterministic elementary maths. Every result comes from IEEE-754 double
 * addition, subtraction, multiplication, division and square root, so the
 * simulation never depends on a platform's own transcendental library.
 */

const PIO2_HI = 1.5707963267948966;
const PIO2_LO = 6.123233995736766e-17;
const TWO_OVER_PI = 0.6366197723675814;

const S3 = 1 / 6;
const S5 = 1 / 120;
const S7 = 1 / 5040;
const S9 = 1 / 362880;
const S11 = 1 / 39916800;
const S13 = 1 / 6227020800;
const S15 = 1 / 1307674368000;
const S17 = 1 / 355687428096000;

const C2 = 1 / 2;
const C4 = 1 / 24;
const C6 = 1 / 720;
const C8 = 1 / 40320;
const C10 = 1 / 3628800;
const C12 = 1 / 479001600;
const C14 = 1 / 87178291200;
const C16 = 1 / 20922789888000;

/** sin on [-pi/4, pi/4] by Taylor series. */
function sinKernel(r: number): number {
  const r2 = r * r;
  return (
    r *
    (1 -
      r2 * (S3 - r2 * (S5 - r2 * (S7 - r2 * (S9 - r2 * (S11 - r2 * (S13 - r2 * (S15 - r2 * S17))))))))
  );
}

/** cos on [-pi/4, pi/4] by Taylor series. */
function cosKernel(r: number): number {
  const r2 = r * r;
  return (
    1 -
    r2 * (C2 - r2 * (C4 - r2 * (C6 - r2 * (C8 - r2 * (C10 - r2 * (C12 - r2 * (C14 - r2 * C16)))))))
  );
}

interface Reduced {
  quadrant: number;
  remainder: number;
}

function reduce(x: number): Reduced {
  const k = roundHalfAwayFromZero(x * TWO_OVER_PI);
  const remainder = x - k * PIO2_HI - k * PIO2_LO;
  const quadrant = ((k % 4) + 4) % 4;
  return { quadrant, remainder };
}

export function dsin(x: number): number {
  const { quadrant, remainder } = reduce(x);
  switch (quadrant) {
    case 0:
      return sinKernel(remainder);
    case 1:
      return cosKernel(remainder);
    case 2:
      return -sinKernel(remainder);
    default:
      return -cosKernel(remainder);
  }
}

export function dcos(x: number): number {
  const { quadrant, remainder } = reduce(x);
  switch (quadrant) {
    case 0:
      return cosKernel(remainder);
    case 1:
      return -sinKernel(remainder);
    case 2:
      return -cosKernel(remainder);
    default:
      return sinKernel(remainder);
  }
}

/** IEEE-754 square root is exactly rounded, so it is already portable. */
export function dsqrt(x: number): number {
  return Math.sqrt(x);
}

export const DEG_TO_RAD = 0.017453292519943295;

export function radians(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

export function roundHalfAwayFromZero(x: number): number {
  return x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5);
}

/** Rounds to `places` decimals, half away from zero. */
export function roundTo(value: number, places: number): number {
  const factor = Math.pow(10, places);
  const scaled = value * factor;
  const rounded = roundHalfAwayFromZero(scaled);
  const result = rounded / factor;
  return result === 0 ? 0 : result;
}

export function roundToMillionth(value: number): number {
  return roundTo(value, 6);
}
