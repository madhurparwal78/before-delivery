/**
 * PocketBase collaboration store: presence, comments and placement changes.
 * The server subscribes to PocketBase realtime events and relays them to
 * browsers through each project's live stream.
 */
import { config } from './db.js'

export interface PresenceRecord {
  project_id: string
  user_id: string
  name: string
  initials: string
}

export class CollaborationUnavailable extends Error {}

const TIMEOUT = 10_000

interface PbRecord {
  id: string
  [key: string]: unknown
}

export interface CollaborationEvent {
  kind: 'presence' | 'comment' | 'placement'
  project_id: string
  action?: 'created' | 'updated' | 'deleted'
  comment?: { id: string; author_name: string; body: string; created_at: string }
  placement?: { id: string; variant_code: string; x_mm: number; y_mm: number; action: string }
}

export interface CommentRecord {
  id: string
  author_name: string
  body: string
  created_at: string
}

export class PocketBaseStore {
  private token: string | null = null
  private token_time = 0
  private listeners = new Set<(event: CollaborationEvent) => void>()

  constructor(private readonly base_url: string) {}

  private async admin_token(force = false): Promise<string> {
    const fresh = Date.now() - this.token_time < 30 * 60 * 1000
    if (this.token && !force && fresh) return this.token
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT)
    try {
      const response = await fetch(`${this.base_url}/api/admins/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: config().pocketbase_admin_email,
          password: config().pocketbase_admin_password,
        }),
        signal: controller.signal,
      })
      if (!response.ok) throw new CollaborationUnavailable('admin auth failed')
      const body = (await response.json()) as { token: string }
      this.token = body.token
      this.token_time = Date.now()
      return this.token
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof CollaborationUnavailable) throw err
      throw new CollaborationUnavailable('PocketBase unreachable')
    } finally {
      clearTimeout(timer)
    }
  }

  async call(
    path: string,
    init: { method: string; body?: unknown } = { method: 'GET' },
  ): Promise<unknown> {
    const token = await this.admin_token()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT)
    let response: Response
    try {
      response = await fetch(`${this.base_url}${path}`, {
        method: init.method,
        headers: {
          Authorization: token,
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      })
    } catch {
      clearTimeout(timer)
      throw new CollaborationUnavailable('PocketBase unreachable')
    }
    clearTimeout(timer)
    if (response.status === 401 || response.status === 403) {
      // Token may have expired mid-flight; retry once with a fresh one.
      if (!path.includes('auth-with-password')) {
        await this.admin_token(true)
        return this.call(path, init)
      }
    }
    if (response.status >= 500) throw new CollaborationUnavailable('PocketBase server error')
    if (response.status === 404) throw new CollaborationUnavailable('collection missing')
    return response
  }

  /** Create the three collections on every start, leaving existing ones as they are. */
  async ensure_collections(): Promise<boolean> {
    const defs = [
      { name: 'lf_presence', fields: ['project_id', 'user_id', 'name', 'initials', 'seen_at'] },
      { name: 'lf_comments', fields: ['project_id', 'author_id', 'author_name', 'body'] },
      { name: 'lf_placements', fields: ['project_id', 'placement_id', 'variant_code', 'x_mm', 'y_mm', 'action'] },
    ]
    for (const def of defs) {
      const response = (await this.call('/api/collections?perPage=100', { method: 'GET' })) as Response
      const list = (await response.json()) as { items: { name: string }[] }
      const exists = list.items.some((c) => c.name === def.name)
      if (!exists) {
        const schema = def.fields.map((name) => ({ name, type: 'text', required: true }))
        const created = (await this.call('/api/collections', {
          method: 'POST',
          body: { name: def.name, type: 'base', schema },
        })) as Response
        if (!created.ok) return false
      }
    }
    return true
  }

  async upsert_presence(project_id: string, user_id: string, name: string, initials: string): Promise<boolean> {
    try {
      const list = (await this.call(
        `/api/collections/lf_presence/records?filter=${encodeURIComponent(`project_id="${project_id}" && user_id="${user_id}"`)}`,
      )) as Response
      const body = (await list.json()) as { items: PbRecord[] }
      const record = body.items[0]
      const payload = {
        project_id,
        user_id,
        name,
        initials,
        seen_at: new Date().toISOString(),
      }
      if (record) {
        const update = (await this.call(`/api/collections/lf_presence/records/${record.id}`, {
          method: 'PATCH',
          body: payload,
        })) as Response
        return update.ok
      }
      const create = (await this.call('/api/collections/lf_presence/records', {
        method: 'POST',
        body: payload,
      })) as Response
      return create.ok
    } catch {
      return false
    }
  }

  async remove_presence(project_id: string, user_id: string): Promise<void> {
    try {
      const list = (await this.call(
        `/api/collections/lf_presence/records?filter=${encodeURIComponent(`project_id="${project_id}" && user_id="${user_id}"`)}`,
      )) as Response
      const body = (await list.json()) as { items: PbRecord[] }
      for (const record of body.items) {
        await this.call(`/api/collections/lf_presence/records/${record.id}`, { method: 'DELETE' })
      }
    } catch {
      // Presence cleanup is best-effort.
    }
  }

  async list_presence(project_id: string): Promise<{ user_id: string; name: string; initials: string }[]> {
    const list = (await this.call(
      `/api/collections/lf_presence/records?filter=${encodeURIComponent(`project_id="${project_id}"`)}`,
    )) as Response
    const body = (await list.json()) as { items: PbRecord[] }
    return body.items.map((r) => ({
      user_id: String(r['user_id']),
      name: String(r['name']),
      initials: String(r['initials']),
    }))
  }

  async create_comment(project_id: string, author_id: number, author_name: string, body_text: string): Promise<CommentRecord> {
    const create = (await this.call('/api/collections/lf_comments/records', {
      method: 'POST',
      body: { project_id, author_id: String(author_id), author_name, body: body_text },
    })) as Response
    if (!create.ok) throw new CollaborationUnavailable('comment create failed')
    const record = (await create.json()) as PbRecord
    return {
      id: record.id,
      author_name,
      body: body_text,
      created_at: (record['created'] as string | undefined) ?? new Date().toISOString(),
    }
  }

  async list_comments(project_id: string): Promise<CommentRecord[]> {
    const list = (await this.call(
      `/api/collections/lf_comments/records?sort=created&filter=${encodeURIComponent(`project_id="${project_id}"`)}`,
    )) as Response
    const body = (await list.json()) as { items: PbRecord[] }
    return body.items.map((r) => ({
      id: r.id,
      author_name: String(r['author_name']),
      body: String(r['body']),
      created_at: String(r['created']),
    }))
  }

  async write_placement(
    project_id: string,
    placement_id: number,
    variant_code: string,
    x_mm: number,
    y_mm: number,
    action: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    const create = (await this.call('/api/collections/lf_placements/records', {
      method: 'POST',
      body: { project_id, placement_id: String(placement_id), variant_code, x_mm: String(x_mm), y_mm: String(y_mm), action },
    })) as Response
    if (!create.ok) throw new CollaborationUnavailable('placement write failed')
  }

  on_event(listener: (event: CollaborationEvent) => void): void {
    this.listeners.add(listener)
  }

  off_event(listener: (event: CollaborationEvent) => void): void {
    this.listeners.delete(listener)
  }

  private emit(event: CollaborationEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private sse_controller: AbortController | null = null

  /** Subscribe to the three collections and relay events to listeners. */
  async subscribe(): Promise<void> {
    if (this.sse_controller) return
    const controller = new AbortController()
    this.sse_controller = controller
    try {
      await this.run_subscription(controller)
    } finally {
      if (this.sse_controller === controller) this.sse_controller = null
    }
  }

  unsubscribe(): void {
    this.sse_controller?.abort()
    this.sse_controller = null
  }

  private async run_subscription(controller: AbortController): Promise<void> {
    const token = await this.admin_token()
    const response = await fetch(`${this.base_url}/api/realtime?SSE=1`, {
      headers: { Authorization: token, Accept: 'text/event-stream' },
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new CollaborationUnavailable('realtime connect failed')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let client_id: string | null = null
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event_m = /^event:(.*)$/m.exec(chunk)
        const data_m = /^data:(.*)$/m.exec(chunk)
        if (!event_m || !data_m) continue
        const event = event_m ? event_m[1]!.trim() : 'message'
        const data = data_m[1]!.trim()
        if (event === 'PB_CONNECT') {
          client_id = (JSON.parse(data) as { clientId: string }).clientId
          const sub = await fetch(`${this.base_url}/api/realtime`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: token },
            body: JSON.stringify({
              clientId: client_id,
              subscriptions: ['lf_presence/*', 'lf_comments/*', 'lf_placements/*'],
            }),
          })
          if (!sub.ok) throw new CollaborationUnavailable('realtime subscribe failed')
          continue
        }
        if (!event.startsWith('lf_')) continue
        const payload = JSON.parse(data) as { record: Record<string, unknown>; action: string }
        const record = payload.record
        const project_id = String(record['project_id'])
        const action = payload.action === 'create' ? 'created' : payload.action === 'update' ? 'updated' : 'deleted'
        if (event.startsWith('lf_comments')) {
          this.emit({
            kind: 'comment',
            project_id,
            comment: {
              id: String(record['id']),
              author_name: String(record['author_name']),
              body: String(record['body']),
              created_at: String(record['created']),
            },
          })
        } else if (event.startsWith('lf_placements')) {
          this.emit({
            kind: 'placement',
            project_id,
            action,
            placement: {
              id: String(record['placement_id']),
              variant_code: String(record['variant_code']),
              x_mm: Number(record['x_mm']),
              y_mm: Number(record['y_mm']),
              action,
            },
          })
        } else {
          this.emit({
            kind: 'presence',
            project_id,
          })
        }
      }
    }
  }

  async probe(): Promise<boolean> {
    try {
      const response = (await this.call('/api/health')) as Response
      return response.ok
    } catch {
      return false
    }
  }
}
