/**
 * The market clock. Every time rule in Tracewell except staff session expiry
 * reads it. By default it is real time; after an operator sets a rehearsal
 * instant it runs forward from there at real speed.
 */
import { query } from './db';

interface ClockSetting {
  rehearsalAtMs: number | null;
  setAtRealMs: number | null;
}

interface CachedSetting {
  setting: ClockSetting;
  readAtRealMs: number;
}

const CACHE_MS = 1000;

let cached: CachedSetting | null = null;

async function readSetting(): Promise<ClockSetting> {
  const rows = await query<{ rehearsal_at: Date | null; set_at_real: Date | null }>(
    'SELECT rehearsal_at, set_at_real FROM clock_setting WHERE id = 1',
  );
  const row = rows[0];
  return {
    rehearsalAtMs: row?.rehearsal_at ? row.rehearsal_at.getTime() : null,
    setAtRealMs: row?.set_at_real ? row.set_at_real.getTime() : null,
  };
}

function computeNow(setting: ClockSetting, realNowMs: number): number {
  if (setting.rehearsalAtMs === null || setting.setAtRealMs === null) return realNowMs;
  return setting.rehearsalAtMs + (realNowMs - setting.setAtRealMs);
}

export async function marketClockNow(): Promise<number> {
  const realNow = Date.now();
  if (cached === null || realNow - cached.readAtRealMs > CACHE_MS) {
    cached = { setting: await readSetting(), readAtRealMs: realNow };
  }
  return computeNow(cached.setting, realNow);
}

export async function isRehearsalClock(): Promise<boolean> {
  await marketClockNow();
  return cached !== null && cached.setting.rehearsalAtMs !== null;
}

export async function setRehearsalClock(instantMs: number | null): Promise<void> {
  await query('UPDATE clock_setting SET rehearsal_at = $1, set_at_real = $2 WHERE id = 1', [
    instantMs === null ? null : new Date(instantMs),
    instantMs === null ? null : new Date(),
  ]);
  cached = null;
}
