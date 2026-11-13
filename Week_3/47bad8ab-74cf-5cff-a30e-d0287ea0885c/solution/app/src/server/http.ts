import type { IncomingMessage, ServerResponse } from 'node:http'
import { JSON_BODY_LIMIT } from '../shared/types.ts'
import { config } from './config.ts'
import { pool } from './db.ts'
import { ApiError, errorBody, invalid, uploadTooLarge } from './errors.ts'
import { UUID } from './puzzles.ts'
import { overRate } from './rate.ts'

interface Player {
  id: string
  displayName: string
}

export interface Reply {
  status: number
  body?: unknown
  raw?: { bytes: Buffer; type: string; disposition?: string }
  cookie?: string
}

interface OpenContext {
  player: Player | null
  params: string[]
  query: URLSearchParams
  origin: string
  body: Buffer
  json(): Record<string, unknown>
}

interface Context extends OpenContext {
  player: Player
}

type Body = 'none' | 'json' | 'upload'

interface RouteBase {
  method: 'GET' | 'POST' | 'PUT'
  path: RegExp
  body: Body
  rated?: boolean
}

export type Route = (RouteBase & { needsPlayer: true; handle: (context: Context) => Promise<Reply> }) | (RouteBase & { needsPlayer: false; handle: (context: OpenContext) => Promise<Reply> })

const COOKIE = 'overlap_player'
const DRAIN_LIMIT = 8 * 1024 * 1024

export const cookieHeader = (playerId: string): string => `${COOKIE}=${playerId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`

export function cookieOf(header: string | undefined): string | null {
  const match = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))
  return match ? match.slice(COOKIE.length + 1) : null
}

export async function playerFromCookie(value: string | null): Promise<Player | null> {
  if (value === null || !UUID.test(value)) return null
  const { rows } = await pool.query<{ id: string; display_name: string }>('SELECT id, display_name FROM players WHERE id = $1', [value])
  return rows[0] ? { id: rows[0].id, displayName: rows[0].display_name } : null
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size <= limit) chunks.push(chunk)
    else if (size > DRAIN_LIMIT) request.destroy()
  }
  if (size > limit) throw new ApiError('too_large')
  return Buffer.concat(chunks)
}

function jsonObject(body: Buffer): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'))
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // falls through to the one invalid answer
  }
  throw invalid({ body: 'The body must be a JSON object.' })
}

export function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {}
  if (reply.cookie) headers['set-cookie'] = reply.cookie
  if (reply.raw) {
    headers['content-type'] = reply.raw.type
    if (reply.raw.disposition) headers['content-disposition'] = reply.raw.disposition
    response.writeHead(reply.status, headers)
    response.end(reply.raw.bytes)
    return
  }
  if (reply.body === undefined) {
    response.writeHead(reply.status, headers)
    response.end()
    return
  }
  headers['content-type'] = 'application/json; charset=utf-8'
  response.writeHead(reply.status, headers)
  response.end(JSON.stringify(reply.body))
}

export function sendError(response: ServerResponse, error: ApiError): void {
  send(response, { status: error.status, body: errorBody(error) })
}

/** The one error precedence: body size, then player, then rate, then the route's own 404, 403, replay, 409, 422 and 503 steps. */
export async function dispatch(routes: readonly Route[], request: IncomingMessage, origin: string): Promise<Reply> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  let params: string[] = []
  const route = routes.find((candidate) => {
    const match = candidate.method === request.method ? candidate.path.exec(url.pathname) : null
    if (match) params = match.slice(1)
    return match !== null
  })
  if (!route) throw new ApiError('not_found')
  const body = route.body === 'none' ? Buffer.alloc(0) : await readBody(request, route.body === 'upload' ? config.uploadMaxBytes : JSON_BODY_LIMIT).catch((error: unknown) => {
    throw error instanceof ApiError && route.body === 'upload' ? uploadTooLarge() : error
  })
  const player = await playerFromCookie(cookieOf(request.headers.cookie))
  const context: OpenContext = { player, params, query: url.searchParams, origin, body, json: () => jsonObject(body) }
  if (!route.needsPlayer) return route.handle(context)
  if (!player) throw new ApiError('no_player')
  if (route.rated && overRate(player.id)) throw new ApiError('rate_limited')
  return route.handle({ ...context, player })
}
