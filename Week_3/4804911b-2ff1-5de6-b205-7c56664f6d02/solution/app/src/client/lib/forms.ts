/** Rupees typed as `18.75` to integer paise, or null when it is not a price. No floating point. */
export function toPaise(text: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
export const emptyToNull = (text: string): string | null => (text.trim() === "" ? null : text.trim());
