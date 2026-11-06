// Integer-cent money helpers. Amounts never pass through floating point.

/** `$1,343.00` from integer cents, for display. */
export function formatDollars(cents: number): string {
  const rest = cents % 100;
  const whole = (cents - rest) / 100;
  return `$${whole.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
}

/** `85.75` from integer cents, for typed fields and Kill Bill amounts. */
export function plainDollars(cents: number): string {
  const rest = cents % 100;
  return `${(cents - rest) / 100}.${String(rest).padStart(2, "0")}`;
}

/** Integer cents from a typed dollar amount such as `85`, `85.7` or `85.75`; null when malformed. */
export function centsFromDollars(text: string): number | null {
  const match = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction, 10);
}
