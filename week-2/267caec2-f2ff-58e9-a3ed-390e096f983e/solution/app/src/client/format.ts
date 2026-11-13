// Display helpers. Labels the server sends are shown as sent; these only write out cents and instants.

/** 4500 → "45.00". */
export function dollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** "45", "45.5" or "45.00" → 4500; anything else → null. Parsed as text, never as a float. */
export function cents(text: string): number | null {
  const match = /^\s*\$?(\d{1,6})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(instant: Date, zone: string): Record<string, number> {
  const out: Record<string, number> = {};
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  });
  for (const part of format.formatToParts(instant)) if (part.type !== "literal") out[part.type] = Number(part.value);
  return out;
}

/** "14:05 Asia/Kolkata, 3 Nov 2026": an instant written in the program's zone, never the browser's. */
export function zoneLabel(iso: string, zone: string): string {
  const p = parts(new Date(iso), zone);
  const two = (n: number | undefined) => String(n ?? 0).padStart(2, "0");
  return `${two(p.hour)}:${two(p.minute)} ${zone}, ${p.day} ${MONTHS[(p.month ?? 1) - 1]} ${p.year}`;
}

/** "2026-12-01 18:00" read as wall time in `zone` → ISO 8601 with that zone's offset. Full ISO input passes through. */
export function zonedIso(text: string, zone: string): string {
  const trimmed = text.trim();
  if (/(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) return trimmed;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return trimmed;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (instant: number) => {
    const p = parts(new Date(instant), zone);
    return (Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0) - Math.floor(instant / 60000) * 60000) / 60000;
  };
  const offset = offsetAt(wall - offsetAt(wall) * 60000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}
