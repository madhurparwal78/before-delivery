// Exact rational numbers over BigInt. Tonnes, areas, coverage and the buffer are computed with these,
// never with binary floating point; rounding is half to even at a stated number of decimals.

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d !== 0n && (n < 0n) !== (d < 0n) ? q - 1n : q;
}

export class Rational {
  readonly num: bigint;
  readonly den: bigint;

  private constructor(num: bigint, den: bigint) {
    const sign = den < 0n ? -1n : 1n;
    const g = gcd(num, den) || 1n;
    this.num = (sign * num) / g;
    this.den = (sign * den) / g;
  }

  static of(num: bigint, den = 1n): Rational {
    if (den === 0n) throw new RangeError("zero denominator");
    return new Rational(num, den);
  }

  /** An exact decimal literal such as "0.00004401", "-3.5" or "1e-4". */
  static decimal(text: string): Rational {
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!match) throw new RangeError(`not a decimal: ${text}`);
    const [, sign, whole, fraction = "", exponent = "0"] = match;
    const digits = BigInt(`${sign}${whole}${fraction}`);
    const shift = Number(exponent) - fraction.length;
    return shift >= 0 ? Rational.of(digits * 10n ** BigInt(shift)) : Rational.of(digits, 10n ** BigInt(-shift));
  }

  static readonly ZERO = Rational.of(0n);

  add(o: Rational): Rational {
    return Rational.of(this.num * o.den + o.num * this.den, this.den * o.den);
  }

  sub(o: Rational): Rational {
    return Rational.of(this.num * o.den - o.num * this.den, this.den * o.den);
  }

  mul(o: Rational): Rational {
    return Rational.of(this.num * o.num, this.den * o.den);
  }

  div(o: Rational): Rational {
    return Rational.of(this.num * o.den, this.den * o.num);
  }

  cmp(o: Rational): number {
    const left = this.num * o.den;
    const right = o.num * this.den;
    return left < right ? -1 : left > right ? 1 : 0;
  }

  /** The value in units of 10^-decimals, rounded half to even. */
  roundHalfEven(decimals: number): bigint {
    const scaledNum = this.num * 10n ** BigInt(decimals);
    const floor = floorDiv(scaledNum, this.den);
    const twiceRemainder = 2n * (scaledNum - floor * this.den);
    if (twiceRemainder > this.den) return floor + 1n;
    if (twiceRemainder < this.den) return floor;
    return floor % 2n === 0n ? floor : floor + 1n;
  }

  /** The value in units of 10^-decimals, rounded toward negative infinity. */
  floor(decimals: number): bigint {
    return floorDiv(this.num * 10n ** BigInt(decimals), this.den);
  }
}

/** A fixed-point integer in units of 10^-decimals as text: "-16.808", "0.000", "85.0". */
export function fixed(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(decimals + 1, "0");
  const text = decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
  return negative ? `-${text}` : text;
}
