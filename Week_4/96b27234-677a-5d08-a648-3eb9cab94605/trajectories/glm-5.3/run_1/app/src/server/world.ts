// World clocks and per-instance outage flags. Every server time rule reads the
// world's clock through here.
import { query } from './db';

const outages = new Set<string>();

export function setOutage(service: 'valkey' | 'minio', down: boolean): void {
  if (down) outages.add(service);
  else outages.delete(service);
}

export function isDown(service: 'valkey' | 'minio'): boolean {
  return outages.has(service);
}

export async function worldClock(worldId: string): Promise<Date> {
  const rows = await query<{ mode: string; at: Date }>(
    'SELECT clock_mode as mode, clock_at as at FROM worlds WHERE id = $1',
    [worldId]
  );
  if (rows.length && rows[0].mode === 'held') return new Date(rows[0].at);
  return new Date();
}

export async function holdClock(worldId: string, at: Date): Promise<void> {
  await query(
    `INSERT INTO worlds (id, clock_mode, clock_at) VALUES ($1, 'held', $2)
     ON CONFLICT (id) DO UPDATE SET clock_mode = 'held', clock_at = $2`,
    [worldId, at]
  );
}

export async function releaseClock(worldId: string): Promise<void> {
  await query(
    `INSERT INTO worlds (id, clock_mode) VALUES ($1, 'real')
     ON CONFLICT (id) DO UPDATE SET clock_mode = 'real', clock_at = NULL`,
    [worldId]
  );
}


