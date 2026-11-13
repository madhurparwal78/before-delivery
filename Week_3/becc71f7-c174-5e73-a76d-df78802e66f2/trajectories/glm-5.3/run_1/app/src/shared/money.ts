// Money is integer cents everywhere; the only rounding in the product (DP-15, DP-26).

/** Markdown price: asking price × (100 − percentage) / 100, rounded half up (DP-15). */
export function markdownPriceCents(askingPriceCents: number, percentOff: number): number {
  return divRoundHalfUp(askingPriceCents * (100 - percentOff), 100);
}

/** Half-up integer division. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  // denominators here are always positive; works for negatives too via floor of scaled value
  const q = Math.trunc(numerator / denominator);
  const r = numerator - q * denominator;
  if (r * 2 >= denominator) return q + 1;
  if (-r * 2 > denominator) return q - 1;
  return q;
}

/** Consignor share of a sale: 60% up to €300.00, 70% above (DP-26). */
export function consignorShareCents(salePriceCents: number): number {
  const percent = salePriceCents <= 30000 ? 60 : 70;
  return divRoundHalfUp(salePriceCents * percent, 100);
}

/** VAT inside the commission: commission × 21 / 121 rounded half up (DP-26). */
export function vatInsideCents(commissionCents: number): number {
  return divRoundHalfUp(commissionCents * 21, 121);
}

/** Format cents as euros: €1,234.50 */
export function euros(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const wholeStr = whole.toLocaleString('en-US');
  return `${negative ? '-' : ''}€${wholeStr}.${String(frac).padStart(2, '0')}`;
}

/** Format cents as plain euros for files: 37.43 (no symbol, no separators) */
export function eurosPlain(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${cents < 0 ? '-' : ''}${whole}.${String(frac).padStart(2, '0')}`;
}

/** Parse a euros amount like "49.90" or "49.9" into integer cents; null when not a price. */
export function parseEuros(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  const cents = Number(w) * 100 + Number((f + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}
