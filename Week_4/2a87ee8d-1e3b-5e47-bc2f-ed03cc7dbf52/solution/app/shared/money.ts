// Money as integer cents and exact two-decimal strings; never floating point.

export function centsToAmount(amountCents: number): string {
  const sign = amountCents < 0 ? "-" : "";
  const abs = Math.abs(amountCents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "1250.1" → 125010. Accepts 1 to 6 digits, optionally a point and 1 or 2 digits. */
export function amountToCents(amount: string): number | null {
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}
