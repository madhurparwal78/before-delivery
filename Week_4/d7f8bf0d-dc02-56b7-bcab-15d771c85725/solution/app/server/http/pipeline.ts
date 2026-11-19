import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Role } from '../../shared/domain'
import { roleIn, userForToken, type AuthUser } from '../auth'
import { canonicalJson, sha256Hex } from '../canonical'
import { db, one, type Db, type Tx } from '../db'
import { loadLayout, type LayoutRow } from '../services/layout-store'
import { loadWorkspaceSession } from '../services/session-store'
import type { SessionRow } from '../domain/session/state'
import type { Services } from '../services'
import {
  ApiError, badContentType, badJson, bodyTooLarge, forbidden, invalidFields, keyRequired, keyReused, notFound, sessionRequired,
  staleRevision, valkeyUnavailable,
} from './errors'

export const COOKIE = 'gandyboard_session'
const BODY_LIMIT = 1_000_000
const KEY_PATTERN = /^[\x21-\x7e]{1,128}$/

export type Reply =
  | { status: number; body: unknown; headers?: Record<string, string> }
  | { status: number; raw: Buffer; headers: Record<string, string> }
  | { streamed: true }

export interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  services: Services
  params: Record<string, string>
  query: URLSearchParams
  body: Record<string, unknown>
  user: AuthUser
  role: Role | null
  workspaceId: string | null
  token: string | null
  // Writes run inside one transaction; reads use the pool.
  tx: Tx | null
  client: Db
  layout: LayoutRow
  session: SessionRow
  // Set by `load`ed objects when the route has a `resolve` step.
  found: Record<string, unknown>
}

export type Access = 'open' | 'user' | 'founder' | Role[]
export type Load = 'layout' | 'session' | 'workspace' | null

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH'
  path: string
  access: Access
  // The object whose row is loaded (and locked for writes) before anything else is checked.
  load?: Load
  // Step 3: sub-objects of the loaded one; throws not_found.
  resolve?: (c: Ctx) => Promise<void> | void
  // Writes carry an Idempotency-Key unless this is false.
  key?: boolean
  // The current revision of the object the write changes; the body's `revision` must equal it.
  revision?: (c: Ctx) => number
  // Session commands answer 503 while Valkey is unreachable.
  live?: boolean
  handle: (c: Ctx) => Promise<Reply>
}

interface Compiled { route: Route; names: string[]; pattern: RegExp }

function compile(route: Route): Compiled {
  const names: string[] = []
  const source = route.path.replace(/:([a-z_]+)/g, (_, name: string) => {
    names.push(name)
    return '([^/]+)'
  })
  return { route, names, pattern: new RegExp(`^${source}$`) }
}

export function matchRoute(compiled: Compiled[], method: string, path: string): { route: Route; params: Record<string, string> } | undefined {
  for (const candidate of compiled) {
    if (candidate.route.method !== method) continue
    const match = candidate.pattern.exec(path)
    if (match === null) continue
    try {
      // Postgres text cannot hold a NUL byte (a lookup on one is a 500); no stored id has one, so it reads as an id nothing has.
      const decoded = (text: string): string => decodeURIComponent(text).replaceAll('\0', '\uFFFD')
      return { route: candidate.route, params: Object.fromEntries(candidate.names.map((name, i) => [name, decoded(match[i + 1])])) }
    } catch {
      return undefined
    }
  }
  return undefined
}

export const compileRoutes = (routes: Route[]): Compiled[] => routes.map(compile)

function cookieToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie
  if (header === undefined) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE) return rest.join('=')
  }
  return null
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= BODY_LIMIT) chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      if (size > BODY_LIMIT) return reject(bodyTooLarge())
      if (size === 0) return resolve({})
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return reject(badContentType())
      let parsed: unknown
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return reject(badJson())
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return reject(badJson())
      return resolve(parsed as Record<string, unknown>)
    })
  })
}

function allowed(access: Access, role: Role | null, user: AuthUser): boolean {
  if (access === 'open' || access === 'user') return true
  if (access === 'founder') return user.is_founder
  return role !== null && access.includes(role)
}

// Instances notice an outage moments apart. A session held for Valkey is already the committed record of one, so every
// instance refuses alike until the engine releases it.
const valkeyOut = (c: Ctx): boolean => !c.services.valkey.up || c.session?.hold_reason === 'valkey'

