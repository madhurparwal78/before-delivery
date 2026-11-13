// Shared UI constants and helpers. The palette in words (Visual design) is applied in styles.css.

export const FIELD_ORDER = [
  "photo", "swatch", "title", "maker", "year", "unit", "width", "height", "depth",
  "materials", "finish", "colour_family", "source_url", "source_note", "notes",
] as const;

export function cls(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(" ");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

// Dates are built from the API's YYYY-MM-DD string, never from the browser clock.
export function formatDate(dateYyyyMmDd: string): string {
  const [y, m, d] = dateYyyyMmDd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 86400) / 60)}m`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
