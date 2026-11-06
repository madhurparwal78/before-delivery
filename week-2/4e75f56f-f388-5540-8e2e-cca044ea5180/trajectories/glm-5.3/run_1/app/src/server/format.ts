/** Money is integer cents end to end; formatted only for screens, PDFs and email. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${dollars.toLocaleString("en-US")}.${frac}`;
}

export function tierName(tier: string): string {
  return tier === "atelier" ? "Atelier" : "Bench";
}
