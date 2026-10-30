// Money in integer cents, and the published discount/voucher allocation rule.

export function euroCents(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  return `${sign}€${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

export interface Allocatable {
  position: number;
  list_cents: number;
}

export interface Allocated {
  position: number;
  list_cents: number;
  discount_cents: number;
  voucher_cents: number;
  charged_cents: number;
}

function halfUp(n: number): number {
  return Math.floor(n + 0.5);
}

// The group discount: percent of the subtotal, rounded half up to the cent.
export function groupDiscountCents(subtotalCents: number, percent: number): number {
  return halfUp((subtotalCents * percent) / 100);
}

// Spread a total across lines in proportion to weight:
// 1. whole-cent part of each exact share; 2. leftovers to the largest dropped
// fractions; 3. ties to the earlier line position.
export function spread(totalCents: number, weights: Allocatable[]): Map<number, number> {
  const out = new Map<number, number>();
  if (weights.length === 0) return out;
  const weightSum = weights.reduce((s, w) => s + w.list_cents, 0);
  if (weightSum <= 0 || totalCents <= 0) {
    for (const w of weights) out.set(w.position, 0);
    return out;
  }
  const rows = weights.map((w) => {
    const exact = (totalCents * w.list_cents) / weightSum;
    const whole = Math.floor(exact);
    return { position: w.position, exact, whole, dropped: exact - whole };
  });
  for (const r of rows) out.set(r.position, r.whole);
  let leftover = totalCents - rows.reduce((s, r) => s + r.whole, 0);
  const byDropped = [...rows].sort((a, b) =>
    b.dropped !== a.dropped ? b.dropped - a.dropped : a.position - b.position,
  );
  let i = 0;
  while (leftover > 0 && byDropped.length > 0) {
    out.set(byDropped[i % byDropped.length].position, (out.get(byDropped[i % byDropped.length].position) ?? 0) + 1);
    leftover -= 1;
    i += 1;
  }
  return out;
}

// The published allocation rule: group discount by list price, then voucher by
// each line's amount after its discount share.
export function allocateLines(
  lines: Allocatable[],
  groupDiscountTotal: number,
  voucherTotal: number,
): Allocated[] {
  const discountShares = spread(groupDiscountTotal, lines);
  const afterDiscount = lines.map((l) => ({
    position: l.position,
    list_cents: l.list_cents - (discountShares.get(l.position) ?? 0),
  }));
  const voucherShares = spread(voucherTotal, afterDiscount);
  return lines.map((l) => {
    const d = discountShares.get(l.position) ?? 0;
    const v = voucherShares.get(l.position) ?? 0;
    return {
      position: l.position,
      list_cents: l.list_cents,
      discount_cents: d,
      voucher_cents: v,
      charged_cents: l.list_cents - d - v,
    };
  });
}

// Order refs and pass codes: KF-XXXXXX / KFP-XXXXXXXXXX from A-Z and 2-9.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function codeChars(length: number, entropy: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < length; i += 1) {
    s += ALPHABET[Math.floor(entropy() * ALPHABET.length)];
  }
  return s;
}

export function newOrderRef(): string {
  return `KF-${codeChars(6)}`;
}

export function newPassCode(): string {
  return `KFP-${codeChars(10)}`;
}

export function newVoucherCode(): string {
  return `KERF-${codeChars(8)}`;
}
