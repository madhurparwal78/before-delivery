/**
 * The offline day cache: the current ship's day and the two days before it,
 * kept in localStorage so the log stays usable after a reload while offline.
 * The browser never computes a verdict or closure from these; it renders the
 * server's values as last received.
 */

const KEY = "sixbell-days";

export interface CachedDay {
  ship_date: string;
  body: string;
}

export function readCachedDays(): CachedDay[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CachedDay[]) : [];
  } catch {
    return [];
  }
}

export function cacheDay(shipDate: string, body: unknown): void {
  const days = readCachedDays().filter((d) => d.ship_date !== shipDate);
  days.push({ ship_date: shipDate, body: JSON.stringify(body) });
  // Keep only the newest three days: today and the two before it.
  days.sort((a, b) => a.ship_date.localeCompare(b.ship_date));
  while (days.length > 3) days.shift();
  localStorage.setItem(KEY, JSON.stringify(days));
}

export function readCachedDay(shipDate: string): unknown | null {
  const found = readCachedDays().find((d) => d.ship_date === shipDate);
  if (!found) return null;
  try {
    return JSON.parse(found.body);
  } catch {
    return null;
  }
}