async function lockRow(c: Ctx, load: Load, forUpdate: boolean): Promise<void> {
  if (load === 'layout') {
    const layout = await loadLayout(c.client, c.workspaceId as string, c.params.layout, forUpdate)
    if (layout === undefined) throw notFound()
    c.layout = layout
  } else if (load === 'session') {
    const session = await loadWorkspaceSession(c.client, c.workspaceId as string, c.params.session, forUpdate)
    if (session === undefined) throw notFound()
    c.session = session
  } else if (load === 'workspace') {
    await c.client.query(`select 1 from workspaces where id = $1${forUpdate ? ' for update' : ''}`, [c.workspaceId])
  }
}

interface StoredKey { fingerprint: string; status: number; body: unknown }

async function storedKey(client: Db, scope: string, userId: string, key: string): Promise<StoredKey | undefined> {
  return one<StoredKey>(client, 'select fingerprint, status, body from idempotency_keys where workspace_id = $1 and user_id = $2 and key = $3', [scope, userId, key])
}

function jsonReply(status: number, body: unknown): Reply {
  return { status, body }
}

// The fixed error order of the whole API: 401 session, 403 forbidden, 404 not found, 422 key, 409 stale revision,
// 503 Valkey, then the railway and validation rules (422). The server boundary's 400, 413 and 415 come before.
export async function runRoute(route: Route, params: Record<string, string>, req: IncomingMessage, res: ServerResponse, services: Services): Promise<Reply> {
  const isWrite = route.method !== 'GET'
  const body = isWrite ? await readBody(req) : {}
  const url = new URL(req.url ?? '/', 'http://localhost')
  const token = cookieToken(req)
  const user = route.access === 'open' || token === null ? undefined : await userForToken(token)
  if (route.access !== 'open' && user === undefined) throw sessionRequired()
  const workspaceId = params.workspace ?? null
  let role: Role | null = null
  if (workspaceId !== null && user !== undefined) {
    role = (await roleIn(workspaceId, user.id)) ?? null
    if (role === null) throw forbidden()
  }
  if (user !== undefined && !allowed(route.access, role, user)) throw forbidden()
  const c = { req, res, services, params, query: url.searchParams, body, user, role, workspaceId, token, tx: null, client: db(), found: {} } as unknown as Ctx
  if (!isWrite) {
    await lockRow(c, route.load ?? null, false)
    await route.resolve?.(c)
    if (route.live === true && valkeyOut(c)) throw valkeyUnavailable()
    return route.handle(c)
  }
  return writeRoute(route, c)
}

async function writeRoute(route: Route, c: Ctx): Promise<Reply> {
  const client = await db().connect()
  const tx: Tx = { client, afterCommit: [] }
  c.tx = tx
  c.client = client
  try {
    await client.query('begin')
    await lockRow(c, route.load ?? null, true)
    await route.resolve?.(c)
    const scope = c.workspaceId ?? ''
    let key: string | null = null
    if (route.key !== false) {
      const header = c.req.headers['idempotency-key']
      if (typeof header !== 'string' || !KEY_PATTERN.test(header)) throw keyRequired()
      key = header
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`${scope}|${c.user.id}|${key}`])
      const fingerprint = sha256Hex(`${c.req.method}\n${c.req.url?.split('?')[0]}\n${canonicalJson(c.body)}`)
      const stored = await storedKey(client, scope, c.user.id, key)
      if (stored !== undefined) {
        if (stored.fingerprint !== fingerprint) throw keyReused()
        await client.query('rollback')
        return jsonReply(stored.status, stored.body)
      }
      c.found.fingerprint = fingerprint
    }
    let reply: Reply
    try {
      await client.query('savepoint handler')
      if (route.revision !== undefined) {
        const revision = c.body.revision
        if (!Number.isInteger(revision)) throw invalidFields({ revision: 'Reload and try again.' })
        const current = route.revision(c)
        if (revision !== current) throw staleRevision(current)
      }
      if (route.live === true && valkeyOut(c)) throw valkeyUnavailable()
      reply = await route.handle(c)
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 409 && error.status !== 422) || key === null) throw error
      await client.query('rollback to savepoint handler')
      reply = jsonReply(error.status, error.body)
    }
    if (key !== null && 'body' in reply) {
      await client.query(
        'insert into idempotency_keys (workspace_id, user_id, key, fingerprint, status, body) values ($1, $2, $3, $4, $5, $6)',
        [scope, c.user.id, key, c.found.fingerprint, reply.status, JSON.stringify(reply.body)],
      )
    }
    await client.query('commit')
    for (const hook of tx.afterCommit) hook()
    return reply
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
