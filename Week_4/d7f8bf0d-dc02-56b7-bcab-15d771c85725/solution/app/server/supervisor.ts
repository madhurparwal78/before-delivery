import { fork, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer, request, Agent, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { publicPort } from './config'
import { instancesRestarting } from './http/errors'
import type { Peer } from './services'

// The front router and the supervisor of instances a and b. The router holds no product state: it forwards each
// request to a live instance (alternating, or the one named by X-Gandyboard-Route) and restarts any that exit.

const INSTANCE_IDS = ['a', 'b']
const RESTART_DELAY_MS = 400
const KEEP_ALIVE_MS = 65_000

interface Slot {
  id: string
  child: ChildProcess | null
  port: number | null
  restartAfterMs: number
}

export function startSupervisor(): void {
  const token = randomBytes(24).toString('hex')
  const slots: Slot[] = INSTANCE_IDS.map(id => ({ id, child: null, port: null, restartAfterMs: RESTART_DELAY_MS }))
  const agent = new Agent({ keepAlive: true, maxSockets: 256 })
  let turn = 0

  const peers = (): Peer[] => slots.map(slot => ({ id: slot.id, up: slot.port !== null, port: slot.port }))
  const broadcast = (): void => {
    // `port` only says a slot reported ready, so it lags a channel that has already closed; the send callback takes
    // the loser of that race as an argument instead of an unhandled 'error' event, which would kill the supervisor.
    for (const slot of slots) {
      if (slot.port !== null && slot.child?.connected) slot.child.send({ type: 'peers', peers: peers() }, () => undefined)
    }
  }

  const launch = (slot: Slot): void => {
    const child = fork(fileURLToPath(import.meta.url), [], {
      env: { ...process.env, GANDYBOARD_ROLE: 'instance', GANDYBOARD_INSTANCE: slot.id, GANDYBOARD_INTERNAL_TOKEN: token },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    slot.child = child
    child.on('message', (message: { type: string; port?: number; restart_after_ms?: number }) => {
      if (message.type === 'ready') {
        slot.port = message.port ?? null
        broadcast()
      } else if (message.type === 'stop') {
        slot.restartAfterMs = message.restart_after_ms ?? RESTART_DELAY_MS
      }
    })
    child.on('exit', () => {
      slot.port = null
      slot.child = null
      broadcast()
      const delay = slot.restartAfterMs
      slot.restartAfterMs = RESTART_DELAY_MS
      setTimeout(() => launch(slot), delay)
    })
  }
  slots.forEach(launch)

  const refuse = (res: ServerResponse): void => {
    if (res.headersSent) {
      res.destroy()
      return
    }
    const failure = instancesRestarting()
    res.writeHead(failure.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(failure.body))
  }

  const forward = (req: IncomingMessage, res: ServerResponse): void => {
    const named = req.headers['x-gandyboard-route']
    const live = slots.filter(slot => slot.port !== null)
    const target = typeof named === 'string' ? live.find(slot => slot.id === named) : live[turn++ % Math.max(live.length, 1)]
    if (target === undefined || (req.url ?? '').startsWith('/internal')) return refuse(res)
    const upstream = request({ host: '127.0.0.1', port: target.port as number, method: req.method, path: req.url, headers: req.headers, agent }, answer => {
      // Connection and Keep-Alive describe the hop from the instance; the browser's hop is the router's own to declare.
      const { connection: _connection, 'keep-alive': _keepAlive, ...headers } = answer.headers
      res.writeHead(answer.statusCode ?? 502, { ...headers, 'x-gandyboard-instance': target.id })
      answer.pipe(res)
      // An instance that dies mid-response must not leave the browser's stream hanging open.
      answer.on('close', () => {
        if (!answer.complete) res.destroy()
      })
    })
    upstream.on('error', () => refuse(res))
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  }

  const server = createServer(forward)
  // Node's 5-second default closes idle sockets just as a client reuses them, which it sees as a hung-up request.
  server.keepAliveTimeout = KEEP_ALIVE_MS
  server.headersTimeout = KEEP_ALIVE_MS + 5_000
  server.listen(publicPort, '0.0.0.0')
}
