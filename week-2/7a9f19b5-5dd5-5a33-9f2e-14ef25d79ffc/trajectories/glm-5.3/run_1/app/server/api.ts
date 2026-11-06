/**
 * The HTTP API: routing, error precedence and endpoint handlers.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool, DbClient } from './db.js'
import { read_session_cookie, caller_from_token, type Caller } from './session.js'
import { ApiError, send_json, is_cross_origin, read_json_frame } from './http.js'
import type { Storage } from './storage.js'
import type { Mailer } from './mail.js'
import { PocketBaseStore, CollaborationUnavailable } from './pocketbase.js'
import { match_route, request_url, type RouteEntry } from './router.js'

export interface Incoming extends IncomingMessage {}

export interface RouteContext {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  params: Record<string, string>
  client: DbClient
  caller: Caller | null
  api: Api
  body: Record<string, unknown>
}

export interface ApiDeps {
  storage: Storage
  mailer: Mailer
  pocketbase: PocketBaseStore
  today: () => string
}

export class Api {
  readonly routes: RouteEntry[] = []
  readonly deps: ApiDeps
  private db: Pool

  constructor(db: Pool, deps: ApiDeps) {
    this.db = db
    this.deps = deps
  }

  today(): string {
    return this.deps.today()
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let client: DbClient | null = null
    try {
      if (is_cross_origin(req)) {
        send_json(res, 403, { error: 'cross_origin' })
        return
      }
      const method = req.method ?? 'GET'
      const url = request_url(req)
      const matched = match_route(this, method, url.pathname)
      if (!matched) {
        send_json(res, 404, { error: 'not_found' })
        return
      }
      // Request framing comes before authentication (error precedence).
      let body: Record<string, unknown> = {}
      if (['POST', 'PUT', 'PATCH'].includes(method) && !matched.raw) {
        const content_type = req.headers['content-type']
        if (content_type && !/^application\/json/i.test(content_type)) {
          send_json(res, 415, { error: 'unsupported_media_type' })
          return
        }
        body = await read_json_frame(req)
      }
      client = await this.db.connect()
      const caller = await caller_from_token(client, read_session_cookie(req))
      const ctx: RouteContext = {
        req,
        res,
        url,
        params: matched.params,
        client,
        caller,
        api: this,
        body,
      }
      // Admin paths refuse non-admins before any record is looked up.
      if (url.pathname.startsWith('/api/admin/')) {
        if (!caller) {
          send_json(res, 401, { error: 'unauthenticated' })
          return
        }
        if (!caller.is_admin()) {
          send_json(res, 403, { error: 'forbidden' })
          return
        }
      }
      await matched.handler(ctx)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.field_errors) {
          send_json(res, err.status, { error: err.code }, { errors: err.field_errors })
        } else {
          send_json(res, err.status, { error: err.code })
        }
        return
      }
      if (err instanceof CollaborationUnavailable) {
        send_json(res, 503, { error: 'collaboration_unavailable' })
        return
      }
      console.error('API error', err)
      if (!res.writableEnded) {
        send_json(res, 500, { error: 'internal' })
      }
    } finally {
      if (client) client.release()
    }
  }

  async with_client<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect()
    try {
      return await fn(client)
    } finally {
      client.release()
    }
  }

  async process_pending_shares(): Promise<void> {
    try {
      const { process_shares } = await import('./shares.js')
      await process_shares(this)
    } catch (err) {
      // Storage or mail outage: retried on the next cadence.
    }
  }

  async refresh_collaboration(): Promise<void> {
    try {
      await this.deps.pocketbase.ensure_collections()
      await this.deps.pocketbase.subscribe()
    } catch {
      this.deps.pocketbase.unsubscribe()
    }
  }
}
