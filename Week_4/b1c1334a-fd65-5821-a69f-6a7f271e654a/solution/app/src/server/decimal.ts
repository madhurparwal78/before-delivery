// Exact decimal arithmetic: a value is an integer coefficient over a power of ten.
// Every rule about reading, rounding and showing a Decimal lives here.

const DIVISION_DIGITS = 30;

export class Dec {
  private constructor(
    readonly coefficient: bigint,
    readonly scale: number,
  ) {}

  static of(coefficient: bigint, scale = 0): Dec {
    let c = coefficient;
    let s = scale;
    while (s > 0 && c % 10n === 0n) {
      c /= 10n;
      s--;
    }
    if (s < 0) {
      c *= 10n ** BigInt(-s);
      s = 0;
    }
    return new Dec(c, s);
  }

  static readonly zero = Dec.of(0n);

  // Reads `-?digits[.digits]` exactly; anything else is not a decimal literal.
  static parse(text: string): Dec | null {
    const match = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(text);
    if (!match) return null;
    const fraction = match[3] ?? "";
    const coefficient = BigInt(match[2]! + fraction);
    return Dec.of(match[1] ? -coefficient : coefficient, fraction.length);
  }

  private align(other: Dec): [bigint, bigint, number] {
    const scale = Math.max(this.scale, other.scale);
    return [
      this.coefficient * 10n ** BigInt(scale - this.scale),
      other.coefficient * 10n ** BigInt(scale - other.scale),
      scale,
    ];
  }

  add(other: Dec): Dec {
    const [a, b, s] = this.align(other);
    return Dec.of(a + b, s);
  }

  sub(other: Dec): Dec {
    const [a, b, s] = this.align(other);
    return Dec.of(a - b, s);
  }

  mul(other: Dec): Dec {
    return Dec.of(this.coefficient * other.coefficient, this.scale + other.scale);
  }

  neg(): Dec {
    return Dec.of(-this.coefficient, this.scale);
  }

  isZero(): boolean {
    return this.coefficient === 0n;
  }

  // Carries the quotient to at least DIVISION_DIGITS significant digits.
  div(other: Dec): Dec {
    const digits = (v: bigint) => (v < 0n ? -v : v).toString().length;
    const extra = Math.max(0, DIVISION_DIGITS + digits(other.coefficient) - digits(this.coefficient));
    const quotient = (this.coefficient * 10n ** BigInt(extra)) / other.coefficient;
    return Dec.of(quotient, this.scale - other.scale + extra);
  }

  compare(other: Dec): number {
    const [a, b] = this.align(other);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  isWhole(): boolean {
    return this.scale === 0;
  }

  // Half away from zero to `places` decimal places.
  round(places: number): Dec {
    if (this.scale <= places) return this;
    const drop = 10n ** BigInt(this.scale - places);
    const magnitude = this.coefficient < 0n ? -this.coefficient : this.coefficient;
    let kept = magnitude / drop;
    if ((magnitude % drop) * 2n >= drop) kept += 1n;
    return Dec.of(this.coefficient < 0n ? -kept : kept, places);
  }

  // The canonical display: exactly four places, and never a negative zero.
  display(): string {
    const rounded = this.round(4);
    const scaled = rounded.coefficient * 10n ** BigInt(4 - rounded.scale);
    const negative = scaled < 0n;
    const digits = (negative ? -scaled : scaled).toString().padStart(5, "0");
    return `${negative ? "-" : ""}${digits.slice(0, -4)}.${digits.slice(-4)}`;
  }
}

// A Decimal as a cell accepts it: no exponent, at most 15 digits before the point.
export function readDecimalText(text: string): Dec | null {
  const match = /^-?([0-9]+)(?:\.[0-9]+)?$/.exec(text);
  if (!match || match[1]!.length > 15) return null;
  return Dec.parse(text);
}
