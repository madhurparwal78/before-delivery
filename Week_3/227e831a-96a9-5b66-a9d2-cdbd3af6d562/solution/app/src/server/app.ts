import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { errorBody, HttpError, refuse } from './errors'
import {
  bodyLimit, matchPattern, parseJsonObject, parseMultipart, readBody, type Context, type Reply, type Route,
} from './http'
import { appShell, CSP, notFoundPage, sharedPage, staticFile } from './pages'
import { isLive, sessionToken } from './session'
import { accountRoutes } from './account'
import { closetRoutes } from './closet'
import { importRoutes } from './imports'
import { listRoutes } from './lists'
import { loadSharedList, shareRoutes } from './shares'
import { sheetRoutes } from './sheets'
import { syncRoutes } from './sync'

const ROUTES: Route[] = [...accountRoutes, ...closetRoutes, ...listRoutes, ...syncRoutes, ...shareRoutes, ...sheetRoutes, ...importRoutes]
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const OWNER_PAGES = [/^\/closet$/, /^\/trips$/, /^\/imports$/, /^\/settings$/, /^\/lists\/[^/]+$/]

function findRoute(method: string, path: string): { route: Route; params: Record<string, string> } | undefined {
  for (const route of ROUTES) {
    const params = route.method === method ? matchPattern(route.pattern, path) : null
    if (params) return { route, params }
  }
  return undefined
}

const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }

function write(res: ServerResponse, status: number, headers: Record<string, string | string[]>, body?: string | Buffer): void {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers })
  res.end(body)
}

function sendReply(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { 'Cache-Control': 'no-store', ...reply.headers }
  if (reply.status === 204) return write(res, 204, headers)
  if (reply.bytes) return write(res, reply.status, { ...headers, 'Content-Type': reply.bytes.contentType }, reply.bytes.data)
  const text = reply.text ?? JSON.stringify(reply.body)
  write(res, reply.status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }, text)
}

function sendError(res: ServerResponse, error: unknown): void {
  const refusal = error instanceof HttpError ? error : refuse.internal()
  if (!(error instanceof HttpError)) console.error('unexpected failure:', error instanceof Error ? error.name : 'unknown')
  sendReply(res, { status: refusal.status, body: errorBody(refusal), headers: refusal.headers })
}

/** The cross-site check on writes: a foreign or null Origin, or a cross-site Sec-Fetch-Site. */
function isCrossSite(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (req.headers['sec-fetch-site'] === 'cross-site') return true
  if (origin === undefined) return false
  if (origin === 'null') return true
  try {
    return new URL(origin).host !== req.headers.host
  } catch {
    return true
  }
}

function isJson(contentType: string | undefined): boolean {
  return /^application\/json\s*(;|$)/i.test(contentType ?? '')
}

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams): Promise<void> {
  const method = req.method ?? 'GET'
  const found = findRoute(method, path)
  const isWrite = WRITES.has(method)
  const rawBody = isWrite ? await readBody(req, bodyLimit(found?.route)) : Buffer.alloc(0)
  const contentType = req.headers['content-type']
  if (isWrite) {
    if (found?.route.body) {
      if (!/^multipart\/form-data/i.test(contentType ?? '')) throw refuse.unsupportedMediaType()
    } else if (rawBody.length > 0 && !isJson(contentType)) throw refuse.unsupportedMediaType()
    if (isCrossSite(req)) throw refuse.crossSite()
  }
  const token = sessionToken(req.headers.cookie)
  if (found?.route.access !== 'public' && !(await isLive(token))) throw refuse.unauthenticated()
  if (!found) throw refuse.notFound()
  const context: Context = {
    req, method, path, params: found.params, query, rawBody, sessionToken: token,
    json: () => parseJsonObject(rawBody),
    file: (name) => parseMultipart(rawBody, contentType ?? '').get(name) ?? null,
    header: (name) => {
      const value = req.headers[name]
      return Array.isArray(value) ? value[0] : value
    },
  }
  sendReply(res, await found.route.handler(context))
}

async function handlePage(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const html = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' }
  const shared = /^\/s\/([^/]+)$/.exec(path)
  if (shared) {
    const list = await loadSharedList(decodeURIComponent(shared[1] ?? ''))
    return write(res, list ? 200 : 404, { ...html, 'Cache-Control': 'no-store' }, await sharedPage(list))
  }
  if (path === '/sign-in') return write(res, 200, html, await appShell())
  const live = await isLive(sessionToken(req.headers.cookie))
  if (path === '/') return write(res, 302, { Location: live ? '/trips' : '/sign-in' })
  if (OWNER_PAGES.some((pattern) => pattern.test(path))) {
    return live ? write(res, 200, html, await appShell()) : write(res, 302, { Location: '/sign-in' })
  }
  const file = await staticFile(path)
  if (file) return write(res, 200, { 'Content-Type': file.contentType, 'Cache-Control': file.cache, 'Service-Worker-Allowed': '/' }, file.data)
  write(res, 404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP }, await notFoundPage())
}

export function createApp(isReady: () => boolean): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://skinout.local')
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/')
    if (!isReady() && url.pathname !== '/api/health') {
      return write(res, 503, { 'Content-Type': 'application/json' }, JSON.stringify({ status: 'starting' }))
    }
    const work = isApi ? handleApi(req, res, url.pathname, url.searchParams) : handlePage(req, res, url.pathname)
    work.catch((error: unknown) => sendError(res, error))
  })
}
