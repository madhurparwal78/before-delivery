import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiError } from './errors.ts'

const BODY_LIMIT_BYTES = 5_000_000
export const SESSION_COOKIE = 'joinery_session'
export const SESSION_DAYS = 30

export interface Context {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
  rawBody: Buffer
  cookie: string | null
}

export type Reply =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | { status: number; raw: Buffer; contentType: string; headers?: Record<string, string> }

type Handler = (context: Context) => Promise<Reply>

export interface Route {
  method: string
  pattern: RegExp
  handler: Handler
}

export const route = (method: string, path: string, handler: Handler): Route => ({
  method,
  pattern: new RegExp(`^${path.replace(/:([a-z]+)/gi, '(?<$1>[^/]+)')}$`),
  handler,
})

export function cookieValue(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

export function sessionCookie(token: string | null): string {
  const base = `${SESSION_COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax`
  const expires = token === null ? new Date(0) : new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  return `${base}; Expires=${expires.toUTCString()}`
}

/** Reads the whole body; a body over the limit is drained and refused before any other check. */
export function readBody(req: IncomingMessage): Promise<Buffer | 'too-large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= BODY_LIMIT_BYTES) chunks.push(chunk)
    })
    req.on('end', () => resolve(size > BODY_LIMIT_BYTES ? 'too-large' : Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function respond(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) }
  if ('raw' in reply) {
    headers['Content-Type'] = reply.contentType
    res.writeHead(reply.status, headers)
    res.end(reply.raw)
    return
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers)
    res.end()
    return
  }
  headers['Content-Type'] = 'application/json; charset=utf-8'
  res.writeHead(reply.status, headers)
  res.end(JSON.stringify(reply.body))
}

export function respondError(res: ServerResponse, error: ApiError): void {
  respond(res, { status: error.status, body: error.body, headers: error.headers })
}

/** A whole number from a query string, or null when it is not one. */
export function integerParam(value: string | null): number | null {
  return value !== null && /^\d+$/.test(value) ? Number(value) : null
}

/** The request body as a JSON object, or an empty object when it is not one. */
export function jsonBody(context: Context): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(context.rawBody.toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
