import { createServer, STATUS_CODES, type IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Layout } from '../shared/domain.ts'
import { loadAccess, loadProjectRow } from './access.ts'
import { currentUser, routes as authRoutes } from './auth.ts'
import { routes as checkRoutes } from './check.ts'
import { config } from './config.ts'
import { startDatabase } from './db.ts'
import { ApiError, crossOrigin, joinFirst, notFound, serverError, signedOut, textTooLarge } from './errors.ts'
import { routes as exportRoutes } from './exports.ts'
import { routes as gradingRoutes } from './grading.ts'
import { cookieValue, readBody, respondError, respond, SESSION_COOKIE, type Context, type Route } from './http.ts'
import { routes as importRoutes } from './imports.ts'
import { acceptChannel, startSweeper } from './live.ts'
import { serveAsset, servePage } from './pages.ts'
import { routes as projectRoutes } from './projects.ts'
import { resolveShare, routes as shareRoutes } from './shares.ts'
import { routes as statusRoutes } from './status.ts'
import { routes as versionRoutes } from './versions.ts'

const routes: Route[] = [
  ...statusRoutes,
  ...checkRoutes,
  ...authRoutes,
  ...gradingRoutes,
  ...projectRoutes,
  ...versionRoutes,
  ...shareRoutes,
  ...exportRoutes,
  ...importRoutes,
]

async function serveApi(req: IncomingMessage, res: import('node:http').ServerResponse, url: URL): Promise<void> {
  const body = await readBody(req)
  if (body === 'too-large') return respondError(res, textTooLarge())
  const matched = routes.find((candidate) => candidate.method === req.method && candidate.pattern.test(url.pathname))
  if (!matched) return respondError(res, notFound())
  const groups = matched.pattern.exec(url.pathname)?.groups ?? {}
  try {
    const context: Context = {
      req,
      res,
      params: Object.fromEntries(Object.entries(groups).map(([name, value]) => [name, decodeURIComponent(value)])),
      query: url.searchParams,
      rawBody: body,
      cookie: cookieValue(req, SESSION_COOKIE),
    }
    respond(res, await matched.handler(context))
  } catch (error) {
    if (error instanceof ApiError) return respondError(res, error)
    if (error instanceof URIError) return respondError(res, notFound())
    console.error(error)
    respondError(res, serverError())
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const run = async (): Promise<void> => {
    if (url.pathname.startsWith('/api/')) return serveApi(req, res, url)
    if ((req.method === 'GET' || req.method === 'HEAD') && (await serveAsset(req, res, url.pathname))) return
    if (req.method === 'GET' || req.method === 'HEAD') return servePage(req, res, url.pathname)
    return respondError(res, notFound())
  }
  run().catch((error: unknown) => {
    console.error(error)
    if (!res.headersSent) respondError(res, serverError())
  })
})

function refuse(socket: Duplex, error: ApiError): void {
  const payload = JSON.stringify(error.body)
  socket.end(
    `HTTP/1.1 ${error.status} ${STATUS_CODES[error.status] ?? 'Error'}\r\n` +
      `Content-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n${payload}`,
  )
}

async function currentState(projectId: string): Promise<{ revision: number; text: string; layout: Layout }> {
  const project = await loadProjectRow(projectId)
  return { revision: project.revision, text: project.text, layout: project.layout }
}

async function openChannel(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const origin = req.headers.origin
  if (origin !== undefined && new URL(origin).host !== req.headers.host) return refuse(socket, crossOrigin())
  const project = /^\/api\/projects\/([^/]+)\/live$/.exec(url.pathname)
  if (project) {
    const user = await currentUser({ req })
    if (!user) throw signedOut()
    const access = await loadAccess(user, project[1] as string)
    return acceptChannel(req, socket, head, {
      projectId: access.project.id,
      person: { userId: user.id, displayName: user.displayName },
      shareId: null,
      shareExpiresAt: null,
      access: access.role,
      load: () => currentState(access.project.id),
    })
  }
  const shared = /^\/api\/shared\/([^/]+)\/live$/.exec(url.pathname)
  if (shared) {
    const { share, project: row } = await resolveShare(shared[1] as string)
    if (share.access === 'edit') throw joinFirst()
    return acceptChannel(req, socket, head, {
      projectId: row.id,
      person: null,
      shareId: share.id,
      shareExpiresAt: share.expires_at.getTime(),
      access: 'viewer',
      load: () => currentState(row.id),
    })
  }
  throw notFound()
}

server.on('upgrade', (req, socket, head) => {
  openChannel(req, socket, head).catch((error: unknown) => {
    if (error instanceof ApiError) return refuse(socket, error)
    console.error(error)
    socket.destroy()
  })
})

startDatabase()
startSweeper()
server.listen(config.port, '0.0.0.0')
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => process.exit(0))
