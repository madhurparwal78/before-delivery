/** The single money computation: integer euro cents with half-up rounding at the cent. */

export function discountedPrice(listCents: number, discountPercent: number): number {
  // list × (100 − discount) / 100, rounded half up to the cent
  const scaled = Math.round(listCents * (100 - discountPercent));
  return Math.floor(scaled / 100) + (scaled % 100 >= 50 ? 1 : 0);
}

export function upgradeAmount(targetPriceCents: number, paidCents: number): number {
  return targetPriceCents - paidCents;
}

export function seatRefundAmount(amountCents: number, seats: number): number {
  // amount × seats ÷ 3, rounded half up to the cent
  const scaled = Math.abs(amountCents) * seats;
  return Math.floor((scaled * 2 + 3) / 6);
}

export function eurosFromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function centsFromEurosText(text: string): number | null {
  const match = /^\s*(\d{1,6})(?:[.,](\d{1,2}))?\s*$/.exec(text);
  if (match === null) return null;
  const whole = Number(match[1]);
  const part = match[2] ?? '';
  const partCents = Number(part === '' ? '0' : part.padEnd(2, '0'));
  return whole * 100 + partCents;
}
