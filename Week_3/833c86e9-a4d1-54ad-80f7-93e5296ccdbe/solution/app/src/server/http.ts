import type { IncomingMessage, ServerResponse } from 'node:http'
import { JSON_MAX_BYTES } from './config'
import { fail, validation, type ApiError, type Body } from './errors'
import { identify, setCookie, token, type Identity } from './auth'
import { now as serverNow } from './clock'

export interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  method: string
  path: string
  query: URLSearchParams
  params: Record<string, string>
  identity: Identity
  now: Date
}

type Handler = (ctx: Ctx) => Promise<void>

interface Route { method: string; segments: string[]; handler: Handler; raw: boolean }
const routes: Route[] = []

export function route(method: string, pattern: string, handler: Handler, raw = false): void {
  routes.push({ method, segments: pattern.split('/').filter(Boolean), handler, raw })
}

/** A path segment decoded, or null when it is not valid percent-encoding or holds a NUL (which no stored text can). */
function decodedSegment(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment)
    return value.includes('\0') ? null : value
  } catch {
    return null
  }
}

export function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const parts = path.split('/').filter(Boolean)
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue
    const params: Record<string, string> = {}
    const ok = candidate.segments.every((segment, i) => {
      if (segment.startsWith(':')) {
        const value = decodedSegment(parts[i])
        if (value === null) return false
        params[segment.slice(1)] = value
        return true
      }
      return segment === parts[i]
    })
    if (ok && candidate.method === method) return { route: candidate, params }
  }
  return null
}

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), ...headers })
  res.end(payload)
}

export function sendText(res: ServerResponse, status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body), ...headers })
  res.end(body)
}

export const noContent = (res: ServerResponse): void => {
  res.writeHead(204)
  res.end()
}

export function sendError(res: ServerResponse, error: ApiError): void {
  send(res, error.status, error.body, error.headers)
}

async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > limit) {
    req.resume()
    return fail(413, 'too_large')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) {
      req.resume()
      return fail(413, 'too_large')
    }
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

const hasBody = (req: IncomingMessage): boolean => Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined

/** The JSON body of a request: 413 above 64 KiB, 415 for another content type. */
export async function jsonBody(ctx: Ctx): Promise<Body> {
  if (!hasBody(ctx.req)) return {}
  const bytes = await readBytes(ctx.req, JSON_MAX_BYTES)
  if (!/^application\/json\b/i.test(ctx.req.headers['content-type'] ?? '')) return fail(415, 'unsupported_media_type')
  if (bytes.length === 0) return {}
  try {
    const parsed = JSON.parse(bytes.toString('utf8'), (_key, value) => (typeof value === 'string' && value.includes('\0') ? validation({ body: 'invalid' }) : value))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : validation({ body: 'invalid' })
  } catch {
    return validation({ body: 'invalid' })
  }
}

export async function rawBody(ctx: Ctx, limit: number): Promise<Buffer> {
  const type = (ctx.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const bytes = await readBytes(ctx.req, limit)
  if (type !== 'text/plain' && type !== 'application/octet-stream') return fail(415, 'unsupported_media_type')
  return bytes
}

const counters = new Map<string, { window: number; count: number; previous: number }>()

/** Counts over the last minute of real time (the previous minute weighted by how much of it still overlaps); over the limit answers 429 with Retry-After. */
export function limit(bucket: string, key: string, max: number): void {
  const now = Date.now()
  const window = Math.floor(now / 60000)
  const id = `${bucket}|${key}`
  let entry = counters.get(id)
  if (!entry || entry.window < window - 1) entry = { window, count: 0, previous: 0 }
  else if (entry.window === window - 1) entry = { window, count: 0, previous: entry.count }
  entry.count += 1
  counters.set(id, entry)
  if (counters.size > 20000) for (const [name, value] of counters) if (value.window < window - 1) counters.delete(name)
  const elapsed = (now % 60000) / 60000
  if (entry.count + entry.previous * (1 - elapsed) > max) {
    const seconds = Math.max(1, Math.ceil(((window + 1) * 60000 - now) / 1000))
    fail(429, 'rate_limited', {}, { 'retry-after': String(seconds) })
  }
}

export function ensureVisitor(ctx: Ctx): string {
  if (ctx.identity.visitor) return ctx.identity.visitor
  const visitor = token(16)
  ctx.identity.visitor = visitor
  setCookie(ctx.res, 'kip_visitor', visitor)
  return visitor
}

export const needVisitor = (ctx: Ctx): string => ctx.identity.visitor ?? fail(401, 'no_visitor')

export const needUser = (ctx: Ctx): NonNullable<Identity['user']> => ctx.identity.user ?? fail(401, 'unauthorized')

export async function context(req: IncomingMessage, res: ServerResponse, url: URL): Promise<Ctx> {
  return { req, res, method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, params: {}, identity: await identify(req), now: serverNow() }
}

export function checkOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin
  if (!origin || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '')) return
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return fail(403, 'cross_origin')
  }
  if (host !== req.headers.host) fail(403, 'cross_origin')
}
