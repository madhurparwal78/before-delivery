import { rows, pool } from './db'
import * as storage from './storage'
import { picture, PICTURE_COUNT } from './pictures'

const pending = new Set<string>()
let working = false

export const queueImages = (codes: string[]): void => {
  for (const code of codes) pending.add(code)
}

/** Writes the three drawn pictures of each queued property when missing; retried every 5 seconds while storage is unreachable. */
async function drain(): Promise<void> {
  if (working) return
  working = true
  try {
    for (const code of [...pending]) {
      for (let n = 1; n <= PICTURE_COUNT; n++) {
        const key = `images/${code}/${n}.svg`
        if (!(await storage.exists(key))) await storage.put(key, picture(code, n), 'image/svg+xml')
      }
      pending.delete(code)
    }
  } catch {
    // storage unreachable: the property stays queued for the next attempt
  } finally {
    working = false
  }
}

export async function startImages(): Promise<void> {
  const all = await rows<{ code: string }>(pool, `SELECT code FROM properties ORDER BY code LIMIT 200`)
  queueImages(all.map((row) => row.code))
  void drain()
  setInterval(() => void drain(), 5000).unref()
}
