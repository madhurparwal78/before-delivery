// Turning API values into venue-time text. Instants are always shown in the venue zone,
// whatever zone the browser is set to; wall-clock values are shown as the API gives them.

const VENUE_ZONE = 'America/Halifax';

function parts(iso: string, options: Intl.DateTimeFormatOptions): Map<string, string> {
  const formatted = new Intl.DateTimeFormat('en-US', { timeZone: VENUE_ZONE, ...options }).formatToParts(new Date(iso));
  return new Map(formatted.map((part) => [part.type, part.value]));
}

export function twelveHour(hhmm: string): string {
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number);
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function timeRange(start: string, end: string): string {
  return start === end ? twelveHour(start) : `${twelveHour(start)} - ${twelveHour(end)}`;
}

export function venueClock(iso: string): string {
  const p = parts(iso, { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${p.get('hour') ?? ''}:${p.get('minute') ?? ''} ${p.get('dayPeriod') ?? ''}`;
}

export function venueCutoff(iso: string): string {
  const p = parts(iso, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${p.get('weekday') ?? ''}, ${p.get('month') ?? ''} ${p.get('day') ?? ''}, ${venueClock(iso)}`;
}

// `date` is the session's venue date (YYYY-MM-DD) and `hhmm` its wall-clock time.
export function venueDateTime(date: string, hhmm: string): string {
  const p = new Map(
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
      .formatToParts(new Date(`${date}T12:00:00Z`))
      .map((part) => [part.type, part.value]),
  );
  return `${p.get('weekday') ?? ''}, ${p.get('month') ?? ''} ${p.get('day') ?? ''}, ${twelveHour(hhmm)}`;
}

export function venueLine(iso: string): string {
  const abbreviation = parts(iso, { timeZoneName: 'short' }).get('timeZoneName') ?? '';
  const offset = (parts(iso, { timeZoneName: 'shortOffset' }).get('timeZoneName') ?? 'GMT').replace('GMT', '');
  const utc = offset.startsWith('-') ? `UTC−${offset.slice(1)}` : `UTC+${offset.replace('+', '')}`;
  return `All times are Port Ashby time (${abbreviation}, ${utc}).`;
}

export function sessionCount(count: number): string {
  return count === 1 ? '1 session' : `${count} sessions`;
}

export function grouped(value: number): string {
  return value.toLocaleString('en-US');
}

export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
