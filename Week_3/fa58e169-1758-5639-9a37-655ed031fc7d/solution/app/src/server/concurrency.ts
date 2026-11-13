import { HttpError } from './http.ts'
import { config } from './config.ts'

const chains = new Map<string, Promise<unknown>>()

/** Runs work one at a time per key, in arrival order. */
export function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  const next = previous.then(work, work)
  const tail = next.catch(() => undefined)
  chains.set(key, tail)
  void tail.then(() => { if (chains.get(key) === tail) chains.delete(key) })
  return next
}

const edits = new Map<string, number[]>()

/** The per-person edit rate limit over a sliding minute. */
export function countEdit(userId: string): void {
  const now = Date.now()
  const stamps = edits.get(userId) ?? []
  while (stamps.length && stamps[0] <= now - 60_000) stamps.shift()
  if (stamps.length >= config.limits.editsPerMinute) {
    edits.set(userId, stamps)
    throw new HttpError(429, { error: 'rate_limited', message: 'Too many edits. Wait a moment.' })
  }
  stamps.push(now)
  edits.set(userId, stamps)
}
