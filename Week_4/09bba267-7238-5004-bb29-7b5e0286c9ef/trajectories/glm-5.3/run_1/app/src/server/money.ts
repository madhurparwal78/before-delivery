export const ORDER_FEE_CENTS = 150;

export function seatFeeCents(faceCents: number): number {
  return Math.round((faceCents * 650) / 10000);
}

export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const dollarsText = dollars.toLocaleString('en-US');
  const centsText = String(rest).padStart(2, '0');
  return `${negative ? '-' : ''}$${dollarsText}.${centsText}`;
}
