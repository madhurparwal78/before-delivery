// Exact rational arithmetic: every timecode, real-second and money value the
// app shows is computed from integer numerators and denominators, never from
// a float. The three domain arithmetic modules build on these.

export class Rat {
  readonly n: bigint;
  readonly d: bigint;

  constructor(n: bigint | number, d: bigint | number = 1n) {
    const nn = typeof n === "bigint" ? n : BigInt(n);
    let dd = typeof d === "bigint" ? d : BigInt(d);
    if (dd === 0n) throw new Error("zero denominator");
    const neg = dd < 0n;
    this.n = neg ? -nn : nn;
    this.d = neg ? -dd : dd;
  }

  static of(n: bigint | number, d: bigint | number = 1n): Rat {
    return new Rat(n, d);
  }

  add(o: Rat): Rat {
    return new Rat(this.n * o.d + o.n * this.d, this.d * o.d).norm();
  }

  sub(o: Rat): Rat {
    return new Rat(this.n * o.d - o.n * this.d, this.d * o.d).norm();
  }

  mul(o: Rat): Rat {
    return new Rat(this.n * o.n, this.d * o.d).norm();
  }

  div(o: Rat): Rat {
    return new Rat(this.n * o.d, this.d * o.n).norm();
  }

  cmp(o: Rat): number {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }

  isZero(): boolean {
    return this.n === 0n;
  }

  sign(): number {
    return this.n < 0n ? -1 : this.n > 0n ? 1 : 0;
  }

  norm(): Rat {
    if (this.n === 0n) return new Rat(0n, 1n);
    let a = this.n < 0n ? -this.n : this.n;
    let b = this.d;
    while (b !== 0n) {
      const t = a % b;
      a = b;
      b = t;
    }
    const g = a;
    return new Rat(this.n / g, this.d / g);
  }

  // Half-up to a whole number: 37.5 -> 38, ties away from zero.
  roundHalfUp(): bigint {
    const neg = this.n < 0n;
    const absN = neg ? -this.n : this.n;
    let q = absN / this.d;
    const r = absN % this.d;
    if (r * 2n >= this.d) q += 1n;
    return neg ? -q : q;
  }

  // Half-up to the given decimal places, returned as an exact scaled integer:
  // 5.005 at 2 places is 501, never 500.
  scaledHalfUp(places: number): bigint {
    const pow = 10n ** BigInt(places);
    return new Rat(this.n * pow, this.d).roundHalfUp();
  }
}

// Divide whole numbers, half up: a whole count that must come from an exact
// ratio of integers (frames from seconds, frames from words, cents from a
// percent).
export function divHalfUp(a: bigint, b: bigint): bigint {
  return new Rat(a, b).roundHalfUp();
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
