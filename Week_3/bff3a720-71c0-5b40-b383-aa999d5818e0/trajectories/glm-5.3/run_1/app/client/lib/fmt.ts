const EUR = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });

export function money(cents: number): string {
  return EUR.format(cents / 100);
}

export function signedMoney(cents: number): string {
  return (cents < 0 ? '-' : '+') + EUR.format(Math.abs(cents) / 100);
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

export function longDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`;
}

export function hhmm(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  let h = get('hour');
  if (h === '24') h = '00';
  return `${h}:${get('minute')}`;
}

/** Brussels calendar date for an ISO time, as YYYY-MM-DD. */
export function calDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The current Brussels date, from the server's clock, as YYYY-MM-DD. */
export function todayFromServer(serverNowIso: string): string {
  return calDate(serverNowIso);
}

export function count(n: number, singular: string, plural?: string): string {
  return n === 1 ? `1 ${singular}` : `${n} ${plural ?? singular + 's'}`;
}

export function leftPhrase(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

/** Renders an ISO time for display as "HH:MM on Ddd D Mon". */
export function timeOn(iso: string): string {
  return `${hhmm(iso)} on ${shortDate(iso)}`;
}
