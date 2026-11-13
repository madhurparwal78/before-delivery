import { config } from './config.ts'

const WINDOW_MS = 1000
const hits = new Map<string, number[]>()

/** Counts one write or cursor message; true when the player is over the per-second rate. */
export function overRate(playerId: string, now: number = Date.now()): boolean {
  const recent = (hits.get(playerId) ?? []).filter((at) => now - at < WINDOW_MS)
  const over = recent.length >= config.liveRate
  if (!over) recent.push(now)
  hits.set(playerId, recent)
  return over
}
