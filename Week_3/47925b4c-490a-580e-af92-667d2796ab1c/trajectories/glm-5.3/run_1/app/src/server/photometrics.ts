// Photometrics computed in one place: every cell's illuminance, contrast, luminance,
// resolution and blend state, byte-identical on every process (DP-31, DP-32, DP-33).

import {
  abs,
  add,
  compare,
  div,
  fromInteger,
  fromString,
  isZero,
  make,
  mul,
  negate,
  roundHalfEven,
  sub,
  toString as decToString,
  type Decimal,
} from '../shared/decimal.js';
import { PI } from '../shared/quantities.js';

export interface PlacementGeometry {
  placementId: string;
  bodySerial: string | null;
  lensSerial: string;
  model: string;
  effectiveLumens: Decimal;
  nativeWidth: number;
  nativeHeight: number;
  aimAcross: Decimal;
  aimDown: Decimal;
  bodyAcross: Decimal;
  bodyDown: Decimal;
  standoff: Decimal;
  ratio: Decimal;
  shiftAcross: Decimal;
  shiftDown: Decimal;
}

export interface CellFigures {
  cell: string;
  ambientLux: Decimal | null;
  projectedLux: Decimal;
  totalLux: Decimal;
  luminanceCdM2: Decimal;
  contrast: Decimal | null;
  band: 'washed-out' | 'graphics' | 'image' | 'none';
  pixelsPerMetre: number;
  blended: boolean;
  litLevel: Decimal | null;
  hatched: boolean;
  contributions: ContributionFigures[];
}

export interface ContributionFigures {
  placementId: string;
  effectiveLumens: Decimal;
  throwMetres: Decimal;
  obliquityDegrees: Decimal;
  share: Decimal;
  lux: Decimal;
  imageCentreAcross: Decimal;
  imageCentreDown: Decimal;
  imageWidth: Decimal;
  pixelsNumerator: number;
}

export interface CellInput {
  name: string;
  column: number;
  row: number;
  centreAcross: Decimal;
  centreDown: Decimal;
  reflectance: Decimal;
  recess: Decimal;
  ambientLux: Decimal | null;
}

const HALF_METRE = make(false, '5', 1);
const ONE = fromInteger(1);
const GUARD = 42;

// Illuminance on a cell: the body's effective lumens over its image area at throw d,
// carried to the cell by the inverse-square law relative to d and by Lambert's cosine
// law, then scaled by the recess share and blend share.
export function computeCell(placements: PlacementGeometry[], cell: CellInput): CellFigures {
  const covered = placements.filter((p) => covers(p, cell));
  if (covered.length > 2) throw new Error('overlap limit must be enforced before photometrics');

  const contributions: ContributionFigures[] = covered.map((placement) => {
    const depth = add(placement.standoff, cell.recess);
    const across = sub(cell.centreAcross, placement.bodyAcross);
    const down = sub(cell.centreDown, placement.bodyDown);
    const throwMetres = sqrtDecimal(add(add(mul(across, across), mul(down, down)), mul(depth, depth)));
    const imageWidth = div(throwMetres, placement.ratio, GUARD);
    const aspect = div(fromInteger(placement.nativeHeight), fromInteger(placement.nativeWidth), GUARD);
    const imageHeight = mul(imageWidth, aspect);
    const shiftAcrossMetres = mul(imageWidth, div(placement.shiftAcross, fromInteger(100)));
    const shiftDownMetres = mul(imageHeight, div(placement.shiftDown, fromInteger(100)));
    const centreAcross = add(add(placement.aimAcross, shiftAcrossMetres), div(imageWidth, fromInteger(2)));
    const centreDown = add(add(placement.aimDown, shiftDownMetres), div(imageHeight, fromInteger(2)));
    const cosine = div(depth, throwMetres, GUARD);
    const obliquity = acosDegrees(cosine);
    const recessShare = recessShareOf(cell.recess, obliquity);
    const area = mul(imageWidth, imageHeight);
    const baseLux = div(placement.effectiveLumens, area, GUARD);
    const inverseSquare = mul(baseLux, mul(div(throwMetres, depth, GUARD), div(throwMetres, depth, GUARD)));
    const lux = mul(mul(mul(inverseSquare, cosine), recessShare), ONE);
    return {
      placementId: placement.placementId,
      effectiveLumens: placement.effectiveLumens,
      throwMetres,
      obliquityDegrees: obliquity,
      share: ONE,
      lux,
      imageCentreAcross: centreAcross,
      imageCentreDown: centreDown,
      imageWidth,
      pixelsNumerator: placement.nativeWidth,
    };
  });

  let blended = false;
  if (contributions.length === 2) {
    blended = true;
    applyBlendShares(contributions[0]!, contributions[1]!, cell.centreAcross);
    for (const contribution of contributions) {
      contribution.lux = mul(contribution.lux, contribution.share);
    }
  }

  let projected = zero();
  for (const contribution of contributions) projected = add(projected, contribution.lux);
  const ambient = cell.ambientLux;
  const total = add(projected, ambient ?? zero());
  const luminance = div(mul(total, cell.reflectance), fromString(PI)!, GUARD);
  const contrast = ambient === null || isZero(ambient) ? null : div(total, ambient, GUARD);

  return {
    cell: cell.name,
    ambientLux: ambient,
    projectedLux: projected,
    totalLux: total,
    luminanceCdM2: luminance,
    contrast,
    band: bandOf(contrast),
    pixelsPerMetre: pixelsPerMetre(contributions),
    blended,
    litLevel: contrast === null ? null : sub(ONE, div(ONE, contrast, GUARD)),
    hatched: contrast !== null && compare(contrast, fromInteger(3)) < 0,
    contributions,
  };
}

