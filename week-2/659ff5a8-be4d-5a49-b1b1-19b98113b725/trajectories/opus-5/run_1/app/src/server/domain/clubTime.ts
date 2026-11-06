export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, created);
  return created;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zonedFieldsMs(instant: Date, timeZone: string): number {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number.parseInt(found.value, 10) : 0;
  };
  const hour = read('hour') % 24;
  return Date.UTC(read('year'), read('month') - 1, read('day'), hour, read('minute'), read('second'));
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const asUtc = new Date(zonedFieldsMs(instant, timeZone));
  return {
    year: asUtc.getUTCFullYear(),
    month: asUtc.getUTCMonth() + 1,
    day: asUtc.getUTCDate(),
    hour: asUtc.getUTCHours(),
    minute: asUtc.getUTCMinutes(),
  };
}

/** Turns a `YYYY-MM-DDTHH:MM` wall-clock reading in a zone into the UTC instant it names. */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match as unknown as [string, string, string, string, string, string];
  const wanted = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    0,
  );
  let guess = wanted;
  for (let pass = 0; pass < 3; pass += 1) {
    const offset = zonedFieldsMs(new Date(guess), timeZone) - guess;
    const next = wanted - offset;
    if (next === guess) break;
    guess = next;
  }
  const result = new Date(guess);
  if (Number.isNaN(result.getTime())) return null;
  const check = zonedParts(result, timeZone);
  const asked = { year: Number(y), month: Number(mo), day: Number(d), hour: Number(h), minute: Number(mi) };
  if (
    check.year !== asked.year ||
    check.month !== asked.month ||
    check.day !== asked.day ||
    check.hour !== asked.hour ||
    check.minute !== asked.minute
  ) {
    // A reading inside a spring-forward gap: the instant the zone jumps to.
    return result;
  }
  return result;
}

export function currentYearIn(timeZone: string, now: Date): number {
  return zonedParts(now, timeZone).year;
}

export function isoUtc(instant: Date): string {
  return instant.toISOString();
}
