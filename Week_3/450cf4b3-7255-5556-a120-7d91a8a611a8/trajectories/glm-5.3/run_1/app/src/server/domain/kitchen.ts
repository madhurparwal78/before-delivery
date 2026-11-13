// Kitchen-local wall-clock arithmetic on top of Intl, with no date library.
// One place converts between epoch milliseconds and kitchen-local date parts.

export interface WallParts {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
}

export class KitchenClock {
  readonly zone: string;
  private partsFmt: Intl.DateTimeFormat;
  private offsetFmt: Intl.DateTimeFormat;

  constructor(zone: string) {
    this.zone = zone;
    this.partsFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    this.offsetFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, timeZoneName: 'longOffset',
    });
  }

  parts(epochMs: number): WallParts {
    const parts = this.partsFmt.formatToParts(new Date(epochMs));
    const get = (t: string): number => {
      const p = parts.find((x) => x.type === t);
      return p ? Number(p.value) : 0;
    };
    let hour = get('hour');
    if (hour === 24) hour = 0;
    return {
      year: get('year'), month: get('month'), day: get('day'),
      hour, minute: get('minute'), second: get('second'),
    };
  }

  // Offset in minutes east of UTC that applies at the given epoch.
  offsetMinutes(epochMs: number): number {
    const name = this.offsetFmt.formatToParts(new Date(epochMs)).find((p) => p.type === 'timeZoneName');
    const text = name ? name.value : 'GMT+00:00';
    const m = /^(?:GMT)?([+-])(\d{1,2}):?(\d{2})?$/.exec(text);
    if (!m || m[1] === undefined) {
      const bare = /^([+-])(\d{1,2})(\d{2})$/.exec(text);
      if (bare) return (bare[1] === '-' ? -1 : 1) * (Number(bare[2]) * 60 + Number(bare[3] ?? '0'));
      return 0;
    }
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? '0'));
  }

  // Kitchen-local wall time to epoch. Two passes resolve the zone offset.
  fromParts(p: WallParts): number {
    const naive = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    let guess = naive - this.offsetMinutes(naive) * 60_000;
    guess = naive - this.offsetMinutes(guess) * 60_000;
    return guess;
  }

  fromWall(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
    return this.fromParts({ year, month, day, hour, minute, second });
  }

  // A date string is a real kitchen-local calendar date.
  parseDate(s: string): { year: number; month: number; day: number } | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    const epoch = this.fromWall(year, month, day);
    const back = this.parts(epoch);
    if (back.year !== year || back.month !== month || back.day !== day) return null;
    return { year, month, day };
  }

  dateKey(epochMs: number): string {
    const p = this.parts(epochMs);
    return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }

  hhmm(epochMs: number): string {
    const p = this.parts(epochMs);
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  }

  // Calendar day arithmetic on date keys: steps at local noon so DST cannot drift the date.
  addDaysKey(key: string, days: number): string {
    const [y, m, d] = key.split('-').map(Number);
    const epoch = this.fromWall(y, m, d, 12) + days * 86_400_000;
    return this.dateKey(epoch);
  }

  daysBetweenKeys(a: string, b: string): number {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    const ea = this.fromWall(ay, am, ad, 12);
    const eb = this.fromWall(by, bm, bd, 12);
    return Math.round((eb - ea) / 86_400_000);
  }

  iso(epochMs: number): string {
    const p = this.parts(epochMs);
    const off = this.offsetMinutes(epochMs);
    const sign = off < 0 ? '-' : '+';
    const abs = Math.abs(off);
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
      + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }

  // "Wed 28 Oct 2026"
  longDate(epochMs: number): string {
    const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: this.zone, weekday: 'short' }).format(new Date(epochMs));
    const rest = new Intl.DateTimeFormat('en-GB', { timeZone: this.zone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(epochMs));
    return `${weekday} ${rest}`;
  }

  longDateFromKey(key: string): string {
    const [y, m, d] = key.split('-').map(Number);
    return this.longDate(this.fromWall(y, m, d, 12));
  }

  zoneLabel(): string {
    return this.zone;
  }
}

export function parseIsoTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
  const frac = m[7] ? Number(`0.${m[7]}`) : 0;
  const offMs = offMsFrom(m[8]);
  if (offMs === null) return null;
  const epoch = Date.UTC(y, mo - 1, d, h, mi, s) - offMs;
  if (Number.isNaN(epoch)) return null;
  return epoch + Math.round(frac * 1000);
}

function offMsFrom(raw: string): number | null {
  if (raw === 'Z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(raw);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const total = Number(m[2]) * 60 + Number(m[3]);
  if (total > 17 * 60 + 59) return null;
  return sign * total * 60_000;
}

export function isHalfHourAligned(clock: KitchenClock, epochMs: number): boolean {
  const p = clock.parts(epochMs);
  return p.second === 0 && p.minute % 30 === 0;
}
