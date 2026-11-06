// Exact decimal arithmetic on BigInt. No floating point anywhere in this module.

export class Decimal {
  readonly units: bigint;
  readonly scale: number;

  constructor(units: bigint, scale: number) {
    this.units = units;
    this.scale = scale;
  }

  static fromString(s: string): Decimal | null {
    const t = s.trim();
    if (t === "") return null;
    let sign = 1n;
    let body = t;
    if (body.startsWith("-")) {
      sign = -1n;
      body = body.slice(1);
    } else if (body.startsWith("+")) {
      body = body.slice(1);
    }
    if (!/^\d+(\.\d+)?$/.test(body)) return null;
    const [intPart, fracPart = ""] = body.split(".");
    return new Decimal(sign * BigInt(intPart + fracPart), fracPart.length);
  }

  static fromInteger(n: bigint | number): Decimal {
    return new Decimal(BigInt(n), 0);
  }

  static zero = new Decimal(0n, 0);

  equals(other: Decimal): boolean {
    const scale = Math.max(this.scale, other.scale);
    return this.rescale(scale) === other.rescale(scale);
  }

  compareTo(other: Decimal): number {
    const scale = Math.max(this.scale, other.scale);
    const x = this.rescale(scale);
    const y = other.rescale(scale);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  private rescale(scale: number): bigint {
    if (scale === this.scale) return this.units;
    if (scale > this.scale) return this.units * 10n ** BigInt(scale - this.scale);
    return this.units / 10n ** BigInt(this.scale - scale);
  }

  add(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(this.rescale(scale) + other.rescale(scale), scale);
  }

  sub(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(this.rescale(scale) - other.rescale(scale), scale);
  }

  mul(other: Decimal): Decimal {
    return new Decimal(this.units * other.units, this.scale + other.scale);
  }

  /** Divide by a nonzero divisor with exactly `fracDigits` fractional digits, half away from zero. */
  div(other: Decimal, fracDigits: number): Decimal {
    if (other.units === 0n) throw new Error("division by zero");
    const scale = fracDigits + other.scale - this.scale;
    const numerator = this.units * 10n ** BigInt(scale);
    const denominator = other.units < 0n ? -other.units : other.units;
    const isNegative = (this.units < 0n) !== (other.units < 0n);
    const absNum = numerator < 0n ? -numerator : numerator;
    const q = absNum / denominator;
    const r = absNum % denominator;
    const twice = r * 2n;
    let rounded = q;
    if (twice >= denominator) rounded = q + 1n;
    return new Decimal(isNegative ? -rounded : rounded, fracDigits);
  }

  /** The value at exactly `fracDigits` fractional digits, half away from zero. */
  round(fracDigits: number): Decimal {
    if (this.scale <= fracDigits) {
      return new Decimal(this.units * 10n ** BigInt(fracDigits - this.scale), fracDigits);
    }
    const drop = this.scale - fracDigits;
    const divisor = 10n ** BigInt(drop);
    const absUnits = this.units < 0n ? -this.units : this.units;
    const q = absUnits / divisor;
    const r = absUnits % divisor;
    const twice = r * 2n;
    let rounded = q;
    if (twice >= divisor) rounded = q + 1n;
    if (this.units < 0n) rounded = -rounded;
    return new Decimal(rounded, fracDigits);
  }

  /** 18-fractional-digit canonical string. */
  toValueString(): string {
    return this.round(18).toFixed(18);
  }

  toFixed(fracDigits: number): string {
    const r = this.round(fracDigits);
    const divisor = 10n ** BigInt(fracDigits);
    const abs = r.units < 0n ? -r.units : r.units;
    const intPart = (abs / divisor).toString();
    const fracPart = fracDigits > 0 ? (abs % divisor).toString().padStart(fracDigits, "0") : "";
    return (r.units < 0n ? "-" : "") + intPart + (fracDigits > 0 ? "." + fracPart : "");
  }

  toString(): string {
    const abs = this.units < 0n ? -this.units : this.units;
    const divisor = 10n ** BigInt(this.scale);
    const intPart = (abs / divisor).toString();
    const fracPart = this.scale > 0 ? (abs % divisor).toString().padStart(this.scale, "0") : "";
    return (this.units < 0n ? "-" : "") + intPart + (this.scale > 0 ? "." + fracPart : "");
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  isPositive(): boolean {
    return this.units > 0n;
  }

  toBigIntIntPart(): bigint {
    return this.units / 10n ** BigInt(this.scale);
  }
}

/** Thousands-separated integer part string: "1234567" -> "1,234,567". */
export function groupIntPart(intPart: string): string {
  const negative = intPart.startsWith("-");
  const body = negative ? intPart.slice(1) : intPart;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? "-" + grouped : grouped;
}
