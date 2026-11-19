/** The HTTP layer: routes, the error rule's first steps (401, bad origin), bodies with size limits, cookies and static files. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { SESSION_SECONDS, config } from './config'
import { isDatabaseDown, pool } from './db'
import { ApiError, type ErrorCode } from './errors'
import { type PlayerRow, playerOfToken } from './players'
import type { Me } from '../shared/types'

/** Builds a player's `/api/me` answer (passed in by `main.ts`, which owns the wiring of the route modules). */
type MeOf = (player: PlayerRow) => Promise<Me>

const SESSION_COOKIE = 'hf_session'
const JSON_LIMIT = 64000

export interface Context {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  params: string[]
  player: PlayerRow | null
  /** The requesting page's tab id, when it sent one. */
  tab: string
  /** The JSON body (at most 64,000 bytes). */
  json(): Promise<Record<string, unknown>>
  /** The raw body, refused with `tooLarge` past `limit` bytes. */
  raw(limit: number, tooLarge: ErrorCode): Promise<Buffer>
}

interface Reply {
  status: number
  body?: unknown
  headers?: Record<string, string>
  bytes?: { data: Buffer; type: string }
}

/** A handler that writes its own response (a stream) returns nothing. */
type Handler = (context: Context) => Promise<Reply | undefined>
type Auth = 'required' | 'optional' | 'none'
interface Route { method: string; pattern: RegExp; auth: Auth; handler: Handler }

const routes: Route[] = []

export function route(method: string, path: string, auth: Auth, handler: Handler): void {
  routes.push({ method, pattern: new RegExp(`^${path.replace(/:\w+/g, '([^/]+)')}$`), auth, handler })
}

let databaseReady = false
export function markDatabaseReady(): void { databaseReady = true }

async function readBody(req: IncomingMessage, limit: number, tooLarge: ErrorCode): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size <= limit) chunks.push(chunk)
  }
  if (size > limit) throw new ApiError(tooLarge, String(config.photoMaxBytes))
  return Buffer.concat(chunks)
}

function parseJson(buffer: Buffer): Record<string, unknown> {
  if (buffer.length === 0) return {}
  let value: unknown
  try {
    value = JSON.parse(buffer.toString('utf8'), (_key, text: unknown) => {
      if (typeof text === 'string' && text.includes('\0')) throw new Error('NUL')
      return text
    })
  } catch {
    throw new ApiError('bad_request')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError('bad_request')
  return value as Record<string, unknown>
}

function cookieOf(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return undefined
}

export const sessionCookie = (token: string): string => `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_SECONDS}`
export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`

export function sessionToken(req: IncomingMessage): string | undefined {
  return cookieOf(req, SESSION_COOKIE)
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function send(res: ServerResponse, reply: Reply): void {
  const headers = { 'Cache-Control': 'no-store', ...reply.headers }
  if (reply.bytes) {
    res.writeHead(reply.status, { ...headers, 'Content-Type': reply.bytes.type, 'Content-Length': reply.bytes.data.length })
    res.end(reply.bytes.data)
    return
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers)
    res.end()
    return
  }
  const payload = JSON.stringify(reply.body)
  res.writeHead(reply.status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

function sendError(res: ServerResponse, error: ApiError): void {
  send(res, { status: error.status, body: error.body, headers: error.headers })
}

/** Path segments, decoded; a segment that is not valid UTF-8 or holds a NUL names nothing. */
function decodeParams(url: URL, pattern: RegExp): string[] {
  try {
    const params = (url.pathname.match(pattern) ?? []).slice(1).map(decodeURIComponent)
    if (params.some((part) => part.includes('\0'))) throw new ApiError('not_found')
    return params
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError('not_found')
  }
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET'
  const found = routes.find((r) => r.method === method && r.pattern.test(url.pathname))
  if (!found) throw new ApiError('not_found')
  if (!databaseReady && url.pathname !== '/api/health') throw new ApiError('database_unavailable')
  const token = sessionToken(req)
  const player = found.auth === 'none' || !token ? null : (await playerOfToken(pool, token)) ?? null
  if (found.auth === 'required' && !player) throw new ApiError('not_signed_in')
  if (method !== 'GET' && !sameOrigin(req)) throw new ApiError('bad_origin')
  const params = decodeParams(url, found.pattern)
  for (const [name, value] of url.searchParams) if (name.includes('\0') || value.includes('\0')) throw new ApiError('bad_request')
  let body: Promise<Buffer> | undefined
  const context: Context = {
    req, res, url, player,
    params,
    tab: String(req.headers['x-tab-id'] ?? ''),
    json: async () => {
      body ??= readBody(req, JSON_LIMIT, 'too_large')
      return parseJson(await body)
    },
    raw: (limit, tooLarge) => readBody(req, limit, tooLarge),
  }
  const reply = await found.handler(context)
  if (reply) send(res, reply)
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.map': 'application/json',
}

const SESSION_SLOT = '<script type="application/json" id="session"></script>'

/** The page shell, carrying the caller's own `/api/me` answer (`null` when signed out); never cached. */
async function shell(req: IncomingMessage, meOf: MeOf): Promise<Buffer> {
  const template = await readFile(join(config.publicDir, 'index.html'), 'utf8')
  const token = sessionToken(req)
  const player = databaseReady && token ? await playerOfToken(pool, token).catch(() => undefined) : undefined
  const me = player ? await meOf(player).catch(() => null) : null
  const data = JSON.stringify(me).replace(/</g, '\\u003c')
  return Buffer.from(template.replace(SESSION_SLOT, `<script type="application/json" id="session">${data}</script>`))
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string, meOf: MeOf): Promise<void> {
  if (pathname.split('/').some((part) => part.startsWith('.'))) throw new ApiError('not_found')
  const asset = pathname.startsWith('/assets/')
  if (!asset) {
    if (extname(pathname) !== '') throw new ApiError('not_found')
    const page = await shell(req, meOf)
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Content-Length': page.length, 'Cache-Control': 'no-store' })
    res.end(page)
    return
  }
  const file = join(config.publicDir, normalize(pathname))
  if (!file.startsWith(config.publicDir + sep)) throw new ApiError('not_found')
  let data: Buffer
  try {
    data = await readFile(file)
  } catch {
    throw new ApiError('not_found')
  }
  const hashed = /-[A-Za-z0-9]{8}\.\w+$/.test(file)
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  res.end(data)
}

export function createHttpServer(meOf: MeOf): Server {
  const server = createServer((req, res) => {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      sendError(res, new ApiError('not_found'))
      return
    }
    const run = url.pathname.startsWith('/api/') || url.pathname === '/api' ? api(req, res, url) : serveStatic(req, res, url.pathname, meOf)
    run.catch((error: unknown) => {
      if (res.headersSent) { res.destroy(); return }
      if (error instanceof ApiError) sendError(res, error)
      else {
        if (!isDatabaseDown(error)) console.error(error)
        sendError(res, new ApiError('database_unavailable'))
      }
    })
  })
  return server
}