export function bandOf(contrast: Decimal | null): 'washed-out' | 'graphics' | 'image' | 'none' {
  if (contrast === null) return 'none';
  if (compare(contrast, fromInteger(3)) < 0) return 'washed-out';
  if (compare(contrast, fromInteger(5)) < 0) return 'graphics';
  return 'image';
}

export function bandWord(band: 'washed-out' | 'graphics' | 'image' | 'none'): string {
  switch (band) {
    case 'washed-out':
      return 'Washed out';
    case 'graphics':
      return 'Reads as graphics';
    case 'image':
      return 'Reads as image';
    case 'none':
      return 'No reading';
  }
}

// A cell is covered when its centre is in the half-open image rectangle.
export function covers(placement: PlacementGeometry, cell: CellInput): boolean {
  const depth = add(placement.standoff, cell.recess);
  const across = sub(cell.centreAcross, placement.bodyAcross);
  const down = sub(cell.centreDown, placement.bodyDown);
  const throwMetres = sqrtDecimal(add(add(mul(across, across), mul(down, down)), mul(depth, depth)));
  const imageWidth = div(throwMetres, placement.ratio, GUARD);
  const aspect = div(fromInteger(placement.nativeHeight), fromInteger(placement.nativeWidth), GUARD);
  const imageHeight = mul(imageWidth, aspect);
  const shiftAcrossMetres = mul(imageWidth, div(placement.shiftAcross, fromInteger(100)));
  const shiftDownMetres = mul(imageHeight, div(placement.shiftDown, fromInteger(100)));
  const left = add(placement.aimAcross, shiftAcrossMetres);
  const top = add(placement.aimDown, shiftDownMetres);
  return (
    compare(cell.centreAcross, left) >= 0 &&
    compare(cell.centreAcross, add(left, imageWidth)) < 0 &&
    compare(cell.centreDown, top) >= 0 &&
    compare(cell.centreDown, add(top, imageHeight)) < 0
  );
}

// Recess share = max(0, 1 - r * tan(theta) / 0.5).
export function recessShareOf(recess: Decimal, obliquityDegrees: Decimal): Decimal {
  if (isZero(recess)) return ONE;
  const tanTheta = tanOfDegrees(obliquityDegrees);
  const share = sub(ONE, div(mul(recess, tanTheta), HALF_METRE, GUARD));
  return compare(share, zero()) < 0 ? zero() : share;
}

// Light shares are complementary and linear across the overlap; the earlier placement
// wins a tie on which image centre is further left.
function applyBlendShares(first: ContributionFigures, second: ContributionFigures, cellAcross: Decimal): void {
  const leftMost = compare(first.imageCentreAcross, second.imageCentreAcross) <= 0 ? first : second;
  const rightMost = leftMost === first ? second : first;
  const overlapLeft = compare(rightMost.imageCentreAcross, leftMost.imageCentreAcross) > 0
    ? sub(rightMost.imageCentreAcross, div(rightMost.imageWidth, fromInteger(2)))
    : sub(leftMost.imageCentreAcross, div(leftMost.imageWidth, fromInteger(2)));
  const overlapRight = compare(rightMost.imageCentreAcross, leftMost.imageCentreAcross) > 0
    ? add(leftMost.imageCentreAcross, div(leftMost.imageWidth, fromInteger(2)))
    : add(rightMost.imageCentreAcross, div(rightMost.imageWidth, fromInteger(2)));
  const overlapWidth = sub(overlapRight, overlapLeft);
  const t = div(sub(cellAcross, overlapLeft), overlapWidth, GUARD);
  const clamped = compare(t, zero()) < 0 ? zero() : compare(t, ONE) > 0 ? ONE : t;
  leftMost.share = sub(ONE, clamped);
  rightMost.share = clamped;
}

