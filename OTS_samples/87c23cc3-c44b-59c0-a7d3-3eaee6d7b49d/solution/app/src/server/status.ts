import { exactlyOne, pingDatabase } from './db.ts'
import { pingMail } from './smtp.ts'
import { pingStorage } from './storage.ts'
import type { ServiceStatus } from '../shared/domain.ts'
import { route, type Route } from './http.ts'

const PROBE_TIMEOUT_MS = 2000
const CACHE_MS = 2000

interface Probes {
  database: boolean
  storage: boolean
  mail: boolean
  checkedAt: string
}

function within(probe: Promise<boolean>): Promise<boolean> {
  return Promise.race([probe, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PROBE_TIMEOUT_MS))])
}

let cached: { at: number; probes: Promise<Probes> } | null = null

/** What the three services answer right now, probed at most every couple of seconds. */
function probeServices(): Promise<Probes> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.probes
  const probes = Promise.all([within(pingDatabase()), within(pingStorage()), within(pingMail())]).then(
    ([database, storage, mail]): Probes => ({ database, storage, mail, checkedAt: new Date().toISOString() }),
  )
  cached = { at: now, probes }
  return probes
}

/** What the strip and `GET /api/status` show: the storage and mail probes of the last couple of seconds. */
export async function serviceStatus(): Promise<ServiceStatus> {
  const probes = await probeServices()
  return { storage: probes.storage ? 'up' : 'down', mail: probes.mail ? 'up' : 'down', checkedAt: probes.checkedAt }
}

export const routes: Route[] = [
  route('GET', '/api/health', async () => {
    const probes = await probeServices()
    if (!probes.database) return { status: 503, body: { status: 'unavailable' } }
    return { status: 200, body: { status: probes.storage && probes.mail ? 'ok' : 'unavailable' } }
  }),
  route('GET', '/api/status', async () => ({ status: 200, body: await serviceStatus() })),
  route('GET', '/api/stats', async () => {
    const row = await exactlyOne<{ projects: number; exports: number }>(
      `SELECT (SELECT count(*)::int FROM projects) AS projects, (SELECT count(*)::int FROM exports WHERE status = 'stored') AS exports`,
    )
    return { status: 200, body: { projects: row.projects, exports: row.exports } }
  }),
]
