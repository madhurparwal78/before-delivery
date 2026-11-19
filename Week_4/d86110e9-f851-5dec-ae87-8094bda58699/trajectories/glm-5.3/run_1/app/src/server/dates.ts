// Formatting times in the workspace zone for API output. The browser only
// renders these strings; it never interprets them.

import { CONFIG } from "./config.js";

const zone = CONFIG.timeZone;
const cachedFmt = new Map<string, { fmt: Intl.DateTimeFormat; cache: Map<string, string> }>();

function fmtFor(zone: string): { fmt: Intl.DateTimeFormat; cache: Map<string, string> } {
  let e = cachedFmt.get(zone);
  if (!e) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false, timeZoneName: "short",
    });
    e = { fmt, cache: new Map() };
    cachedFmt.set(zone, e);
  }
  return e;
}

// "2027-03-14 03:00:00 EDT"
export function formatWs(iso: string | null | undefined): string {
  if (!iso) return "";
  const { fmt, cache } = fmtFor(zone);
  const day = iso.slice(0, 10);
  const hit = cache.get(iso);
  if (hit !== undefined) return hit;
  const parts = fmt.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const abbr = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const y = get("year"); const mo = get("monthLiteral") || get("month"); const d = get("day");
  const h = get("hour"); const mi = get("minute"); const se = get("second");
  const out = `${y}-${mo}-${d} ${h}:${mi}:${se} ${abbr}`;
  if (cache.size < 500) cache.set(iso, out);
  void day;
  return out;
}

// Zone parts for schedule resolution (daily at HH:MM in the workspace zone).
export function zonedParts(d: Date, zoneOverride?: string): { y: number; m: number; day: number; h: number; mi: number } {
  const { fmt } = fmtFor(zoneOverride ?? zone);
  const parts = fmt.formatToParts(d);
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: num("year"), m: num("monthLiteral") || num("month"), day: num("day"), h: num("hour") % 24, mi: num("minute") };
}
