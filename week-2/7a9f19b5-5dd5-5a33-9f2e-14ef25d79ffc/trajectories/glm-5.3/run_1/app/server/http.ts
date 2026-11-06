import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from './db.js'

/** The single error shape for every API error. */
export interface ApiErrorBody {
  error: string
  errors?: Record<string, string>
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public field_errors?: Record<string, string>,
  ) {
    super(code)
  }
}

export function error_body(status: number, code: string, field_errors?: Record<string, string>): { status: number; body: ApiErrorBody } {
  const body: ApiErrorBody = { error: code }
  if (field_errors) body.errors = field_errors
  return { status, body }
}

/**
 * Send a JSON reply. `extra` keys merge into the body for errors that carry
 * the resource (payment_unavailable, card_declined, insufficient_stock).
 */
export function send_json(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra?: Record<string, unknown>,
): void {
  if (res.writableEnded) return
  const merged = { ...(body as Record<string, unknown>), ...(extra ?? {}) }
  const text = JSON.stringify(merged)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

export function send_empty(res: ServerResponse, status: number): void {
  if (res.writableEnded) return
  res.writeHead(status)
  res.end()
}

/** Read and parse a JSON body with the shared limits. */
export async function read_json_body(req: IncomingMessage): Promise<unknown> {
  const raw = await read_body(req, 100_000, 413)
  if (raw.length === 0) throw new ApiError(400, 'invalid_json')
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw new ApiError(400, 'invalid_json')
  }
}

export async function read_multipart(
  req: IncomingMessage,
  limit: number,
): Promise<Record<string, { filename: string | null; content_type: string | null; data: Buffer }>> {
  const raw = await read_body(req, limit, 413)
  const boundary = boundary_of(req)
  if (!boundary) throw new ApiError(400, 'invalid_request')
  return parse_multipart(raw, boundary)
}

function boundary_of(req: IncomingMessage): string | null {
  const ct = req.headers['content-type']
  if (!ct) return null
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct)
  return m ? (m[1] ?? m[2])!.trim() : null
}

function read_body(req: IncomingMessage, limit: number, too_large_status: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let too_large = false
    req.on('data', (chunk: Buffer) => {
      if (too_large) return
      size += chunk.length
      if (size > limit) {
        // Drain the rest, then answer once the body has arrived.
        too_large = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (too_large) {
        reject(new ApiError(too_large_status, 'payload_too_large'))
        return
      }
      resolve(Buffer.concat(chunks))
    })
    req.on('error', () => {
      reject(new ApiError(400, 'invalid_request'))
    })
  })
}

function parse_multipart(
  raw: Buffer,
  boundary: string,
): Record<string, { filename: string | null; content_type: string | null; data: Buffer }> {
  const delim = Buffer.from(`--${boundary}`)
  const parts: Record<string, { filename: string | null; content_type: string | null; data: Buffer }> = {}
  let index = raw.indexOf(delim)
  while (index !== -1) {
    const next = raw.indexOf(delim, index + delim.length)
    if (next === -1) break
    let part = raw.subarray(index + delim.length, next)
    // strip leading CRLF and trailing CRLF
    if (part[0] === 13 && part[1] === 10) part = part.subarray(2)
    if (part[part.length - 2] === 13 && part[part.length - 1] === 10) part = part.subarray(0, part.length - 2)
    const header_end = part.indexOf('\r\n\r\n')
    if (header_end !== -1) {
      const header_text = part.subarray(0, header_end).toString('utf8')
      const data = part.subarray(header_end + 4)
      const name_m = /name="([^"]*)"/i.exec(header_text)
      const file_m = /filename="([^"]*)"/i.exec(header_text)
      const ct_m = /content-type:\s*([^\r\n]+)/i.exec(header_text)
      if (name_m) {
        parts[name_m[1]!] = {
          filename: file_m ? file_m[1]! : null,
          content_type: ct_m ? ct_m[1]!.trim() : null,
          data,
        }
      }
    }
    index = next
  }
  return parts
}

export function url_origin(url: string): string | null {
  const m = /^[^:]+:\/\/[^/]+/i.exec(url)
  return m ? m[0] : null
}

export function app_origin(): string {
  return config().app_public_url.replace(/\/$/, '')
}

/** True when the request's Origin header, when present, differs from our own origin. */
export function is_cross_origin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return false
  return origin.replace(/\/$/, '') !== app_origin()
}



/** Framing pass for JSON bodies: limits and parse errors, checked before auth. */
export async function read_json_frame(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await read_body(req, 100_000, 413)
  if (raw.length === 0) return {}
  try {
    return JSON.parse(raw.toString('utf8')) as Record<string, unknown>
  } catch {
    throw new ApiError(400, 'invalid_json')
  }
}
