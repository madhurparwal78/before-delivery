import { invalidFields } from '../http/errors'
import type { Ctx, Route } from '../http/pipeline'
import { json } from './helpers'

interface PeerLeases { leases: string[] }

async function leasesOf(port: number | null, token: string): Promise<string[]> {
  if (port === null) return []
  try {
    const answer = await fetch(`http://127.0.0.1:${port}/internal/leases`, { headers: { 'x-gandyboard-internal': token }, signal: AbortSignal.timeout(1500) })
    return ((await answer.json()) as PeerLeases).leases
  } catch {
    return []
  }
}

// Each instance watches Valkey on its own, so they learn of an outage or a return moments apart. Up means every live
// instance can serve a session command, whichever one the next request reaches.
async function valkeyUpEverywhere(c: Ctx): Promise<boolean> {
  if (!c.services.valkey.up) return false
  const others = c.services.peers().filter(peer => peer.id !== c.services.instanceId && peer.port !== null)
  const answers = await Promise.all(others.map(async peer => {
    try {
      const answer = await fetch(`http://127.0.0.1:${peer.port}/internal/valkey`, { headers: { 'x-gandyboard-internal': c.services.internalToken }, signal: AbortSignal.timeout(1500) })
      return ((await answer.json()) as { up: boolean }).up
    } catch {
      return true // An instance that cannot answer is going away and takes no commands.
    }
  }))
  return answers.every(Boolean)
}

export const opsRoutes: Route[] = [
  {
    method: 'GET', path: '/api/health', access: 'open',
    async handle() {
      return json(200, { status: 'ok' })
    },
  },
  {
    method: 'GET', path: '/api/status', access: 'user',
    async handle(c) {
      return json(200, {
        valkey: (await valkeyUpEverywhere(c)) ? 'up' : 'down',
        gotenberg: c.services.gotenberg.up ? 'up' : 'down',
        instance: c.services.instanceId,
      })
    },
  },
  {
    method: 'GET', path: '/api/ops/instances', access: 'founder',
    async handle(c) {
      const instances = await Promise.all(c.services.peers().map(async peer => ({
        id: peer.id,
        up: peer.up,
        leases: peer.id === c.services.instanceId ? [...c.services.engine.leases] : await leasesOf(peer.port, c.services.internalToken),
      })))
      return json(200, { instances })
    },
  },
  {
    method: 'POST', path: '/api/ops/instances/:instance/stop', access: 'founder', key: false,
    async handle(c) {
      const delay = c.body.restart_after_ms
      if (!Number.isInteger(delay) || (delay as number) < 0 || (delay as number) > 60_000) {
        throw invalidFields({ restart_after_ms: 'Enter a whole number of milliseconds from 0 to 60000.' })
      }
      const target = c.services.peers().find(peer => peer.id === c.params.instance)
      if (target === undefined) throw invalidFields({ instance: 'Choose instance a or b.' })
      if (target.id === c.services.instanceId) {
        c.res.on('finish', () => c.services.stop(delay as number))
      } else if (target.port !== null) {
        void fetch(`http://127.0.0.1:${target.port}/internal/stop`, {
          method: 'POST',
          headers: { 'x-gandyboard-internal': c.services.internalToken, 'content-type': 'application/json' },
          body: JSON.stringify({ restart_after_ms: delay }),
          signal: AbortSignal.timeout(1500),
        }).catch(() => undefined)
      }
      return { status: 202, body: { instance: target.id } }
    },
  },
]
