// Lateness rounding and overage pricing, in integer quarter hours and cents (BigInt, half up, once).
import { lateMinutes, type Cents, type Quarters } from "../shared/rules.ts";

/** Whole minutes from the booked end to check-out (seconds dropped), rounded up to quarter hours. */
export function lateQuarters(endAtMs: number, checkOutMs: number): Quarters {
  return Math.ceil(lateMinutes(endAtMs, checkOutMs) / 15);
}

/** "8.875" → 8875 thousandths of a percent. */
export function thousandths(percent: string): bigint {
  const [whole = "0", fraction = ""] = percent.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

/** n / d rounded half up, for non-negative n and positive d. */
function halfUp(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

interface OverageAmount {
  subtotal: Cents;
  tax: Cents;
  total: Cents;
}

/**
 * Exact subtotal = quarters × hourly ÷ 4; exact tax = that × percent ÷ 100. Each is rounded half up to
 * whole cents from its exact value, and the total is their sum.
 */
export function overageAmount(quarters: Quarters, hourlyRateCents: Cents, taxRatePercent: string): OverageAmount {
  const base = BigInt(quarters) * BigInt(hourlyRateCents);
  const subtotal = halfUp(base, 4n);
  const tax = halfUp(base * thousandths(taxRatePercent), 4n * 100n * 1000n);
  return { subtotal: Number(subtotal), tax: Number(tax), total: Number(subtotal + tax) };
}
