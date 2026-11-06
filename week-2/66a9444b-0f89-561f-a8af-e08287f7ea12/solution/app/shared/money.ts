// Display only: integer cents as euros with two decimals and a leading euro sign, e.g. "€125.00".
export function euro(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}€${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** CSV amounts: two decimals and a dot, no sign of the currency. */
export function decimalEuros(cents: number): string {
  return euro(cents).replace("€", "");
}

/** Parses a typed euro amount ("12", "12.5", "12,50", "€12.50") into cents exactly, or null. */
export function parseEuros(text: string): number | null {
  const m = /^\s*€?\s*(\d{1,6})(?:[.,](\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}
