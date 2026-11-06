// Display placeholders from Business rules, shared by emails and the browser.

// Building a formatter costs far more than formatting with one, and the timeline formats every operation's time.
const formats = new Map<string, Intl.DateTimeFormat>();

function parts(instant: Date, timeZone: string): Record<string, string> {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    formats.set(timeZone, format);
  }
  return Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
}

/** `<local time>`: `YYYY-MM-DD HH:mm:ss (<IANA zone>)`. */
export function localTime(iso: string, timeZone: string): string {
  return `${wallClock(iso, timeZone)} (${timeZone})`;
}

/** `YYYY-MM-DD HH:mm:ss` in the zone, without the zone suffix. */
function wallClock(iso: string, timeZone: string): string {
  const p = parts(new Date(iso), timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** `<local date>`: `YYYY-MM-DD`. */
export function localDate(iso: string, timeZone: string): string {
  return wallClock(iso, timeZone).slice(0, 10);
}

/** `HH:mm:ss` in the zone. */
export function clockTime(iso: string, timeZone: string): string {
  return wallClock(iso, timeZone).slice(11);
}

/** `$<amount>`: US dollars with thousands separators and two decimals. */
export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** ISO 8601 UTC to the second with a trailing Z. */
export function isoSecond(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const WALL = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** Reads `YYYY-MM-DD HH:mm:ss` as a wall-clock time in the zone; null when the entry has another format. */
export function zonedInstant(entry: string, timeZone: string): Date | null {
  const m = WALL.exec(entry.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const wanted = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess), timeZone);
    const seen = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    guess += wanted - seen;
  }
  return new Date(guess);
}
