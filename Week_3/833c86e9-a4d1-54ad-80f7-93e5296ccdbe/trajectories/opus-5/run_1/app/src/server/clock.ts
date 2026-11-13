import { one, query } from './db';

let offsetMs = 0;

export async function loadClock(): Promise<void> {
  const row = await one<{ value: number }>(`select value::text::bigint as value from settings where key = 'clock_offset_ms'`, []);
  offsetMs = row ? Number(row.value) : 0;
}

export function nowMs(): number {
  return Date.now() + offsetMs;
}

export function nowIso(): string {
  return new Date(nowMs()).toISOString();
}

export async function setClockTo(instant: string): Promise<void> {
  offsetMs = new Date(instant).getTime() - Date.now();
  await persist();
}

export async function advanceClock(ms: number): Promise<void> {
  offsetMs += ms;
  await persist();
}

async function persist(): Promise<void> {
  await query(
    `insert into settings (key, value) values ('clock_offset_ms', $1::text::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [String(Math.round(offsetMs))],
  );
}