// Pixels per metre is native width over image width, half-even to a whole number,
// the lower of the two bodies in a blend, 0 when uncovered.
function pixelsPerMetre(contributions: ContributionFigures[]): number {
  let best = 0;
  for (const contribution of contributions) {
    const rounded = Number(decToString(roundHalfEven(div(fromInteger(contribution.pixelsNumerator), contribution.imageWidth), 0)));
    best = best === 0 ? rounded : Math.min(best, rounded);
  }
  return best;
}

// The angle of the throw off the wall's normal.
export function acosDegrees(cosine: Decimal): Decimal {
  if (isZero(cosine)) return make(false, '90', 0);
  const sinTheta = sqrtDecimal(sub(ONE, mul(cosine, cosine)));
  const ratio = div(sinTheta, cosine, GUARD);
  const radians = atan(ratio);
  return roundHalfEven(abs(div(mul(radians, fromInteger(180)), fromString(PI)!, GUARD)), 4);
}

function tanOfDegrees(degrees: Decimal): Decimal {
  const radians = mul(degrees, div(fromString(PI)!, fromInteger(180), GUARD));
  return div(sinOf(radians), cosOf(radians), GUARD);
}

// Square root on exact decimals with a guard: root = floor(sqrt(value * 10^(2*guard)))
// returned at scale `guard`, so callers rounding to 4 decimals are unaffected by the
// truncation the guard exists to push beyond significance.
export function sqrtDecimal(value: Decimal): Decimal {
  if (isZero(value)) return zero();
  if (value.negative) throw new Error('sqrt of negative');
  const exponent = 2 * GUARD - value.scale;
  const numerator = exponent >= 0
    ? BigInt(value.digits) * 10n ** BigInt(exponent)
    : BigInt(value.digits) / 10n ** BigInt(-exponent);
  const root = isqrt(numerator);
  return fromBigIntScaled(root, GUARD);
}

// The integer digits of a decimal rescaled to the given power of ten.
function toBigInt(a: Decimal, asScale: number): bigint {
  if (a.scale === asScale) return BigInt(a.digits);
  if (a.scale < asScale) return BigInt(a.digits) * 10n ** BigInt(asScale - a.scale);
  return BigInt(a.digits) / 10n ** BigInt(a.scale - asScale);
}


function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (n + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

function sinOf(radians: Decimal): Decimal {
  const x = scaledInt(radians);
  const scale = 10n ** BigInt(GUARD);
  let sum = 0n;
  let term = x;
  let n = 1n;
  while (term !== 0n && n < 220n) {
    sum += term;
    term = -(term * x * x) / (scale * 2n * n * (2n * n + 1n));
    n += 1n;
  }
  return fromBigIntScaled(sum, GUARD);
}

function cosOf(radians: Decimal): Decimal {
  const x = scaledInt(radians);
  const scale = 10n ** BigInt(GUARD);
  let sum = scale;
  let term = scale;
  let n = 1n;
  while (term !== 0n && n < 220n) {
    term = -(term * x * x) / (scale * (2n * n - 1n) * (2n * n));
    sum += term;
    n += 1n;
  }
  return fromBigIntScaled(sum, GUARD);
}

export function atan(ratio: Decimal): Decimal {
  const piOverTwo = div(fromString(PI)!, fromInteger(2), GUARD);
  if (compare(abs(ratio), ONE) <= 0) return atanTaylor(ratio);
  const inverse = div(ONE, ratio, GUARD);
  return ratio.negative ? negate(sub(piOverTwo, atanTaylor(inverse))) : sub(piOverTwo, atanTaylor(inverse));
}

// atan(r) as a power series in r^2 around 0 for |r| <= 1: x - x^3/3 + x^5/5 - ...
export function atanTaylor(ratio: Decimal): Decimal {
  const x = scaledInt(ratio);
  const scale = 10n ** BigInt(GUARD);
  if (x === 0n) return zero();
  const xx = (x * x) / scale;
  let sum = x;
  let term = x;
  let n = 1n;
  while (n < 400n) {
    term = (term * xx) / scale;
    const quotient = term / (2n * n + 1n);
    if (quotient === 0n) break;
    sum += n % 2n === 1n ? -quotient : quotient;
    n += 1n;
  }
  return fromBigIntScaled(sum, GUARD);
}

function scaledInt(value: Decimal): bigint {
  const digits = toBigInt(value, GUARD);
  return value.negative ? -digits : digits;
}

function fromBigIntScaled(value: bigint, scale: number): Decimal {
  const negative = value < 0n;
  const mag = negative ? -value : value;
  return make(negative, mag.toString(), scale);
}

function zero(): Decimal {
  return make(false, '0', 0);
}
