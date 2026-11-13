import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { JsonNumber } from '../shared/numbers'
import { refuse } from './errors'

const JSON_LIMIT = 100000
/** Room for the multipart envelope around an uploaded file, which the file limits do not count. */
const ENVELOPE_ALLOWANCE = 65536
const DRAIN_CEILING = 64 * 1024 * 1024

export interface Reply {
  status: number
  /** A JSON body. */
  body?: unknown
  /** Pre-serialised JSON, sent exactly as stored. */
  text?: string
  /** A binary body with its media type. */
  bytes?: { data: Buffer; contentType: string }
  headers?: Record<string, string | string[]>
}

export interface Context {
  req: IncomingMessage
  method: string
  path: string
  params: Record<string, string>
  query: URLSearchParams
  rawBody: Buffer
  sessionToken: string | null
  /** The JSON object the request carried; numbers keep the digits that were written. */
  json(): Record<string, unknown>
  /** The named file part of a multipart upload. */
  file(name: string): { filename: string; data: Buffer } | null
  header(name: string): string | undefined
}

export type Handler = (ctx: Context) => Promise<Reply>

export interface Route {
  method: string
  pattern: string
  access: 'session' | 'public'
  /** How the request body arrives: JSON, or a multipart upload whose file may be `fileLimit` bytes. */
  body?: { kind: 'multipart'; fileLimit: number }
  handler: Handler
}

export function bodyLimit(route: Route | undefined): number {
  return route?.body ? route.body.fileLimit + ENVELOPE_ALLOWANCE : JSON_LIMIT
}

/** Reads a request body; one over the limit is drained, not stored, and refused. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length
    if (total <= limit) chunks.push(chunk)
    else if (total > DRAIN_CEILING) req.destroy()
  }
  if (total > limit) throw refuse.payloadTooLarge()
  return Buffer.concat(chunks)
}

function reviveNumbers(this: unknown, _key: string, value: unknown, context?: { source?: string }): unknown {
  return typeof value === 'number' && context?.source !== undefined ? new JsonNumber(context.source) : value
}

export function parseJsonObject(raw: Buffer): Record<string, unknown> {
  if (raw.length === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'), reviveNumbers)
  } catch {
    throw refuse.invalidJson()
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw refuse.invalidJson()
  return parsed as Record<string, unknown>
}

interface UploadedFile {
  filename: string
  data: Buffer
}

/** The named parts of a multipart/form-data body that carry a file. */
export function parseMultipart(body: Buffer, contentType: string): Map<string, UploadedFile> {
  const files = new Map<string, UploadedFile>()
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  const marker = Buffer.from(`--${boundary?.[1] ?? boundary?.[2] ?? ''}`)
  let start = body.indexOf(marker)
  while (start !== -1) {
    const next = body.indexOf(marker, start + marker.length)
    if (next === -1) break
    const part = body.subarray(start + marker.length + 2, next - 2)
    const split = part.indexOf('\r\n\r\n')
    if (split !== -1) {
      const head = part.subarray(0, split).toString('utf8')
      const name = /name="([^"]*)"/i.exec(head)?.[1]
      const filename = /filename="([^"]*)"/i.exec(head)?.[1]
      if (name !== undefined && filename !== undefined) files.set(name, { filename, data: part.subarray(split + 4) })
    }
    start = next
  }
  return files
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function cookieValue(header: string | undefined, name: string): string | null {
  for (const pair of (header ?? '').split(';')) {
    const [key, ...rest] = pair.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

const ROUTE_PARAM = /^:(\w+)$/

/** Matches a path against `/a/:id/b`, returning the parameters. */
export function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const wanted = pattern.split('/')
  const actual = path.split('/')
  if (wanted.length !== actual.length) return null
  const params: Record<string, string> = {}
  for (const [index, part] of wanted.entries()) {
    const value = actual[index] ?? ''
    const parameter = ROUTE_PARAM.exec(part)?.[1]
    if (parameter) params[parameter] = decodeURIComponent(value)
    else if (part !== value) return null
  }
  return params
}
