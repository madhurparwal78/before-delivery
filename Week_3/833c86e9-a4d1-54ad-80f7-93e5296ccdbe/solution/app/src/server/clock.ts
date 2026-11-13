import { one, pool } from './db'

let offsetMs = 0
let loadedAt = 0

export const now = (): Date => new Date(Date.now() + offsetMs)

export async function refresh(): Promise<void> {
  if (Date.now() - loadedAt < 100) return
  loadedAt = Date.now()
  const row = await one<{ value: number }>(pool, `SELECT value FROM settings WHERE key = 'clock_offset_ms'`)
  offsetMs = row ? Number(row.value) : 0
}

async function store(next: number): Promise<void> {
  offsetMs = next
  loadedAt = Date.now()
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('clock_offset_ms', to_jsonb($1::bigint)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [next],
  )
}

export async function setTo(target: Date): Promise<void> {
  await store(target.getTime() - Date.now())
}

export async function advance(ms: number): Promise<void> {
  loadedAt = 0
  await refresh()
  await store(offsetMs + ms)
}
