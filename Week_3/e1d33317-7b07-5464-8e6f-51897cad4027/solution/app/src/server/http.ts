// The HTTP boundary: same-origin rule, body-size limits, routing, JSON replies and the browser assets.

import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { pipeline } from 'node:stream'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError, notFound, toResponse, validation } from './errors.js'

const JSON_LIMIT = 262144
export const BANK_LIMIT = 8_000_000

interface Reply {
  status: number
  body?: unknown
  headers?: Record<string, string>
  bytes?: { contentType: string; data: Uint8Array }
}

export interface Ctx {
  req: IncomingMessage
  params: Record<string, string>
  url: URL
  /** The raw request body, already within the route's size limit. */
  raw: Buffer
  /** The JSON body; a body that is not a JSON object is a 422. */
  json(): Record<string, unknown>
}

type Handler = (ctx: Ctx) => Promise<Reply>
interface Route {
  method: string
  segments: string[]
  limit: number
  tooLarge: () => ApiError
  handler: Handler
}

const routes: Route[] = []

const payloadTooLarge = () => new ApiError(413, 'payload_too_large', 'Request bodies are limited to 262,144 bytes.')
export const bankTooLarge = () => new ApiError(413, 'too_large', 'Sample banks are limited to 8,000,000 bytes.')

export function route(method: string, pattern: string, handler: Handler, options: { limit?: number; tooLarge?: () => ApiError } = {}): void {
  routes.push({ method, segments: pattern.split('/').filter(Boolean), limit: options.limit ?? JSON_LIMIT, tooLarge: options.tooLarge ?? payloadTooLarge, handler })
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({ status, body, headers })

function match(route: Route, method: string, segments: string[]): Record<string, string> | null {
  if (route.method !== method || route.segments.length !== segments.length) return null
  const params: Record<string, string> = {}
  for (const [i, expected] of route.segments.entries()) {
    const actual = segments[i] as string
    if (expected.startsWith(':')) {
      let value: string
      try {
        value = decodeURIComponent(actual)
      } catch {
        return null
      }
      if (value.includes('\0')) return null
      params[expected.slice(1)] = value
    } else if (expected !== actual) return null
  }
  return params
}

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

async function readBody(req: IncomingMessage, limit: number, tooLarge: () => ApiError): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > limit) throw tooLarge()
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw tooLarge()
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function send(res: ServerResponse, reply: Reply): void {
  const headers = { ...reply.headers, 'cache-control': 'no-store' }
  if (reply.bytes) {
    res.writeHead(reply.status, { ...headers, 'content-type': reply.bytes.contentType, 'content-length': reply.bytes.data.length })
    res.end(reply.bytes.data)
    return
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers)
    res.end()
    return
  }
  const payload = JSON.stringify(reply.body)
  res.writeHead(reply.status, { ...headers, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

function fail(res: ServerResponse, req: IncomingMessage, error: unknown): void {
  const { status, body, headers } = toResponse(error)
  if (status === 413 && !req.complete) {
    res.setHeader('connection', 'close')
    req.resume()
  }
  send(res, { status, body, headers })
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    if (!sameOrigin(req)) throw new ApiError(403, 'cross_origin', 'Requests must come from Fairline itself.')
    const segments = url.pathname.split('/').filter(Boolean)
    const method = req.method ?? 'GET'
    for (const candidate of routes) {
      const params = match(candidate, method, segments)
      if (!params) continue
      const raw = method === 'GET' || method === 'DELETE' ? Buffer.alloc(0) : await readBody(req, candidate.limit, candidate.tooLarge)
      const ctx: Ctx = {
        req, params, url, raw,
        json() {
          try {
            const parsed: unknown = raw.length ? JSON.parse(raw.toString('utf8')) : {}
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
          } catch {
            // falls through to the validation error below
          }
          throw validation({ body: 'Send a JSON object.' })
        },
      }
      send(res, await candidate.handler(ctx))
      return
    }
    throw notFound()
  } catch (error) {
    fail(res, req, error)
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png',
}
const CSP = "img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"

const assetRoot = resolve(fileURLToPath(new URL('./client', import.meta.url)))
const assets = new Map<string, string>()

function indexAssets(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) indexAssets(path)
    else assets.set(`/${path.slice(assetRoot.length + 1).split(sep).join('/')}`, path)
  }
}

const PAGE_PREFIXES = new Set(['s', 'i', 'score'])

function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): void {
  if (assets.size === 0 && existsSync(assetRoot)) indexAssets(assetRoot)
  const first = url.pathname.split('/')[1] ?? ''
  const isPage = url.pathname === '/' || PAGE_PREFIXES.has(first)
  const file = isPage ? assets.get('/index.html') : assets.get(url.pathname)
  if ((req.method !== 'GET' && req.method !== 'HEAD') || !file) {
    send(res, { status: 404, body: { error: 'not_found', message: 'Not found.' } })
    return
  }
  const type = MIME[extname(file)] ?? 'application/octet-stream'
  res.writeHead(200, {
    'content-type': type,
    'content-length': statSync(file).size,
    'cache-control': isPage ? 'no-cache' : 'public, max-age=31536000, immutable',
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
  })
  if (req.method === 'HEAD') res.end()
  else pipeline(createReadStream(file), res, () => undefined)
}

export function createHttpServer(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/api/health') {
      send(res, json(200, { status: 'ok' }))
    } else if (url.pathname.startsWith('/api/')) {
      void handleApi(req, res, url)
    } else {
      serveStatic(req, res, url)
    }
  })
}
