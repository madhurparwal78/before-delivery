import { query } from './db.js';

let offsetMs = 0;

/** The one server clock, truncated to the whole second. */
export function now(): Date {
  return new Date(Math.floor((Date.now() + offsetMs) / 1000) * 1000);
}

export function isoSeconds(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`;
}

export function nowIso(): string {
  return isoSeconds(now());
}

export async function setClock(target: Date): Promise<void> {
  offsetMs = target.getTime() - Date.now();
  await query('UPDATE app_clock SET offset_ms = $1, updated_at = now() WHERE id = 1', [String(offsetMs)]);
}

export async function clearClock(): Promise<void> {
  offsetMs = 0;
  await query('UPDATE app_clock SET offset_ms = 0, updated_at = now() WHERE id = 1', []);
}

/** Instances share the controlled clock through the database. */
export async function syncClock(): Promise<void> {
  const rows = await query<{ offset_ms: string }>('SELECT offset_ms FROM app_clock WHERE id = 1', []);
  const stored = rows[0] ? Number(rows[0].offset_ms) : 0;
  if (stored !== offsetMs) offsetMs = stored;
}

export function startClockSync(): void {
  setInterval(() => {
    void syncClock().catch(() => undefined);
  }, 500).unref();
}
