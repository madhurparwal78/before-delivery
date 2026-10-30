export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${sign}$${whole.toLocaleString('en-US')}.${fraction}`;
}

function zoneParts(iso: string, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(iso))) {
    parts[part.type] = part.value;
  }
  return parts;
}

/** `YYYY-MM-DD HH:mm:ss (<IANA zone>)` in the workspace time zone. */
export function formatLocalTime(iso: string, timeZone: string): string {
  const p = zoneParts(iso, timeZone);
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second} (${timeZone})`;
}

/** `YYYY-MM-DD` in the workspace time zone. */
export function formatLocalDate(iso: string, timeZone: string): string {
  const p = zoneParts(iso, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `HH:mm:ss` in the workspace time zone. */
export function formatClockTime(iso: string, timeZone: string): string {
  const p = zoneParts(iso, timeZone);
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${hour}:${p.minute}:${p.second}`;
}

/** Parses `YYYY-MM-DD HH:mm:ss` in the given zone into an ISO instant. */
export function parseZonedTimestamp(input: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (!Number.isFinite(asUtc)) return null;
  let guess = asUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zoneParts(new Date(guess).toISOString(), timeZone);
    const mapped = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour === '24' ? '00' : parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const drift = asUtc - mapped;
    if (drift === 0) break;
    guess += drift;
  }
  return new Date(guess).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function shortNumber(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000;
  const normalised = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalised);
}

export function formatVec(value: readonly number[]): string {
  return `[${value.map(shortNumber).join(', ')}]`;
}
