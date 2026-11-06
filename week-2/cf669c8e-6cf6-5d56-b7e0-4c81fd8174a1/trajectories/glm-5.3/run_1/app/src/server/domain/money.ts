// Money and geometry as integer cents and tenths of a millimetre.
// All rounding is half-up, decided here in exactly one place.

export function roundHalfUpDiv(numerator: number, denominator: number): number {
  // For non-negative integers; works for negatives too by symmetric half-up.
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const base = Math.floor(n / d);
  const rem = n % d;
  if (rem * 2 >= d) return sign * (base + 1);
  return sign * base;
}

// Line VAT from gross at a rate: gross * rate / (100 + rate), half up to the cent.
export function lineVatCents(grossCents: number, vatRatePct: number): number {
  if (vatRatePct === 0) return 0;
  return roundHalfUpDiv(grossCents * vatRatePct, 100 + vatRatePct);
}

// Deposit: 20% of total, half up; the rest into 3 instalments, leftovers to the earliest.
export function scheduleAmounts(totalCents: number): number[] {
  const deposit = roundHalfUpDiv(totalCents, 5);
  const rest = totalCents - deposit;
  const base = Math.floor(rest / 3);
  let leftover = rest - base * 3;
  const amounts: number[] = [deposit];
  for (let i = 0; i < 3; i++) {
    let amt = base;
    if (leftover > 0) {
      amt += 1;
      leftover -= 1;
    }
    amounts.push(amt);
  }
  return amounts;
}

// Split a payment across lines in proportion to line gross / total.
// Each line takes the floor of its share; leftover cents go one each to the
// largest fractional remainders, ties to the earlier line.
export function allocateToLines(paymentCents: number, lines: { id: string; grossCents: number }[]): Map<string, number> {
  const total = lines.reduce((s, l) => s + l.grossCents, 0);
  const result = new Map<string, number>();
  if (total === 0 || paymentCents === 0) {
    for (const l of lines) result.set(l.id, 0);
    return result;
  }
  const remainders: { id: string; rem: number; index: number }[] = [];
  let allocated = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const exact = (BigInt(paymentCents) * BigInt(l.grossCents)) / BigInt(total);
    const exactNum = Number(exact);
    const frac = (paymentCents * l.grossCents) % total;
    result.set(l.id, exactNum);
    allocated += exactNum;
    remainders.push({ id: l.id, rem: frac, index: i });
  }
  let leftover = paymentCents - allocated;
  remainders.sort((a, b) => b.rem - a.rem || a.index - b.index);
  for (const r of remainders) {
    if (leftover <= 0) break;
    result.set(r.id, result.get(r.id)! + 1);
    leftover -= 1;
  }
  return result;
}

// Level an unpaid balance over stages: equal whole cents, leftovers to the earliest.
export function levelAmounts(balanceCents: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(balanceCents / count);
  let leftover = balanceCents - base * count;
  const amounts: number[] = [];
  for (let i = 0; i < count; i++) {
    let amt = base;
    if (leftover > 0) {
      amt += 1;
      leftover -= 1;
    }
    amounts.push(amt);
  }
  return amounts;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  const abs = Math.abs(cents);
  return `${sign}€${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}
