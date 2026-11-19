// Domain rule: nickname normalisation (single source of truth).
// Trim surrounding spaces, collapse inner runs to one space.
export function normalizeNickname(raw: string): string {
  return raw.trim().replaceAll(/\s+/g, ' ');
}

// Domain rule: nickname character rules. 2..24 UTF-16 code units of
// Unicode letters/numbers, space U+0020, hyphen U+002D, apostrophe U+0027.
export function isNicknameValid(nickname: string): boolean {
  const n = normalizeNickname(nickname);
  if (n.length < 2 || n.length > 24) return false;
  for (const ch of n) {
    const code = ch.codePointAt(0)!;
    if (code === 0x20 || code === 0x2d || code === 0x27) continue;
    if (/\p{L}|\p{N}/u.test(ch)) continue;
    return false;
  }
  return true;
}

// Domain rule: uniqueness comparison — lowercase Unicode form, accents kept.
export function nicknameKey(nickname: string): string {
  return normalizeNickname(nickname).toLocaleLowerCase('en-US');
}

export function formatLocalMinute(date: Date, timeZone: string): string {
  return formatInZone(date, timeZone, false);
}

export function formatLocalField(date: Date, timeZone: string): string {
  return formatInZone(date, timeZone, true);
}

function formatInZone(date: Date, timeZone: string, withT: boolean): string {
  const parts = zonedParts(date, timeZone);
  const base = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
  return withT ? base.replace(' ', 'T') : base;
}

export interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  });
  const out: Partial<ZonedParts> = {};
  for (const p of fmt.formatToParts(date)) {
    switch (p.type) {
      case 'year': out.year = parseInt(p.value, 10); break;
      case 'month': out.month = parseInt(p.value, 10); break;
      case 'day': out.day = parseInt(p.value, 10); break;
      case 'hour': out.hour = parseInt(p.value, 10) % 24; break;
      case 'minute': out.minute = parseInt(p.value, 10); break;
      case 'weekday': out.weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.value); break;
    }
  }
  return out as ZonedParts;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Convert a local wall time in a zone to an instant. Returns null when the
// local time falls in a daylight-saving gap. For ambiguous times the first
// occurrence is used.
export function localToInstant(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const utcGuess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  const offset1 = zoneOffsetMs(new Date(utcGuess), timeZone);
  const t1 = utcGuess - offset1;
  const offset2 = zoneOffsetMs(new Date(t1), timeZone);
  const t2 = utcGuess - offset2;
  if (offset1 !== offset2) {
    // Check for a gap: the instant derived from the later offset maps back to
    // a different wall time than requested.
    const check = new Date(t2);
    const back = zonedParts(check, timeZone);
    if (back.year !== +y || back.month !== +mo || back.day !== +d || back.hour !== +h || back.minute !== +mi) {
      return null;
    }
  }
  return new Date(t2);
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = dtf.formatToParts(date);
  let s = `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}T${parts.find(p => p.type === 'hour')!.value}:${parts.find(p => p.type === 'minute')!.value}:${parts.find(p => p.type === 'second')!.value}Z`;
  const asUTC = Date.parse(s);
  return asUTC - date.getTime();
}

export function formatInstantUTC(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}Z`;
}

export function roundDownToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60000) * 60000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

export const DEFAULT_TIMEZONE = 'America/Chicago';
