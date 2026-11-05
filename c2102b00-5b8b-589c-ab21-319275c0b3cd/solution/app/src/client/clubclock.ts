// Printing server instants in club time for form fields and tables. Never the device's zone.
import { session } from "./shell.js";

function parts(iso: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const found: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-US", { timeZone: session.club?.time_zone ?? "UTC", ...options });
  for (const p of format.formatToParts(new Date(iso))) found[p.type] = p.value;
  return found;
}

/** `YYYY-MM-DD HH:MM`, with `:SS` when the seconds are not zero. */
export function fieldValue(iso: string | null): string {
  if (!iso) return "";
  const p = parts(iso, { hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}${p.second === "00" ? "" : `:${p.second}`}`;
}

/** What a time field sends: `YYYY-MM-DDTHH:MM[:SS]`, the text unchanged when it is not that shape, null when empty. */
export function localText(value: string): string | null {
  const text = value.trim();
  if (text === "") return null;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text) ? text.replace(" ", "T") : text;
}

/** `Sat 31 Oct, 2:05 pm` for history rows. */
export function shortStamp(iso: string): string {
  const p = parts(iso, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} ${(p.dayPeriod ?? "").toLowerCase()}`;
}
