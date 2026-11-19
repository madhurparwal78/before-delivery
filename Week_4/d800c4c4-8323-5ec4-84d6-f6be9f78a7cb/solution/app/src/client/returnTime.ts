// Typed Return time is library-local wall-clock text; this turns it into ISO 8601 with the library
// offset for sending, whatever the browser's own time zone or clock.

type ReturnTime =
  | { kind: "empty" }
  | { kind: "malformed" }
  | { kind: "skipped" }
  | { kind: "once"; iso: string }
  | { kind: "repeated"; first: string; second: string; hour: number; laterZone: string };

const TYPED = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

function offsetMinutes(zone: string, instant: number): number {
  const parts: Record<string, number> = {};
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (const p of format.formatToParts(new Date(instant))) if (p.type !== "literal") parts[p.type] = Number(p.value);
  return Math.round((Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) - instant) / 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

function offsetText(minutes: number): string {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function readReturnTime(text: string, zone: string): ReturnTime {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  const m = TYPED.exec(trimmed);
  if (!m) return { kind: "malformed" };
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate() || h > 23 || mi > 59) return { kind: "malformed" };
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const candidates = [...new Set([offsetMinutes(zone, naive - 86_400_000), offsetMinutes(zone, naive + 86_400_000)])]
    .filter((offset) => offsetMinutes(zone, naive - offset * 60_000) === offset)
    .sort((a, b) => b - a); // the larger offset is the earlier instant
  const wall = `${trimmed.slice(0, 10)}T${trimmed.slice(11)}:00`;
  if (candidates.length === 0) return { kind: "skipped" };
  if (candidates.length === 1) return { kind: "once", iso: wall + offsetText(candidates[0]!) };
  const later = naive - candidates[1]! * 60_000;
  const laterZone =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(later)).find((p) => p.type === "timeZoneName")
      ?.value ?? offsetText(candidates[1]!);
  return { kind: "repeated", first: wall + offsetText(candidates[0]!), second: wall + offsetText(candidates[1]!), hour: h, laterZone };
}
