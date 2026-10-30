/** Money is integer cents end to end; dollars appear only in display, email and billing bodies. */

export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const magnitude = Math.abs(cents);
  const dollars = Math.floor(magnitude / 100).toString();
  const grouped = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const centsPart = String(magnitude % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${grouped}.${centsPart}`;
}

/** Exact decimal dollars, as text, for a billing body. No floating point is involved. */
export function centsToDollarText(cents: number): string {
  const negative = cents < 0;
  const magnitude = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, "0")}`;
}

/** Parses a damage charge typed as dollars and cents into whole cents, or null when it isn't one. */
export function parseDollarsToCents(text: string): number | null {
  const trimmed = text.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (match === null) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const fraction = match[3] === undefined ? 0 : Number(match[3].padEnd(2, "0"));
  return sign * (Number(match[2]) * 100 + fraction);
}
