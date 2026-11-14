/** A failure while calculating; `reason` is the published reason text. */
export class CalcError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export const REASON = {
  divisionByZero: "division by zero.",
  needsNumber: "it needs a number.",
  cannotCompare: "these answers cannot be compared.",
  power: "the power must be a whole number from 0 to 64.",
  tooLarge: "the number is too large.",
  needsDate: "it needs a date written YYYY-MM-DD.",
} as const;

const MAX_DIGITS = 1000;
const DIVISION_PLACES = 12;

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** Divides and rounds half away from zero. */
function divRound(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  if (r === 0n) return q;
  const sign = (a < 0n) !== (b < 0n) ? -1n : 1n;
  return 2n * abs(r) >= abs(b) ? q + sign : q;
}

/** An exact decimal: `m / 10^s`, kept without trailing zeros after the point. */
export class Decimal {
  readonly m: bigint;
  readonly s: number;

  constructor(m: bigint, s: number) {
    let mm = m;
    let ss = s;
    while (ss > 0 && mm % 10n === 0n) {
      mm /= 10n;
      ss -= 1;
    }
    this.m = mm;
    this.s = ss;
    if (this.digits() > MAX_DIGITS) throw new CalcError(REASON.tooLarge);
  }

  static readonly ZERO = new Decimal(0n, 0);

  static parse(text: string): Decimal | null {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
    if (!match) return null;
    const frac = match[3] ?? "";
    const m = BigInt(match[2] + frac);
    return new Decimal(match[1] === "-" ? -m : m, frac.length);
  }

  static fromInt(n: number): Decimal {
    return new Decimal(BigInt(n), 0);
  }

  private digits(): number {
    const whole = abs(this.m) / pow10(this.s);
    return whole.toString().length + this.s;
  }

  private aligned(other: Decimal): [bigint, bigint, number] {
    const s = Math.max(this.s, other.s);
    return [this.m * pow10(s - this.s), other.m * pow10(s - other.s), s];
  }

  add(o: Decimal): Decimal {
    const [a, b, s] = this.aligned(o);
    return new Decimal(a + b, s);
  }

  sub(o: Decimal): Decimal {
    const [a, b, s] = this.aligned(o);
    return new Decimal(a - b, s);
  }

  mul(o: Decimal): Decimal {
    return new Decimal(this.m * o.m, this.s + o.s);
  }

  neg(): Decimal {
    return new Decimal(-this.m, this.s);
  }

  /** Division kept to 12 places, rounding half away from zero. */
  div(o: Decimal): Decimal {
    if (o.m === 0n) throw new CalcError(REASON.divisionByZero);
    const num = this.m * pow10(o.s + DIVISION_PLACES);
    const den = o.m * pow10(this.s);
    return new Decimal(divRound(num, den), DIVISION_PLACES);
  }

  /** Remainder taking the sign of the right side. */
  mod(o: Decimal): Decimal {
    if (o.m === 0n) throw new CalcError(REASON.divisionByZero);
    const [a, b, s] = this.aligned(o);
    let r = a % b;
    if (r !== 0n && (r < 0n) !== (b < 0n)) r += b;
    return new Decimal(r, s);
  }

  pow(exponent: Decimal): Decimal {
    if (exponent.s !== 0 || exponent.m < 0n || exponent.m > 64n) throw new CalcError(REASON.power);
    let result = new Decimal(1n, 0);
    for (let i = 0n; i < exponent.m; i++) result = result.mul(this);
    return result;
  }

  cmp(o: Decimal): number {
    const [a, b] = this.aligned(o);
    return a === b ? 0 : a < b ? -1 : 1;
  }

  isZero(): boolean {
    return this.m === 0n;
  }

  isInteger(): boolean {
    return this.s === 0;
  }

  /** Rounds half away from zero to `places` decimals (negative rounds to tens, hundreds...). */
  round(places: number): Decimal {
    if (places >= this.s) return this;
    const shift = this.s - places;
    const q = divRound(this.m, pow10(shift));
    return places >= 0 ? new Decimal(q, places) : new Decimal(q * pow10(-places), 0);
  }

  floor(): Decimal {
    if (this.s === 0) return this;
    const p = pow10(this.s);
    let q = this.m / p;
    if (this.m < 0n) q -= 1n;
    return new Decimal(q, 0);
  }

  ceil(): Decimal {
    if (this.s === 0) return this;
    const p = pow10(this.s);
    let q = this.m / p;
    if (this.m > 0n) q += 1n;
    return new Decimal(q, 0);
  }

  trunc(): Decimal {
    return new Decimal(this.m / pow10(this.s), 0);
  }

  abs(): Decimal {
    return new Decimal(abs(this.m), this.s);
  }

  toNumber(): number {
    return Number(this.toText());
  }

  /** Number text: no trailing zeros, no exponent. */
  toText(): string {
    return this.toFixed(this.s);
  }

  /** Exactly `places` decimals (after rounding half away from zero). */
  toFixed(places: number): string {
    const r = this.round(places);
    const scale = Math.max(places, 0);
    const m = r.m * pow10(scale - r.s);
    const neg = m < 0n;
    let digits = abs(m).toString();
    if (scale > 0) {
      digits = digits.padStart(scale + 1, "0");
      digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    }
    return neg ? `-${digits}` : digits;
  }
}
