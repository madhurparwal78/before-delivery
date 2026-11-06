import type { IncomingMessage } from 'node:http'
import type { Api } from './api.js'
import type { Incoming, RouteContext } from './api.js'

export type { RouteContext } from './api.js'
export type Handler = (ctx: RouteContext) => Promise<void>

export interface RouteEntry {
  method: string
  pattern: RegExp
  names: string[]
  handler: Handler
  raw: boolean
}

export interface RouteOptions {
  /** True for endpoints that read their own raw body (cover upload). */
  raw?: boolean
}

export function route(
  api: Api,
  method: string,
  spec: string,
  handler: Handler,
  options: RouteOptions = {},
): void {
  const names: string[] = []
  const source = spec
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        names.push(segment.slice(1))
        return '([^/]+)'
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  api.routes.push({ method, pattern: new RegExp(`^${source}$`), names, handler, raw: options.raw ?? false })
}

export function match_route(
  api: Api,
  method: string,
  path: string,
): { handler: Handler; params: Record<string, string>; raw: boolean } | null {
  for (const r of api.routes) {
    if (r.method !== method) continue
    const m = r.pattern.exec(path)
    if (!m) continue
    const params: Record<string, string> = {}
    r.names.forEach((name, i) => {
      params[name] = decodeURIComponent(m[i + 1]!)
    })
    return { handler: r.handler, params, raw: r.raw }
  }
  return null
}

export function request_url(req: IncomingMessage): URL {
  const host = req.headers.host ?? 'localhost'
  return new URL(req.url ?? '/', `http://${host}`)
}

export function query_list(url: URL, name: string): string[] {
  const raw = url.searchParams.get(name)
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter((s) => s !== '')
}

export function query_bool(url: URL, name: string): boolean {
  return url.searchParams.get(name) === 'true'
}

export function assert_string(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('expected string')
  return value
}

export interface RouterIncoming extends Incoming {}
