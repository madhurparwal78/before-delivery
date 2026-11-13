import { Client } from 'pg';

// Asia/Kathmandu season days: local 05:00 boundary, offset UTC+05:45.

export const SEASON_OFFSET_MINUTES = 345; // +05:45

export interface SeasonDayInfo {
  seasonDay: string;
  localTime: string;
}

/**
 * Computes the season day for an instant. Days run from local 05:00 inclusive
 * to the next local 05:00 exclusive. SeasonDay is the calendar date of the
 * interval start formatted YYYY-MM-DD.
 */
export function seasonDayOf(instant: Date): { seasonDay: string; localTime: string; localParts: Date } {
  // Shift by +345 minutes to get local wall clock.
  const local = new Date(instant.getTime() + SEASON_OFFSET_MINUTES * 60000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const day = local.getUTCDate();
  const hours = local.getUTCHours();
  const boundary = hours < 5;
  let seasonDate: Date;
  if (boundary) {
    seasonDate = new Date(Date.UTC(year, month - 1, day) - 86400000);
  } else {
    seasonDate = new Date(Date.UTC(year, month - 1, day));
  }
  const seasonDay = `${seasonDate.getUTCFullYear()}-${pad(seasonDate.getUTCMonth() + 1)}-${pad(seasonDate.getUTCDate())}`;
  const localTime = `${pad(year)}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}.${millis(local)}+05:45`;
  return { seasonDay, localTime, localParts: local };
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function millis(date: Date): string {
  return date.getUTCMilliseconds().toString().padStart(3, '0');
}

export function daysSinceEpoch(seasonDay: string): number {
  const [y, m, d] = seasonDay.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Freezes the daily selection for a season day on first read or challenge issuance. */
export async function dailySelectionFor(client: Client, seasonDay: string): Promise<string | null> {
  const existing = await client.query('SELECT daily_digest FROM season_days WHERE season_day = $1', [seasonDay]);
  if (existing.rowCount === 1) return (existing.rows[0].daily_digest as string) ?? null;
  const published = await client.query(
    "SELECT digest FROM challenge_publications WHERE unlisted = false ORDER BY digest ASC FOR UPDATE",
  );
  const digests = published.rows.map((r) => r.digest as string);
  const digest = digests.length === 0 ? null : digests[daysSinceEpoch(seasonDay) % digests.length];
  await client.query(
    'INSERT INTO season_days (season_day, daily_digest) VALUES ($1,$2) ON CONFLICT (season_day) DO NOTHING',
    [seasonDay, digest],
  );
  const confirm = await client.query('SELECT daily_digest FROM season_days WHERE season_day = $1', [seasonDay]);
  return (confirm.rows[0].daily_digest as string) ?? null;
}

export async function seasonDayForNow(_client: unknown): Promise<string> {
  return seasonDayOf(new Date()).seasonDay;
}

/** Parses an offset-bearing ISO instant with real date, time, seconds and Z or numeric offset. */
export function parseInstant(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, frac, off] = match;
  const milliseconds = frac ? Number(frac.slice(1).padEnd(3, '0')) : 0;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), milliseconds));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  if (off === 'Z') return date;
  const sign = off[0] === '+' ? 1 : -1;
  const offHours = Number(off.slice(1, 3));
  const offMinutes = Number(off.slice(4, 6));
  if (offHours > 23 || offMinutes > 59) return null;
  return new Date(date.getTime() - sign * (offHours * 60 + offMinutes) * 60000);
}

export function formatInstantUtc(date: Date): string {
  const utc = new Date(date.getTime());
  const y = utc.getUTCFullYear();
  const mo = pad(utc.getUTCMonth() + 1);
  const d = pad(utc.getUTCDate());
  const h = pad(utc.getUTCHours());
  const mi = pad(utc.getUTCMinutes());
  const s = pad(utc.getUTCSeconds());
  const ms = utc.getUTCMilliseconds().toString().padStart(3, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`;
}
