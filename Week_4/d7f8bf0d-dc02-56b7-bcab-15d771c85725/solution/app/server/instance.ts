import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { instanceConfig } from './config'
import { applySchemaAndSeed, db, openPool } from './db'
import { ApiError, notFound, serverError } from './http/errors'
import { matchRoute, runRoute, type Reply } from './http/pipeline'
import { serveStatic } from './http/static'
import { routes } from './routes'
import { seedDatabase } from './seed'
import { Engine } from './services/engine'
import { Gotenberg } from './services/gotenberg'
import type { Peer, Services } from './services'
import { Outbox } from './services/outbox'
import { PacketWorker } from './services/packets'
import { StreamHub } from './services/streams'
import { Valkey } from './services/valkey'

function send(res: ServerResponse, reply: Reply): void {
  if ('streamed' in reply) return
  if ('raw' in reply) {
    res.writeHead(reply.status, reply.headers)
    res.end(reply.raw)
    return
  }
  const body = JSON.stringify(reply.body)
  res.writeHead(reply.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...reply.headers })
  res.end(body)
}

function sendError(res: ServerResponse, error: unknown): void {
  if (!(error instanceof ApiError)) console.error(error)
  const failure = error instanceof ApiError ? error : serverError()
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(failure.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(failure.body))
}

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await db().query('select 1')
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
}

export async function startInstance(): Promise<void> {
  const config = instanceConfig()
  openPool(config.databaseUrl)
  await waitForDatabase()
  await applySchemaAndSeed(seedDatabase)

  const valkey = new Valkey(config.valkeyUrl, config.instanceId)
  const gotenberg = new Gotenberg(config.gotenbergUrl)
  const outbox = new Outbox(valkey)
  const hub = new StreamHub(valkey)
  const engine = new Engine(valkey, outbox)
  let peers: Peer[] = []
  const services: Services = {
    instanceId: config.instanceId,
    internalToken: config.internalToken,
    valkey, outbox, hub, engine, gotenberg,
    peers: () => peers,
    stop: restartAfterMs => {
      process.send?.({ type: 'stop', restart_after_ms: restartAfterMs }, () => process.kill(process.pid, 'SIGKILL'))
    },
  }
  process.on('message', (message: { type: string; peers?: Peer[] }) => {
    if (message.type === 'peers' && message.peers !== undefined) peers = message.peers
  })
  valkey.watch()
  gotenberg.watch()
  outbox.start()
  hub.start()
  engine.start()
  new PacketWorker(gotenberg, valkey).start()

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res, services)
  })
  server.keepAliveTimeout = 65_000
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  process.send?.({ type: 'ready', port: typeof address === 'object' && address !== null ? address.port : 0 })
}

async function handle(req: IncomingMessage, res: ServerResponse, services: Services): Promise<void> {
  try {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (path.startsWith('/internal/')) {
      await internal(path, req, res, services)
      return
    }
    const matched = matchRoute(routes, req.method ?? 'GET', path)
    if (matched !== undefined) {
      send(res, await runRoute(matched.route, matched.params, req, res, services))
      return
    }
    if (path.startsWith('/api/')) throw notFound()
    if (req.method === 'GET' && (await serveStatic(path, res))) return
    throw notFound()
  } catch (error) {
    sendError(res, error)
  }
}

async function internal(path: string, req: IncomingMessage, res: ServerResponse, services: Services): Promise<void> {
  if (req.headers['x-gandyboard-internal'] !== services.internalToken) throw notFound()
  if (path === '/internal/leases') {
    send(res, { status: 200, body: { leases: [...services.engine.leases] } })
    return
  }
  if (path === '/internal/valkey') {
    send(res, { status: 200, body: { up: services.valkey.up } })
    return
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { restart_after_ms?: number }
  send(res, { status: 202, body: {} })
  res.on('finish', () => services.stop(body.restart_after_ms ?? 0))
}
