/** Local wall times in a classroom's IANA zone, converted in exactly one place. */

const LOCAL_FORM = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (zone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(zone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(zone, made);
  return made;
};

export const isValidZone = (zone: string): boolean => {
  if (!/^[A-Za-z]+(?:[/_+\-A-Za-z0-9]+)*$/.test(zone)) return false;
  try {
    formatterFor(zone).format(0);
    return true;
  } catch {
    return false;
  }
};

const partsInZone = (zone: string, utcMs: number): { asUtcMs: number; local: string } => {
  const parts = formatterFor(zone).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const second = get('second');
  return {
    asUtcMs: Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)),
    local: `${year}-${month}-${day}T${hour}:${minute}`,
  };
};

export const offsetMs = (zone: string, utcMs: number): number => partsInZone(zone, utcMs).asUtcMs - utcMs;

export interface LocalParse {
  ok: boolean;
  reason?: 'format' | 'gap';
  utcMs?: number;
}

/** `YYYY-MM-DDTHH:mm` (a space instead of `T` is accepted) in the zone, to a UTC instant. */
export const localToUtc = (zone: string, local: string): LocalParse => {
  const match = LOCAL_FORM.exec(local.trim());
  if (!match) return { ok: false, reason: 'format' };
  const [, y, mo, d, h, mi] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { ok: false, reason: 'format' };
  }
  const wanted = `${y}-${mo}-${d}T${h}:${mi}`;
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(naive).getUTCMonth() !== month - 1 || new Date(naive).getUTCDate() !== day) {
    return { ok: false, reason: 'format' };
  }
  const candidates = new Set<number>();
  const firstOffset = offsetMs(zone, naive);
  candidates.add(naive - firstOffset);
  candidates.add(naive - offsetMs(zone, naive - firstOffset));
  const valid = [...candidates].filter((ms) => partsInZone(zone, ms).local === wanted).sort((a, b) => a - b);
  if (valid.length === 0) return { ok: false, reason: 'gap' };
  return { ok: true, utcMs: valid[0] };
};

/** `YYYY-MM-DDTHH:mm` wall time in the zone for a UTC instant. */
export const utcToLocal = (zone: string, utcMs: number): string => partsInZone(zone, utcMs).local;

/** Adds whole days to an instant keeping the same local wall time in the zone. */
export const addDaysKeepingLocalTime = (zone: string, utcMs: number, days: number): number => {
  const local = utcToLocal(zone, utcMs);
  const match = LOCAL_FORM.exec(local);
  if (!match) throw new Error(`Unreadable local time ${local}`);
  const [, y, mo, d, h, mi] = match;
  const shifted = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d) + days, Number(h), Number(mi)));
  const target = `${shifted.getUTCFullYear().toString().padStart(4, '0')}-${(shifted.getUTCMonth() + 1)
    .toString()
    .padStart(2, '0')}-${shifted.getUTCDate().toString().padStart(2, '0')}T${shifted
    .getUTCHours()
    .toString()
    .padStart(2, '0')}:${shifted.getUTCMinutes().toString().padStart(2, '0')}`;
  const parsed = localToUtc(zone, target);
  if (parsed.ok && parsed.utcMs !== undefined) return parsed.utcMs;
  // The same wall time falls in a daylight-saving gap: step past the gap by an hour.
  const fallback = localToUtc(zone, target.replace(/T(\d{2})/, (_all, hh: string) => `T${String((Number(hh) + 1) % 24).padStart(2, '0')}`));
  return fallback.ok && fallback.utcMs !== undefined ? fallback.utcMs : utcMs + days * 86_400_000;
};
