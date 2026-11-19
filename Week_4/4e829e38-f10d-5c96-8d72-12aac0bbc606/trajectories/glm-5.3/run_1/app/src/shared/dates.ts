export function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }

export function dateUTC(t: Date): string {
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function stampUTC(t: Date): string {
  return `${dateUTC(t)}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}Z`;
}

export const DAY_MS = 86400000;

export function ymdToUTC(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(ymd: string, n: number): string {
  const d = ymdToUTC(ymd);
  if (!d) return ymd;
  d.setUTCDate(d.getUTCDate() + n);
  return dateUTC(d);
}

export function daysBetween(a: string, b: string): number {
  const da = ymdToUTC(a), db = ymdToUTC(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / DAY_MS);
}

export function ymdValid(s: string): boolean { return !!ymdToUTC(s); }

export function ymdCompare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
