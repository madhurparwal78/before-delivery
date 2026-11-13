// One homography from four reference points, pixel to metres, with the check point
// residual that refuses a bad rectification (DP-05).

import { abs, add, fromString, mul, roundHalfEven, sub, toString as decToString, type Decimal } from '../shared/decimal.js';
import { sqrtDecimal } from './photometrics.js';

export interface Pixel {
  x: number;
  y: number;
}

export interface WallMetres {
  across: Decimal;
  down: Decimal;
}

export interface PointPair {
  pixel: Pixel;
  wall: WallMetres;
}

// Fractions as BigInt numerator/denominator pairs, always with denominator > 0.
type Fraction = { n: bigint; d: bigint };

export interface Rectification {
  homography: number[]; // row-major, pixel to metres, last element 1
  residualMetres: Decimal;
}

export function homographyOf(points: PointPair[], check: PointPair): Rectification | null {
  const solution = solveHomography(points);
  if (solution === null) return null;
  const homography = solution.map((f) => toNumber(fromFraction(f)));
  homography.push(1);
  return { homography, residualMetres: residualOf(solution, check) };
}

// The check point's residual: the wall-plane distance between the homography's image
// of its pixel and its measured position, rounded half-even to three decimals.
function residualOf(solution: Fraction[], check: PointPair): Decimal {
  const px = BigInt(Math.round(check.pixel.x));
  const py = BigInt(Math.round(check.pixel.y));
  const den = evaluateWith(solution[6]!, solution[7]!, one(), px, py);
  if (den.n === 0n) return fromString('0')!;
  const across = fractionToDecimal(divF(evaluateWith(solution[0]!, solution[1]!, solution[2]!, px, py), den), 50);
  const down = fractionToDecimal(divF(evaluateWith(solution[3]!, solution[4]!, solution[5]!, px, py), den), 50);
  const dx = sub(across, check.wall.across);
  const dy = sub(down, check.wall.down);
  return roundHalfEven(sqrtDecimal(add(mul(dx, dx), mul(dy, dy))), 3);
}

// a * x + b * y + c, with px and py scaled into the fractions' denominators.
function evaluateWith(a: Fraction, b: Fraction, c: Fraction, px: bigint, py: bigint): Fraction {
  const ax = mulF(a, bigFraction(px));
  const by = mulF(b, bigFraction(py));
  return addF(addF(ax, by), c);
}

export function residualText(residual: Decimal): string {
  return decToString(roundHalfEven(residual, 3));
}

// Any three points forming a triangle under 1 square pixel, or of zero area in metres,
// cannot fix the wall.
export function degenerateTriple(points: PointPair[]): boolean {
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        const pixelArea = Math.abs(triangleAreaPixels(points[i]!.pixel, points[j]!.pixel, points[k]!.pixel));
        if (pixelArea < 1) return true;
        if (isZeroDecimal(triangleAreaMetres(points[i]!.wall, points[j]!.wall, points[k]!.wall))) return true;
      }
    }
  }
  return false;
}

function triangleAreaPixels(a: Pixel, b: Pixel, c: Pixel): number {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

function triangleAreaMetres(a: WallMetres, b: WallMetres, c: WallMetres): Decimal {
  const left = mul(sub(b.across, a.across), sub(c.down, a.down));
  const right = mul(sub(c.across, a.across), sub(b.down, a.down));
  return abs(sub(left, right));
}

function isZeroDecimal(value: Decimal): boolean {
  return value.digits === '0';
}

function solveHomography(points: PointPair[]): Fraction[] | null {
  const size = 8;
  const rows: Fraction[][] = [];
  const targets: Fraction[] = [];
  for (const point of points) {
    const px = bigFraction(BigInt(Math.round(point.pixel.x)));
    const py = bigFraction(BigInt(Math.round(point.pixel.y)));
    const wx = decimalFraction(point.wall.across);
    const wy = decimalFraction(point.wall.down);
    rows.push([px, py, one(), zero(), zero(), zero(), negF(mulF(px, wx)), negF(mulF(py, wx))]);
    targets.push(wx);
    rows.push([zero(), zero(), zero(), px, py, one(), negF(mulF(px, wy)), negF(mulF(py, wy))]);
    targets.push(wy);
  }
  const augmented = rows.map((row, i) => [...row, targets[i]!]);
  for (let col = 0; col < size; col++) {
    let pivot = -1;
    for (let r = col; r < size; r++) {
      if (augmented[r]![col]!.n !== 0n) {
        pivot = r;
        break;
      }
    }
    if (pivot === -1) return null;
    const tmp = augmented[col]!;
    augmented[col] = augmented[pivot]!;
    augmented[pivot] = tmp;
    for (let r = 0; r < size; r++) {
      if (r === col) continue;
      const factor = divF(augmented[r]![col]!, augmented[col]![col]!);
      if (factor.n === 0n) continue;
      for (let c = col; c <= size; c++) {
        augmented[r]![c] = subF(augmented[r]![c]!, mulF(factor, augmented[col]![c]!));
      }
    }
  }
  const out: Fraction[] = [];
  for (let r = 0; r < size; r++) {
    out.push(reduce(divF(augmented[r]![size]!, augmented[r]![r]!)));
  }
  return out;
}

function zero(): Fraction {
  return { n: 0n, d: 1n };
}

function one(): Fraction {
  return { n: 1n, d: 1n };
}

function bigFraction(v: bigint): Fraction {
  return { n: v, d: 1n };
}

function decimalFraction(value: Decimal): Fraction {
  const denominator = 10n ** BigInt(value.scale);
  const numerator = BigInt(value.digits);
  return reduce({ n: value.negative ? -numerator : numerator, d: denominator });
}

function fromFraction(value: Fraction): Decimal {
  const shifted = (value.n * 10n ** BigInt(30)) / value.d;
  return decimalFromBigInt(shifted, 30);
}

// The homography is published as JSON numbers; build them from the exact decimal.
function toNumber(value: Decimal): number {
  const magnitude = Number(value.digits) / 10 ** value.scale;
  return value.negative ? -magnitude : magnitude;
}

function fractionToDecimal(value: Fraction, scale: number): Decimal {
  const shifted = (value.n * 10n ** BigInt(scale)) / value.d;
  return decimalFromBigInt(shifted, scale);
}

function decimalFromBigInt(value: bigint, scale: number): Decimal {
  const negative = value < 0n;
  let digits = (negative ? -value : value).toString();
  let sc = scale;
  while (sc > 0 && digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    sc--;
  }
  return { negative, digits, scale: sc };
}

function mulF(a: Fraction, b: Fraction): Fraction {
  return reduce({ n: a.n * b.n, d: a.d * b.d });
}

function addF(a: Fraction, b: Fraction): Fraction {
  return reduce({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
}

function subF(a: Fraction, b: Fraction): Fraction {
  return addF(a, negF(b));
}

function negF(a: Fraction): Fraction {
  return { n: -a.n, d: a.d };
}

function divF(a: Fraction, b: Fraction): Fraction {
  return reduce({ n: a.n * b.d, d: a.d * b.n });
}

function reduce(f: Fraction): Fraction {
  if (f.d < 0n) return reduce({ n: -f.n, d: -f.d });
  if (f.n === 0n) return { n: 0n, d: 1n };
  const g = gcd(absBig(f.n), f.d);
  return { n: f.n / g, d: f.d / g };
}

function absBig(v: bigint): bigint {
  return v < 0n ? -v : v;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}
