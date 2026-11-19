/**
 * The published display rule, owning every formatted number in Lozenge.
 */

/** Round half away from zero to `dp` decimals. */
export function roundAway(value: number, dp: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = Math.pow(10, dp);
  const scaled = value * factor;
  const rounded =
    scaled >= 0 ? Math.floor(scaled + 0.5) : -Math.floor(-scaled + 0.5);
  return rounded / factor;
}

/** Every computed value is an IEEE double, first rounded to 9 decimals. */
export function calcRound(value: number): number {
  return roundAway(value, 9);
}

function withCommas(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Numbers: comma thousands, at most 2 decimals, half away from zero, no trailing zeros. */
export function displayNumber(value: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "(null)";
  if (!Number.isFinite(value)) return String(value);
  const neg = value < 0;
  const abs = Math.abs(value);
  const rounded = roundAway(abs, 2);
  const [ip, fp] = String(rounded).split(".");
  const intText = withCommas(ip === "0" && rounded === 0 ? "0" : ip);
  const frac = (fp ?? "").replace(/0+$/, "");
  const body = frac.length > 0 ? `${intText}.${frac}` : intText;
  return neg && rounded !== 0 ? `-${body}` : body;
}

/** Shares: a percent with at most 1 decimal, no trailing zero. */
export function displayShare(fraction: number): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return "(null)";
  const pct = roundAway(fraction * 100, 1);
  const neg = pct < 0;
  const [ip, fp] = String(Math.abs(pct)).split(".");
  const frac = (fp ?? "").replace(/0+$/, "");
  const body = frac.length > 0 ? `${ip}.${frac}` : ip;
  return `${neg ? "-" : ""}${body}%`;
}

/** data-value: 4 decimals, half away from zero, no separators, no trailing zeros. */
export function dataValue(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const rounded = roundAway(value, 4);
  if (rounded === 0) return "0";
  const s = String(rounded);
  if (s.includes("e") || s.includes("E")) return String(Number(rounded.toFixed(4)));
  return s;
}

/** Dates as YYYY-MM-DD. */
export function displayDate(ms: number | null): string {
  if (ms === null || ms === undefined) return "(null)";
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function displayMonth(ms: number | null): string {
  if (ms === null || ms === undefined) return "(null)";
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function displayYear(ms: number | null): string {
  if (ms === null || ms === undefined) return "(null)";
  return String(new Date(ms).getUTCFullYear());
}

/** Times as 24-hour UTC YYYY-MM-DD HH:mm. */
export function displayUtc(ms: number | null): string {
  if (ms === null || ms === undefined) return "";
  const d = new Date(ms);
  const date = displayDate(ms);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${date} ${h}:${min}`;
}

export function isoUtc(ms: number): string {
  return new Date(ms).toISOString();
}
