import type { Config } from './config.js';

const AMSTERDAM_TZ = 'Europe/Amsterdam';

// The shop clock: starts from SHOP_CLOCK_START and runs at SHOP_CLOCK_RATE.
const startedAt = Date.now();

export function shopNowMs(config: Config): number {
  const elapsedReal = Date.now() - startedAt;
  return config.shopClockStart.getTime() + Math.floor(elapsedReal * config.shopClockRate);
}

export function shopNow(config: Config): Date {
  return new Date(shopNowMs(config));
}

export function shopNowIso(config: Config): string {
  return shopNow(config).toISOString();
}

// Format an instant in Amsterdam local time parts.
export function amsterdamParts(ms: number): { date: string; time: string; offset: string; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: AMSTERDAM_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const hour = parts['hour'] === '24' ? '00' : parts['hour'];
  const offset = offsetString(ms);
  return {
    date: `${parts['year']}-${parts['month']}-${parts['day']}`,
    time: `${hour}:${parts['minute']}:${parts['second']}`,
    offset,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts['weekday']),
  };
}

export function offsetString(ms: number): string {
  // True offset on the given instant in Amsterdam.
  const dfm = new Intl.DateTimeFormat('en-US', { timeZone: AMSTERDAM_TZ, timeZoneName: 'longOffset' });
  const name = dfm.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+01:00';
  return name.startsWith('GMT') ? name.slice(3) : '+01:00';
}

// Parse an Amsterdam local date + time into an instant, honouring DST rules.
export function amsterdamInstant(date: string, time: string): { instant: number; exists: boolean; ambiguous: boolean } {
  // Determine the offset that applies on that local date.
  const guess = Date.parse(`${date}T${time.slice(0, 5)}:00Z`);
  if (!Number.isFinite(guess)) return { instant: 0, exists: false, ambiguous: false };
  let offset = offsetString(guess);
  let instant = Date.parse(`${date}T${time.slice(0, 5)}:00${offset === 'Z' ? '+00:00' : offset}`);
  // Spring-forward: if the local time does not exist, the computed instant jumps past.
  const back = offsetString(instant);
  if (back !== offset) {
    offset = back;
    instant = Date.parse(`${date}T${time.slice(0, 5)}:00${offset === 'Z' ? '+00:00' : offset}`);
  }
  const parts = amsterdamParts(instant);
  const exists = parts.date === date && parts.time.slice(0, 5) === time.slice(0, 5);
  // Ambiguous (autumn fall-back): the first occurrence.
  if (exists) {
    const earlier = instant - 3600_000;
    const earlierParts = amsterdamParts(earlier);
    if (earlierParts.date === date && earlierParts.time.slice(0, 5) === time.slice(0, 5)) {
      return { instant: earlier, exists: true, ambiguous: true };
    }
  }
  return { instant, exists, ambiguous: false };
}

export function amsterdamDateOf(ms: number): string {
  return amsterdamParts(ms).date;
}

// Midday and 18:00 cutoffs on a given Amsterdam date.
export function amsterdamNoon(date: string): number {
  return amsterdamInstant(date, '12:00').instant;
}

export function amsterdamDayBeforeAt18(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const prev = new Date(ms - 24 * 3600_000);
  const prevDate = amsterdamParts(prev.getTime()).date;
  return amsterdamInstant(prevDate, '18:00').instant;
}
