import { pool } from './db.js'
import { config } from './config.js'

// Every decision about time is made on the server from the world's clock
// (DP: server time). The default world always runs on real time.

interface WorldRow {
  id: string
  clock_mode: 'realtime' | 'held'
  clock_at: Date
}

const heldWorlds = new Map<string, Date>()

export async function setWorldClock(worldId: string, now: Date | null): Promise<Date> {
  if (now === null) {
    heldWorlds.delete(worldId)
    await pool.query(`UPDATE worlds SET clock_mode = 'realtime' WHERE id = $1`, [worldId])
    return new Date()
  }
  heldWorlds.set(worldId, now)
  await pool.query(`UPDATE worlds SET clock_mode = 'held', clock_at = $2 WHERE id = $1`, [worldId, now])
  return now
}

export async function worldNow(worldId: string): Promise<Date> {
  const held = heldWorlds.get(worldId)
  if (held) return held
  if (worldId === 'default') return new Date()
  const answer = await pool.query<WorldRow>(`SELECT * FROM worlds WHERE id = $1`, [worldId])
  const row = answer.rows[0]
  if (!row) return new Date()
  if (row.clock_mode === 'held') {
    heldWorlds.set(worldId, row.clock_at)
    return row.clock_at
  }
  return new Date()
}

export async function worldNowCached(worldId: string): Promise<Date> {
  return worldNow(worldId)
}

export function lateAfterSeconds(): number {
  return config.lateAfterMinutes * 60
}

export function leftEarlyBeforeSeconds(): number {
  return config.leftEarlyMinutes * 60
}

export function graceSeconds(): number {
  return config.reconnectGraceSeconds
}

export function breakoutLengthSeconds(): number {
  return config.breakoutSeconds
}

export function breakoutWarningSeconds(): number {
  return config.breakoutWarningSeconds
}

export function breakoutExtendSeconds(): number {
  return config.breakoutExtendSeconds
}
