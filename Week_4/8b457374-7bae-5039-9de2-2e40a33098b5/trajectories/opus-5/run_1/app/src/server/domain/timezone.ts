const DAY_MS = 86_400_000;

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  const existing = formatters.get(zone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(zone, created);
  return created;
}

/**
 * Accepts any IANA zone name the runtime knows, which is a wider set than
 * `Intl.supportedValuesOf('timeZone')`: that list leaves out link names such as `UTC`.
 */
export function isTimeZone(zone: string): boolean {
  if (zone === '') return false;
  try {
    formatterFor(zone);
    return true;
  } catch {
    formatters.delete(zone);
    return false;
  }
}

/** The wall-clock time in `zone` at `instantMs`, expressed as an as-if-UTC epoch. */
function wallClockAt(zone: string, instantMs: number): number {
  const parts = formatterFor(zone).formatToParts(new Date(instantMs));
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
}

export interface LocalDeadline {
  /** Normalised `YYYY-MM-DDTHH:MM:SS`. */
  readonly local: string;
  readonly instant: Date;
}

/**
 * Converts a wall-clock `YYYY-MM-DDTHH:MM[:SS]` in an IANA zone to one exact instant.
 * A local time the zone skips returns null; a local time that occurs twice takes the
 * earlier of the two instants.
 */
export function resolveLocalDeadline(localText: string, zone: string): LocalDeadline | null {
  const match = LOCAL_PATTERN.exec(localText);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = second === undefined ? 0 : Number(second);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;

  const wanted = Date.UTC(y, mo - 1, d, h, mi, s);
  // Reject calendar dates that do not exist, such as 31 February.
  const probe = new Date(wanted);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }

  // Offsets a day either side bracket any clock change at the wanted time.
  const offsets = [
    wallClockAt(zone, wanted - DAY_MS) - (wanted - DAY_MS),
    wallClockAt(zone, wanted + DAY_MS) - (wanted + DAY_MS),
  ];
  const candidates = [...new Set(offsets.map((offset) => wanted - offset))]
    .filter((instant) => wallClockAt(zone, instant) === wanted)
    .sort((a, b) => a - b);

  const chosen = candidates[0];
  if (chosen === undefined) return null;

  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return {
    local: `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`,
    instant: new Date(chosen),
  };
}
