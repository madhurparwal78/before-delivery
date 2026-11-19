export const liftLocalPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = partsCache.get(timeZone);
  if (cached) {
    return cached;
  }
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
  partsCache.set(timeZone, created);
  return created;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockAt(timeZone: string, instant: number): WallClock {
  const parts = formatter(timeZone).formatToParts(new Date(instant));
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const hour = pick('hour');
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: hour === 24 ? 0 : hour,
    minute: pick('minute'),
    second: pick('second'),
  };
}

function offsetAt(timeZone: string, instant: number): number {
  const clock = wallClockAt(timeZone, instant);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return asUtc - instant;
}

/** Formats an instant as "YYYY-MM-DDTHH:MM" wall-clock time in the given zone. */
export function liftLocalOf(timeZone: string, instant: Date): string {
  const clock = wallClockAt(timeZone, instant.getTime());
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}T${pad(clock.hour)}:${pad(clock.minute)}`;
}

export type EmbargoResolution =
  | { readonly outcome: 'resolved'; readonly liftsAt: Date }
  | { readonly outcome: 'gap' };

/**
 * The one place that turns a workspace wall-clock lift time into an instant. A time inside a
 * spring-forward gap has no instant; a time that happens twice resolves to its first occurrence.
 */
export function resolveLiftLocal(liftLocal: string, timeZone: string): EmbargoResolution {
  const [datePart, timePart] = liftLocal.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const dayMs = 86_400_000;
  const offsets = new Set([offsetAt(timeZone, asUtc - dayMs), offsetAt(timeZone, asUtc + dayMs)]);
  const candidates: number[] = [];
  for (const offset of offsets) {
    const candidate = asUtc - offset;
    if (liftLocalOf(timeZone, new Date(candidate)) === liftLocal) {
      candidates.push(candidate);
    }
  }
  if (candidates.length === 0) {
    return { outcome: 'gap' };
  }
  return { outcome: 'resolved', liftsAt: new Date(Math.min(...candidates)) };
}
