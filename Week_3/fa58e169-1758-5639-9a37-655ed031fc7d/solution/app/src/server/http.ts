import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { ApiError } from '../shared/api.ts'
import { type User, userOf } from './auth.ts'

const BODY_LIMIT = 1_000_000

export class HttpError extends Error {
  constructor(readonly status: number, readonly body: ApiError, readonly headers: Record<string, string> = {}) {
    super(body.error)
  }
}

export const notFound = () => new HttpError(404, { error: 'not_found' })
const unauthenticated = () => new HttpError(401, { error: 'unauthenticated' })
export const invalid = (field: string, message: string, position?: number | null) =>
  new HttpError(422, position === undefined ? { error: 'invalid', field, message } : { error: 'invalid', field, message, position })
export const conflict = (error: string, message: string) => new HttpError(409, { error, message })

export interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  params: Record<string, string>
  user: User
  raw: Buffer
  /** The parsed JSON body, or the 422 for a body that is not JSON. */
  body(): unknown
  reply(status: number, payload?: unknown, headers?: Record<string, string>): void
}

type Handler = (ctx: Ctx) => Promise<void> | void
type Access = 'user' | 'public'

interface Route { method: string; pattern: RegExp; keys: string[]; access: Access; handler: Handler }

const routes: Route[] = []

export function route(method: string, spec: string, access: Access, handler: Handler): void {
  const keys: string[] = []
  const source = spec.replace(/:([a-zA-Z]+)/g, (_m, key: string) => { keys.push(key); return '([^/]+)' })
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, access, handler })
}

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function readBody(req: IncomingMessage): Promise<{ raw: Buffer; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= BODY_LIMIT) parts.push(chunk)
      else if (size > 64 * BODY_LIMIT) req.destroy()
    })
    req.on('end', () => resolve({ raw: Buffer.concat(parts), tooLarge: size > BODY_LIMIT }))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  if (status === 204) {
    res.writeHead(204, headers)
    res.end()
    return
  }
  const text = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...headers })
  res.end(text)
}

/** A path segment as text; one that is not valid percent-encoding, or that holds a NUL, names nothing. */
function segment(raw: string): string {
  let value: string
  try { value = decodeURIComponent(raw) } catch { throw notFound() }
  if (value.includes('\u0000')) throw notFound()
  return value
}

/** Postgres cannot hold a NUL in text: name the top-level field that carries one instead of letting the database fail. */
function refuseNul(value: unknown): void {
  const has = (v: unknown): boolean => {
    if (typeof v === 'string') return v.includes('\u0000')
    if (Array.isArray(v)) return v.some(has)
    if (v && typeof v === 'object') return Object.entries(v).some(([k, inner]) => k.includes('\u0000') || has(inner))
    return false
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value)) {
      if (key.includes('\u0000') || has(inner)) throw invalid(key.includes('\u0000') ? 'body' : key, 'Text cannot contain a null character.')
    }
  } else if (has(value)) throw invalid('body', 'Text cannot contain a null character.')
}

function hasBody(req: IncomingMessage): boolean {
  return Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const headers: Record<string, string> = {}
  try {
    const method = req.method ?? 'GET'
    const write = WRITES.has(method)
    if (write && hasBody(req) && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
      req.resume()
      throw new HttpError(415, { error: 'unsupported_media_type' })
    }
    const body = write ? await readBody(req) : { raw: Buffer.alloc(0), tooLarge: false }
    if (body.tooLarge) throw new HttpError(413, { error: 'too_large' })
    const matched = routes.map((r) => ({ r, m: r.method === method ? r.pattern.exec(url.pathname) : null })).find((x) => x.m)
    if (!matched) throw notFound()
    let user: User | null = null
    if (matched.r.access === 'user') {
      user = await userOf(req)
      if (!user) throw unauthenticated()
    }
    const params = Object.fromEntries(matched.r.keys.map((k, i) => [k, segment(matched.m![i + 1])]))
    const ctx: Ctx = {
      req, res, url, params, user: user as User, raw: body.raw,
      body() {
        if (!body.raw.length) return {}
        let parsed: unknown
        try { parsed = JSON.parse(body.raw.toString('utf8')) } catch { throw invalid('body', 'The request body is not valid JSON.') }
        refuseNul(parsed)
        return parsed
      },
      reply(status, payload, extra) { send(res, status, payload, { ...headers, ...extra }) },
    }
    await matched.r.handler(ctx)
    if (!res.headersSent) send(res, 204, undefined)
  } catch (error) {
    if (res.headersSent) {
      res.destroy()
      return
    }
    if (error instanceof HttpError) return send(res, error.status, error.body, error.headers)
    console.error(error)
    send(res, 500, { error: 'server_error', message: 'Something went wrong.' })
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
}

export function staticHandler(root: string): (req: IncomingMessage, res: ServerResponse, url: URL) => void {
  return (req, res, url) => {
    let decoded = url.pathname
    try { decoded = decodeURIComponent(url.pathname) } catch { decoded = '/' }
    const requested = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '')
    let file = path.join(root, requested)
    const inside = file.startsWith(root + path.sep) || file === root
    const asset = inside && existsSync(file) && statSync(file).isFile() && !path.basename(file).startsWith('.')
    if (!asset) file = path.join(root, 'index.html')
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream'
    const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
    res.writeHead(asset || url.pathname === '/' || !path.extname(url.pathname) ? 200 : 404, {
      'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
    })
    if (req.method === 'HEAD') return void res.end()
    createReadStream(file).pipe(res)
  }
}

export function dispatch(serveStatic: ReturnType<typeof staticHandler>) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://local')
    if (url.pathname.startsWith('/api/')) void api(req, res, url)
    else serveStatic(req, res, url)
  }
}
