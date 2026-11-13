// Server times on screen: `formatServerTime("2026-01-01T00:00:00.000Z", "Asia/Tokyo")` -> "2026-01-01 09:00:00 Asia/Tokyo",
// on a 24-hour clock with the IANA zone name. The zone is the viewer's profile zone (`useUser()?.time_zone`, see ui/time.tsx).
// The device clock is never read: only the instant the server returned is converted.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const known = formatters.get(zone);
  if (known) return known;
  try {
    const made = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, made);
    return made;
  } catch {
    return null;
  }
}

export function formatServerTime(iso: string, zone: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return iso;
  const formatter = formatterFor(zone) ?? formatterFor("UTC");
  if (!formatter) return iso;
  const label = formatterFor(zone) ? zone : "UTC";
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second} ${label}`;
}
