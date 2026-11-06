import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { Store, newToken, newId, type PersonRow, type ProjectRow, type FigureRow } from './store.js'
import { SealService } from './seal.js'
import { ObjectStore } from './storage.js'
import { Mailer } from './mail.js'
import type { Config } from './config.js'
import {
  ApiError, Validator, crossOrigin, dependency, forbidden, invalidJson,
  notFound, payloadTooLarge, unauthenticated, unsupportedMediaType, validation,
} from './errors.js'
import { applySchema } from './schema.js'
import { seed } from './seed.js'
import { compareSync } from 'bcryptjs'
import { Decimal } from 'decimal.js'
import { createHash, randomUUID } from 'node:crypto'
import {
  apiTimestampTrunc, isApiTimestamp, isHalfHourTs, isUtcDate, parseApiTimestamp,
} from '../domain/time.js'
import { derive } from '../domain/derive.js'
import { buildReadingsFile } from '../domain/readingsFile.js'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'

type Body = Record<string, unknown>

type Ctx = {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
  body: Body
  rawBody: Buffer<ArrayBufferLike>
  person: PersonRow | null
}

type Sent = { __sent: true; status: number; body: unknown; headers?: Record<string, string> }

function sent(status: number, body: unknown, headers?: Record<string, string>): Sent {
  return { __sent: true, status, body, headers }
}

const BODY_LIMIT_DEFAULT = 65536
const BODY_LIMIT_INGEST = 2000000

export class App {
  private store: Store
  private objects: ObjectStore
  private mailer: Mailer
  private seals: SealService
  private instanceId = randomUUID()
  private alertTimer?: ReturnType<typeof setInterval>

  constructor(private cfg: Config, private distDir: string) {
    this.store = new Store(cfg.databaseUrl)
    this.objects = new ObjectStore(cfg)
    this.mailer = new Mailer(cfg)
    this.seals = new SealService(this.store, this.objects, this.mailer, cfg)
  }

  async start(): Promise<void> {
    const client = await this.waitForPostgres()
    try {
      await applySchema(client)
      await seed(client)
    } finally {
      client.release()
    }
    try {
      await this.objects.ensureBucket()
    } catch {
      // object store unreachable at boot: the server still starts
    }
    this.alertTimer = setInterval(() => void this.flushAlerts(), 30000)
    const server = http.createServer((req, res) => {
      void this.handle(req, res).catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'internal_error' }))
        } else {
          res.end()
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(this.cfg.port, '0.0.0.0', resolve))
  }

  async stop(): Promise<void> {
    if (this.alertTimer) clearInterval(this.alertTimer)
    await this.store.close()
  }

  private async waitForPostgres(): Promise<import('pg').PoolClient> {
    const deadline = Date.now() + 60000
    for (;;) {
      try {
        const client = await this.store.client()
        await client.query('SELECT 1')
        return client
      } catch {
        if (Date.now() > deadline) throw new Error('postgres unreachable at boot')
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
  }

  private async flushAlerts(): Promise<void> {
    for (;;) {
      const claimed = await this.store.claimAlert(this.instanceId)
      if (!claimed) return
      try {
        await this.sendAlert(claimed.figure_id, claimed.moved, claimed.reversed_tco2e)
        await this.store.markAlertSent(claimed.id)
      } catch {
        await this.store.releaseAlertClaim(claimed.id)
        return
      }
    }
  }

  private async sendAlert(figureId: string, moved: number, reversed: string): Promise<void> {
    const fig = await this.store.figureById(figureId)
    if (!fig) return
    const project = await this.store.projectBySlug(fig.project)
    if (!project) return
    const lead = await this.store.personById(project.lead_person_id)
    const sealer = await this.store.personById(fig.sealed_by)
    const to = [...new Set([lead!.email, sealer!.email])]
    await this.mailer.send({
      to,
      subject: `Seal broken on ${figureId} (readings moved: ${moved})`,
      bodyLines: [
        `Figure: ${figureId}`,
        `Readings moved: ${moved}`,
        `Reversed: ${reversed} tCO2e`,
        `Audit trail: ${this.cfg.appPublicUrl}/projects/${project.slug}/figures/${figureId}/audit`,
      ],
    })
  }

  /** Announce a break immediately after an ingest that committed one. */
  async notifyBreaks(broken: string[]): Promise<void> {
    if (broken.length === 0) return
    void this.flushAlerts()
  }

  // ---- request handling ----

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local')
    const path = url.pathname

    if (path.startsWith('/api/')) {
      await this.handleApi(req, res, path, url.searchParams)
      return
    }
    this.serveStatic(req, res, path)
  }

  private serveStatic(req: IncomingMessage, res: ServerResponse, path: string): void {
    const safe = path === '/' ? '/index.html' : path
    const file = `${this.distDir}/public${safe}`
    if (!file.startsWith(`${this.distDir}/public/`) || safe.includes('..') || !existsSync(file) || !statSync(file).isFile()) {
      const shell = `${this.distDir}/public/index.html`
      if (existsSync(shell)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        createReadStream(shell).pipe(res)
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not built')
      }
      return
    }
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
      '.json': 'application/json',
    }
    const ext = file.slice(file.lastIndexOf('.'))
    res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  }

  private readBody(req: IncomingMessage, limit: number): Promise<Buffer<ArrayBufferLike>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      let overflowed = false
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > limit) {
          // keep draining but remember the refusal
          overflowed = true
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (overflowed) reject(new ApiError(413, 'payload_too_large'))
        else resolve(Buffer.concat(chunks))
      })
      req.on('error', () => reject(new ApiError(400, 'bad_request')))
    })
  }

  private async handleApi(
    req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams,
  ): Promise<void> {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
      if (res.writableEnded) return
      const payload = typeof body === 'string' ? body : JSON.stringify(body)
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
      res.end(payload)
    }

    try {
      // transport errors first: media type, body limit, JSON parse
      let rawBody: Buffer<ArrayBufferLike> = Buffer.alloc(0)
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
        const contentType = req.headers['content-type']
        const hasBody = (req.headers['content-length'] ?? '') !== '0'
        if (hasBody && contentType === undefined) {
          throw unsupportedMediaType()
        }
        if (hasBody && contentType !== undefined) {
          const mediaType = contentType.split(';')[0]!.trim().toLowerCase()
          if (mediaType !== 'application/json') throw unsupportedMediaType()
        }
        const limit = path.includes('/readings') ? BODY_LIMIT_INGEST : BODY_LIMIT_DEFAULT
        rawBody = await this.readBody(req, limit)
        if (rawBody.length > 0 && rawBody.length <= limit) {
          // JSON parse check
          let parsed: unknown
          try {
            parsed = JSON.parse(rawBody.toString('utf8'))
          } catch {
            throw invalidJson()
          }

        }
      }

      // cross-site refusal before authentication
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin
        if (origin !== undefined) {
          let originHost: string | null = null
          try {
            originHost = new URL(origin).host
          } catch {
            originHost = null
          }
          if (originHost !== null && originHost !== req.headers.host) {
            throw crossOrigin()
          }
        }
        const site = req.headers['sec-fetch-site']
        if (site === 'cross-site') throw crossOrigin()
      }

      const cookies = parseCookies(req.headers.cookie ?? '')
      const sessionToken = cookies['fluxseal_session'] ?? null
      const person = sessionToken ? await this.store.personBySession(sessionToken) : null

      const ctx: Ctx = {
        req, res, params: {}, query, body: rawBody.length > 0
          ? JSON.parse(rawBody.toString('utf8')) as Body
          : {},
        rawBody, person,
      }

      const result = await this.route(ctx, path)
      if (result && typeof result === 'object' && '__sent' in result) {
        const r = result as Sent
        send(r.status, r.body, r.headers ?? {})
      } else {
        send(200, result)
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const extra = { ...err.extra }
        const body = Object.keys(extra).length > 0
          ? { error: err.code, ...extra }
          : { error: err.code }
        send(err.status, body)
      } else {
        console.error('internal error', err)
        send(500, { error: 'internal_error' })
      }
    }
  }

  private async route(ctx: Ctx, path: string): Promise<unknown> {
    const { req, person } = ctx
    const method = req.method ?? 'GET'

    // health
    if (path === '/api/health' && method === 'GET') {
      return sent(200, { status: 'ok' })
    }

    // session
    if (path === '/api/session' && method === 'POST') {
      const email = typeof ctx.body.email === 'string' ? ctx.body.email : ''
      const password = typeof ctx.body.password === 'string' ? ctx.body.password : ''
      const found = await this.store.personByEmail(email)
      if (!found || !compareSync(password, found.password_hash)) {
        throw unauthenticated()
      }
      const token = await this.store.createSession(found.id, this.cfg.sessionTtlSeconds)
      ctx.res.setHeader('Set-Cookie', `fluxseal_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${this.cfg.sessionTtlSeconds}`)
      return sent(200, { person: publicPerson(found) })
    }
    if (path === '/api/session' && method === 'DELETE') {
      const cookies = parseCookies(req.headers.cookie ?? '')
      const token = cookies['fluxseal_session']
      if (token) await this.store.deleteSession(token)
      ctx.res.setHeader('Set-Cookie', 'fluxseal_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
      return sent(204, '')
    }
    if (path === '/api/me' && method === 'GET') {
      const p = requirePerson(person)
      return { person: publicPerson(p) }
    }

    // projects
    let m: RegExpMatchArray | null
    if (path === '/api/projects' && method === 'GET') {
      const p = requirePerson(person)
      const all = await this.store.visibleProjects()
      const visible: ProjectRow[] = []
      for (const proj of all) {
        const role = await this.effectiveRole(p, proj.slug)
        if (role) visible.push(proj)
      }
      const out = []
      for (const proj of visible) {
        const role = (await this.effectiveRole(p, proj.slug))!
        const summary = await this.store.summaryForProject(proj.slug)
        out.push({
          slug: proj.slug, name: proj.name, kind: proj.kind,
          floor_pct: proj.floor_pct, buffer_pct: proj.buffer_pct,
          role, summary,
        })
      }
      return { projects: out }
    }

    if ((m = path.match(/^\/api\/projects\/([^/]+)$/)) && method === 'GET') {
      const p = requirePerson(person)
      const proj = await this.visibleProject(p, m[1]!)
      const role = (await this.effectiveRole(p, proj.slug))!
      const summary = await this.store.summaryForProject(proj.slug)
      return {
        slug: proj.slug, name: proj.name, kind: proj.kind, code: proj.code,
        floor_pct: proj.floor_pct, buffer_pct: proj.buffer_pct,
        lead_person_id: proj.lead_person_id,
        boundary: proj.boundary, boundary_area_m2: proj.boundary_area_m2,
        sensors: proj.sensors.map((s) => ({ id: s.id, kind: s.kind, polygon: s.polygon })),
        record_start: proj.record_start, record_end: proj.record_end,
        role, summary,
      }
    }

    if ((m = path.match(/^\/api\/projects\/([^/]+)\/timeline$/)) && method === 'GET') {
      const p = requirePerson(person)
      const proj = await this.visibleProject(p, m[1]!)
      const v = new Validator()
      const from = ctx.query.get('from')
      const to = ctx.query.get('to')
      if (from !== null && !isUtcDate(from)) v.add('from', 'must be a UTC date')
      if (to !== null && !isUtcDate(to)) v.add('to', 'must be a UTC date')
      v.throwIfInvalid()
      const days = await this.timelineDays(proj, from, to)
      return { days }
    }

    if ((m = path.match(/^\/api\/projects\/([^/]+)\/preview$/)) && method === 'POST') {
      const p = requirePerson(person)
      const proj = await this.visibleProject(p, m[1]!)
      const role = await this.effectiveRole(p, proj.slug)
      if (role === 'viewer') throw forbidden()
      const { start, end, sensorIds } = validateInterval(ctx.body, proj)
      const { derivation } = await this.store.deriveFor(proj, start, end, sensorIds)
      const blocked = await this.blockedReason(proj, derivation, role)
      return {
        ...derivation,
        sealable: blocked.reason === null,
        blocked_reason: blocked.reason,
        blocking_figure_id: blocked.figureId,
      }
    }

    if ((m = path.match(/^\/api\/projects\/([^/]+)\/figures$/)) && method === 'GET') {
      const p = requirePerson(person)
      const proj = await this.visibleProject(p, m[1]!)
      const figures = await this.store.figuresForProject(proj.slug)
      const summary = await this.store.summaryForProject(proj.slug)
      return { figures: figures.map((f) => this.figureBody(f)), summary }
    }

    if ((m = path.match(/^\/api\/projects\/([^/]+)\/figures$/)) && method === 'POST') {
      const p = requirePerson(person)
      const proj = await this.visibleProject(p, m[1]!)
      const role = await this.effectiveRole(p, proj.slug)
      if (role !== 'sealer') throw forbidden()
      const keyHeader = req.headers['idempotency-key']
      const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader
      const v = new Validator()
      if (typeof key !== 'string' || key.length < 1 || key.length > 100 || !/^[\x20-\x7E]+$/.test(key)) {
        v.add('Idempotency-Key', 'must be 1 to 100 visible ASCII characters')
      }
      if (typeof ctx.body.preview_fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(ctx.body.preview_fingerprint)) {
        v.add('preview_fingerprint', 'must be a fingerprint')
      }
      const interval = ctx.body as Body
      let start = '', end = '', sensorIds: string[] = []
      try {
        ;({ start, end, sensorIds } = validateInterval(interval, proj))
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          const errors = (err.extra as { errors: Record<string, string> }).errors
          for (const [k, msg] of Object.entries(errors)) v.add(k, msg)
        } else throw err
      }
      v.throwIfInvalid()

      const request = { start, end, sensor_ids: [...sensorIds].sort(), preview_fingerprint: ctx.body.preview_fingerprint }

      // one-at-a-time per (person, key), across instances
      const client = await this.store.client()
      try {
        await client.query('BEGIN')
        const h = createHash('sha256').update(`fluxseal-idem:${p.id}:${key}`).digest()
        await client.query('SELECT pg_advisory_xact_lock($1)', [(h.readBigUInt64BE(0) & 0x7fffffffffffffffn).toString()])

        const replay = await this.store.idempotentReplay(p.id, key!)
        if (replay) {
          const stored = replay.request as {
            start?: unknown; end?: unknown
            sensor_ids?: unknown; preview_fingerprint?: unknown
          } | null
          const same = stored !== null
          const storedSensors = stored?.sensor_ids as unknown[] | undefined
          const sameReq = same &&
            stored!.start === request.start &&
            stored!.end === request.end &&
            Array.isArray(storedSensors) &&
            storedSensors.length === request.sensor_ids.length &&
            request.sensor_ids.every((s2, i) => storedSensors[i] === s2) &&
            stored!.preview_fingerprint === request.preview_fingerprint
          if (sameReq) {
            const bodyStr = typeof replay.body === 'string' ? replay.body : JSON.stringify(replay.body)
            return sent(replay.status, bodyStr, { 'Idempotent-Replay': 'true' })
          }
          throw new ApiError(409, 'idempotency_key_conflict')
        }

        const result = await this.seals.seal(proj, p.id, {
          start, end, sensor_ids: sensorIds, preview_fingerprint: ctx.body.preview_fingerprint as string,
        }, (fig) => this.figureBody(fig))
        await this.store.storeIdempotentClient(client, p.id, key!, proj.slug, request, result.status, result.body, this.cfg.idempotencyTtlSeconds)
        await client.query('COMMIT')
        return sent(result.status, result.body)
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw err
      } finally {
        client.release()
      }
    }

    if ((m = path.match(/^\/api\/projects\/([^/]+)\/ledger$/)) && method === 'GET') {
      const p = requirePerson(person)
      const proj = await this.visibleProject(p, m[1]!)
      const entries = await this.store.ledgerForProject(proj.slug)
      const summary = await this.store.summaryForProject(proj.slug)
      return {
        entries: entries.map((e) => ({
          id: e.id, figure_id: e.figure_id, kind: e.kind, tco2e: e.tco2e,
          reverses: e.reverses, recorded_at: e.recorded_at,
        })),
        balance_tco2e: summary.sealed_net_tco2e,
        buffer_tco2e: summary.buffer_tco2e,
      }
    }

    if ((m = path.match(/^\/api\/projects\/([^/]+)\/readings$/)) && method === 'POST') {
      const p = requirePerson(person)
      const proj = await this.store.projectBySlug(m[1]!)
      if (!proj) throw notFound()
      if (p.org_role !== 'steward') {
        const role = await this.effectiveRole(p, proj.slug)
        if (!role) throw notFound()
        throw forbidden()
      }
      const readings = validateIngest(ctx.body, proj)
      const result = await this.seals.ingest(proj, readings)
      await this.notifyBreaks(result.broken_figures)
      return result
    }

    if (path === '/api/access' && method === 'GET') {
      const p = requirePerson(person)
      if (p.org_role !== 'admin') throw forbidden()
      const people = await this.store.allPeople()
      const projects = await this.store.visibleProjects()
      const grants = await this.store.allGrants()
      return {
        people: people.map(publicPerson),
        projects: projects.map((pr) => ({ slug: pr.slug, name: pr.name })),
        grants,
      }
    }

    if ((m = path.match(/^\/api\/projects\/([^/]+)\/grants\/([^/]+)$/))) {
      const p = requirePerson(person)
      if (p.org_role !== 'admin') throw forbidden()
      const proj = await this.store.projectBySlug(m[1]!)
      if (!proj) throw notFound()
      const target = await this.store.personById(m[2]!)
      if (!target) throw notFound()
      if (method === 'PUT') {
        const role = ctx.body.role
        if (role !== 'viewer' && role !== 'analyst' && role !== 'sealer') {
          throw validation({ role: 'must be viewer, analyst or sealer' })
        }
        await this.store.setGrant(target.id, proj.slug, role)
        return { person_id: target.id, project: proj.slug, role }
      }
      if (method === 'DELETE') {
        await this.store.removeGrant(target.id, proj.slug)
        return sent(204, '')
      }
    }

    // figures
    if ((m = path.match(/^\/api\/figures\/([^/]+)$/)) && method === 'GET') {
      const p = requirePerson(person)
      const fig = await this.store.figureById(m[1]!)
      if (!fig) throw notFound()
      const proj = await this.store.projectBySlug(fig.project)
      if (!proj || !(await this.effectiveRole(p, proj.slug))) throw notFound()
      const checked = await this.rederiveFigure(fig)
      return {
        ...this.figureBody(checked.fig),
        checked_at: checked.checkedAt,
        rederived: checked.rederived,
      }
    }

    if ((m = path.match(/^\/api\/figures\/([^/]+)\/audit$/)) && method === 'GET') {
      const p = requirePerson(person)
      const fig = await this.store.figureById(m[1]!)
      if (!fig) throw notFound()
      const proj = await this.store.projectBySlug(fig.project)
      if (!proj || !(await this.effectiveRole(p, proj.slug))) throw notFound()
      return this.auditBody(fig)
    }

    if ((m = path.match(/^\/api\/figures\/([^/]+)\/links$/)) && method === 'POST') {
      const p = requirePerson(person)
      const fig = await this.store.figureById(m[1]!)
      if (!fig) throw notFound()
      const proj = await this.store.projectBySlug(fig.project)
      if (!proj || !(await this.effectiveRole(p, proj.slug))) throw notFound()
      if ((await this.effectiveRole(p, proj.slug)) !== 'sealer') throw forbidden()
      if (fig.status !== 'sealed') throw new ApiError(409, 'figure_not_sealed')
      const now = new Date()
      const issuedAt = new Date(Math.floor(now.getTime() / 1000) * 1000)
      const expiresAt = new Date((issuedAt.getTime() / 1000 + this.cfg.linkTtlSeconds) * 1000)
      const token = newToken()
      const link = { id: newId('link'), figure_id: fig.id, token, issued_at: issuedAt, expires_at: expiresAt }
      const client = await this.store.client()
      try {
        await this.store.insertLink(client, link)
      } finally {
        client.release()
      }
      ctx.res.setHeader('Date', utcHttpDate(issuedAt))
      return sent(201, {
        id: link.id, token, url: `${this.cfg.appPublicUrl}/r/${token}`,
        status: 'live',
        issued_at: apiTimestampTrunc(issuedAt),
        expires_at: apiTimestampTrunc(expiresAt),
      })
    }

    if ((m = path.match(/^\/api\/figures\/([^/]+)\/links$/)) && method === 'GET') {
      const p = requirePerson(person)
      const fig = await this.store.figureById(m[1]!)
      if (!fig) throw notFound()
      const proj = await this.store.projectBySlug(fig.project)
      if (!proj || !(await this.effectiveRole(p, proj.slug))) throw notFound()
      if ((await this.effectiveRole(p, proj.slug)) !== 'sealer') throw forbidden()
      const links = await this.store.linksForFigure(fig.id)
      const clock = new Date()
      const out = links.map((l) => ({
        id: l.id,
        token: l.token,
        url: `${this.cfg.appPublicUrl}/r/${l.token}`,
        status: linkStatus(l, clock),
        issued_at: apiTimestampTrunc(l.issued_at),
        expires_at: apiTimestampTrunc(l.expires_at),
        revoked_at: l.revoked_at ? apiTimestampTrunc(l.revoked_at) : null,
      }))
      ctx.res.setHeader('Date', utcHttpDate(clock))
      return { links: out }
    }

    if ((m = path.match(/^\/api\/figures\/([^/]+)\/links\/([^/]+)\/revoke$/)) && method === 'POST') {
      const p = requirePerson(person)
      const fig = await this.store.figureById(m[1]!)
      if (!fig) throw notFound()
      const proj = await this.store.projectBySlug(fig.project)
      if (!proj || !(await this.effectiveRole(p, proj.slug))) throw notFound()
      if ((await this.effectiveRole(p, proj.slug)) !== 'sealer') throw forbidden()
      const links = await this.store.linksForFigure(fig.id)
      const linkId = m[2]!
      const link = links.find((l) => l.id === linkId)
      if (!link) throw notFound()
      const clock = new Date()
      if (clock.getTime() >= link.expires_at.getTime()) {
        ctx.res.setHeader('Date', utcHttpDate(clock))
        throw new ApiError(409, 'link_expired')
      }
      if (link.revoked_at) {
        ctx.res.setHeader('Date', utcHttpDate(clock))
        throw new ApiError(409, 'link_revoked')
      }
      const now = new Date()
      const client = await this.store.client()
      try {
        await this.store.revokeLink(client, link.id, now)
      } finally {
        client.release()
      }
      ctx.res.setHeader('Date', utcHttpDate(now))
      return {
        id: link.id, status: 'revoked', revoked_at: apiTimestampTrunc(now),
      }
    }

    // public link surfaces
    if ((m = path.match(/^\/api\/public\/links\/([^/]+)$/)) && method === 'GET') {
      return this.publicRead(ctx, m[1]!, { rederive: false })
    }
    if ((m = path.match(/^\/api\/public\/links\/([^/]+)\/rederive$/)) && method === 'POST') {
      return this.publicRead(ctx, m[1]!, { rederive: true })
    }
    if ((m = path.match(/^\/api\/public\/links\/([^/]+)\/audit$/)) && method === 'GET') {
      const link = await this.store.linkByToken(m[1]!)
      const clock = new Date()
      ctx.res.setHeader('Date', utcHttpDate(clock))
      if (!link) throw notFound()
      const status = linkStatus(link, clock)
      if (status === 'expired') {
        throw new ApiError(410, 'link_expired', { expires_at: apiTimestampTrunc(link.expires_at) })
      }
      if (status === 'revoked') {
        throw new ApiError(410, 'link_revoked', { revoked_at: apiTimestampTrunc(link.revoked_at!) })
      }
      const fig = await this.store.figureById(link.figure_id)
      if (!fig) throw notFound()
      return this.auditBody(fig)
    }
    if ((m = path.match(/^\/api\/public\/links\/([^/]+)\/evidence$/)) && method === 'GET') {
      const link = await this.store.linkByToken(m[1]!)
      const clock = new Date()
      ctx.res.setHeader('Date', utcHttpDate(clock))
      if (!link) throw notFound()
      const status = linkStatus(link, clock)
      if (status === 'expired') {
        throw new ApiError(410, 'link_expired', { expires_at: apiTimestampTrunc(link.expires_at) })
      }
      if (status === 'revoked') {
        throw new ApiError(410, 'link_revoked', { revoked_at: apiTimestampTrunc(link.revoked_at!) })
      }
      const fig = await this.store.figureById(link.figure_id)
      if (!fig) throw notFound()
      let bytes: Buffer
      try {
        bytes = await this.objects.getReadings(fig.id)
      } catch {
        throw dependency('storage_unavailable')
      }
      const sha = createHash('sha256').update(bytes).digest('hex')
      if (sha !== fig.fingerprint) {
        throw new ApiError(409, 'evidence_mismatch')
      }
      const { res } = ctx
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${fig.id}-readings.csv"`,
        'X-Fluxseal-Fingerprint': fig.fingerprint,
        'Content-Length': String(bytes.length),
      })
      res.end(bytes)
      return { status: 200, body: '', headers: {} }
    }

    throw notFound()
  }

  private async publicRead(ctx: Ctx, token: string, opts: { rederive: boolean }): Promise<unknown> {
    const link = await this.store.linkByToken(token)
    const clock = new Date()
    ctx.res.setHeader('Date', utcHttpDate(clock))
    if (!link) throw notFound()
    const status = linkStatus(link, clock)
    if (status === 'expired') {
      throw new ApiError(410, 'link_expired', { expires_at: apiTimestampTrunc(link.expires_at) })
    }
    if (status === 'revoked') {
      throw new ApiError(410, 'link_revoked', { revoked_at: apiTimestampTrunc(link.revoked_at!) })
    }
    const fig = await this.store.figureById(link.figure_id)
    if (!fig) throw notFound()
    const proj = await this.store.projectBySlug(fig.project)
    if (!proj) throw notFound()
    const checked = await this.rederiveFigure(fig, opts.rederive ? new Date() : undefined)
    return {
      link: { status: 'live', expires_at: apiTimestampTrunc(link.expires_at) },
      project: { name: proj.name, kind: proj.kind },
      figure: { ...this.figureBody(checked.fig), checked_at: checked.checkedAt, rederived: checked.rederived },
    }
  }

  // ---- helpers ----

  private async effectiveRole(p: PersonRow, slug: string): Promise<'viewer' | 'analyst' | 'sealer' | null> {
    const grant = await this.store.grantFor(p.id, slug)
    if (p.org_role === 'admin') return grant ?? 'viewer'
    return grant
  }

  private async visibleProject(p: PersonRow, slug: string): Promise<ProjectRow> {
    const proj = await this.store.projectBySlug(slug)
    if (!proj) throw notFound()
    if (p.org_role === 'steward') {
      // stewards can ingest everywhere; for other surfaces they need a grant
      const grant = await this.store.grantFor(p.id, slug)
      if (grant) return proj
      throw notFound()
    }
    const role = await this.effectiveRole(p, slug)
    if (!role) throw notFound()
    return proj
  }

  private figureBody(fig: FigureRow): Record<string, unknown> {
    return {
      id: fig.id, project: fig.project, start: fig.start, end: fig.end,
      sensor_ids: fig.sensor_ids, status: fig.status,
      supersedes: fig.supersedes, superseded_by: fig.superseded_by,
      coverage_pct: fig.coverage_pct, floor_pct: fig.floor_pct,
      net_tco2e: fig.net_tco2e, co2_tco2e: fig.co2_tco2e, ch4_tco2e: fig.ch4_tco2e,
      buffer_pct: fig.buffer_pct, buffer_tco2e: fig.buffer_tco2e, credited_tco2e: fig.credited_tco2e,
      readings_count: fig.readings_count, fingerprint: fig.fingerprint,
      sealed_at: fig.sealed_at, sealed_by: fig.sealed_by,
      checked_at: fig.checked_at,
      contributions: fig.contributions,
      evidence: {
        readings_key: `figures/${fig.id}/readings.csv`,
        derivation_key: `figures/${fig.id}/derivation.json`,
      },
    }
  }

  private async rederiveFigure(fig: FigureRow, when?: Date): Promise<{
    fig: FigureRow; checkedAt: string; rederived: { fingerprint: string; coverage_pct: string; net_tco2e: string; matches: boolean }
  }> {
    const proj = await this.store.projectBySlug(fig.project)
    const now = when ?? new Date()
    const { derivation } = await this.store.deriveFor(proj!, fig.start, fig.end, fig.sensor_ids)
    const checkedAt = apiTimestampTrunc(now)
    const client = await this.store.client()
    try {
      await this.store.touchCheckedAt(client, fig.id, now)
    } finally {
      client.release()
    }
    return {
      fig: { ...fig, checked_at: checkedAt },
      checkedAt,
      rederived: {
        fingerprint: derivation.fingerprint,
        coverage_pct: derivation.coverage_pct,
        net_tco2e: derivation.net_tco2e,
        matches: derivation.fingerprint === fig.fingerprint,
      },
    }
  }

  private async auditBody(fig: FigureRow): Promise<unknown> {
    const proj = await this.store.projectBySlug(fig.project)
    const res = await this.store.client()
    let rows: {
      sensor_id: string; interval_start: string
      old_fc: string | null; old_fch4: string | null; old_qc: number | null
      new_fc: string; new_fch4: string; new_qc: number
      revised_at: Date; batch_id: string
    }[]
    try {
      const q = await res.query(
        `SELECT r.sensor_id, r.interval_start,
          r.old_fc, r.old_fch4, r.old_qc, r.new_fc, r.new_fch4, r.new_qc, r.revised_at, r.batch_id
         FROM revisions r
         WHERE r.project = $1 AND r.interval_start >= $2 AND r.interval_start < $3
           AND r.sensor_id = ANY($4) AND r.revised_at >= $5
         ORDER BY r.revised_at, r.sensor_id, r.interval_start`,
        [fig.project, fig.start, fig.end, fig.sensor_ids, new Date(fig.sealed_at)])
      rows = q.rows
    } finally {
      res.release()
    }
    return {
      figure_id: fig.id,
      moved: rows.map((r) => ({
        sensor_id: r.sensor_id,
        interval_start: r.interval_start,
        old: r.old_fc === null ? null : {
          fc: new Decimal(r.old_fc).toFixed(4),
          fch4: new Decimal(r.old_fch4!).toFixed(4),
          qc: r.old_qc,
        },
        new: {
          fc: new Decimal(r.new_fc).toFixed(4),
          fch4: new Decimal(r.new_fch4).toFixed(4),
          qc: r.new_qc,
        },
        revised_at: apiTimestampTrunc(r.revised_at),
        batch_id: r.batch_id,
      })),
    }
  }

  private async timelineDays(proj: ProjectRow, from: string | null, to: string | null): Promise<{ date: string; net_tco2e: string; coverage_pct: string }[]> {
    if (!proj.record_start || !proj.record_end) return []
    const sensorIds = proj.sensors.map((s) => s.id)
    // determine day range: days with readings
    const res = await this.store.client()
    let rows: { day: string }[]
    try {
      const q = await res.query<{ day: string }>(
        `SELECT DISTINCT substr(interval_start, 1, 10) AS day FROM readings
         WHERE project = $1 ORDER BY day`, [proj.slug])
      rows = q.rows
    } finally {
      res.release()
    }
    const days: { date: string; net_tco2e: string; coverage_pct: string }[] = []
    for (const { day } of rows) {
      if (from && day < from) continue
      if (to && day > to) continue
      const start = `${day}T00:00:00Z`
      const end = apiTimestampTrunc(new Date(new Date(start).getTime() + 86400000))
      const { derivation } = await this.store.deriveFor(proj, start, end, sensorIds)
      days.push({ date: day, net_tco2e: derivation.net_tco2e, coverage_pct: derivation.coverage_pct })
    }
    return days
  }

  private async blockedReason(
    proj: ProjectRow, derivation: { start: string; end: string; coverage_pct: string }, role: string | null,
  ): Promise<{ reason: 'below_coverage_floor' | 'overlaps_sealed' | 'already_sealed' | 'role' | null; figureId: string | null }> {
    if (new Decimal(derivation.coverage_pct).lessThan(new Decimal(proj.floor_pct))) {
      return { reason: 'below_coverage_floor', figureId: null }
    }
    const client = await this.store.client()
    try {
      const overlaps = await client.query<{ id: string; same: boolean }>(
        `SELECT id, (start_ts = $2 AND end_ts = $3) AS same FROM figures
         WHERE project = $1 AND status = 'sealed' AND start_ts < $3 AND end_ts > $2`,
        [proj.slug, derivation.start, derivation.end])
      if (overlaps.rows.length > 0) {
        const same = overlaps.rows.find((r) => r.same)
        if (same) return { reason: 'already_sealed', figureId: same.id }
        return { reason: 'overlaps_sealed', figureId: overlaps.rows[0]!.id }
      }
    } finally {
      client.release()
    }
    if (role !== 'sealer') return { reason: 'role', figureId: null }
    return { reason: null, figureId: null }
  }
}

export function publicPerson(p: PersonRow): { id: string; name: string; email: string; org_role: string } {
  return { id: p.id, name: p.name, email: p.email, org_role: p.org_role }
}

function requirePerson(p: PersonRow | null): PersonRow {
  if (!p) throw unauthenticated()
  return p
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
  }
  return out
}

function utcHttpDate(d: Date): string {
  return d.toUTCString()
}

function linkStatus(link: { expires_at: Date; revoked_at: Date | null }, now: Date): 'live' | 'expired' | 'revoked' {
  if (link.revoked_at) return 'revoked'
  if (now.getTime() >= link.expires_at.getTime()) return 'expired'
  return 'live'
}

function validateInterval(body: Body, proj: ProjectRow): { start: string; end: string; sensorIds: string[] } {
  const v = new Validator()
  const start = body.start
  const end = body.end
  if (typeof start !== 'string' || !isApiTimestamp(start) || !isHalfHourTs(start)) {
    v.add('start', 'must be a half-hour UTC timestamp')
  } else if (proj.record_start && start < proj.record_start) {
    v.add('start', 'is before the record')
  }
  if (typeof end !== 'string' || !isApiTimestamp(end) || !isHalfHourTs(end)) {
    v.add('end', 'must be a half-hour UTC timestamp')
  } else if (proj.record_end && end > proj.record_end) {
    v.add('end', 'is after the record')
  }
  if (typeof start === 'string' && typeof end === 'string' &&
    isApiTimestamp(start) && isApiTimestamp(end) && start >= end) {
    v.add('start', 'must be earlier than end')
  }
  const sensorIds = body.sensor_ids
  const known = new Set(proj.sensors.map((s) => s.id))
  if (!Array.isArray(sensorIds) || sensorIds.length === 0 ||
      sensorIds.some((s) => typeof s !== 'string' || !known.has(s)) ||
      new Set(sensorIds as string[]).size !== (sensorIds as string[]).length) {
    v.add('sensor_ids', 'must be distinct sensor ids of this project')
  }
  v.throwIfInvalid()
  return {
    start: start as string, end: end as string,
    sensorIds: (sensorIds as string[]).slice().sort(),
  }
}

function validateIngest(body: Body, proj: ProjectRow): {
  sensor_id: string; interval_start: string; fc: string; fch4: string; qc: number
}[] {
  const v = new Validator()
  const readings = body.readings
  if (!Array.isArray(readings) || readings.length < 1 || readings.length > 5000) {
    v.add('readings', 'must hold 1 to 5000 entries')
    v.throwIfInvalid()
    return []
  }
  const known = new Set(proj.sensors.map((s) => s.id))
  const seen = new Set<string>()
  const out: { sensor_id: string; interval_start: string; fc: string; fch4: string; qc: number }[] = []
  readings.forEach((r, i) => {
    const prefix = `readings[${i}]`
    const o = (r ?? {}) as Record<string, unknown>
    let ok = true
    if (typeof o.sensor_id !== 'string' || !known.has(o.sensor_id)) {
      v.add(`${prefix}.sensor_id`, 'must be a sensor of this project')
      ok = false
    }
    if (typeof o.interval_start !== 'string' || !isHalfHourTs(o.interval_start)) {
      v.add(`${prefix}.interval_start`, 'must be an exact half-hour')
      ok = false
    }
    const fc = o.fc
    if (typeof fc !== 'number' || !Number.isFinite(fc) || fc < -100 || fc > 100 ||
        !Number.isInteger(Math.round(fc * 10000)) || Math.abs(fc * 10000 - Math.round(fc * 10000)) > 1e-6) {
      v.add(`${prefix}.fc`, 'must be a number from -100 to 100 with at most four decimals')
      ok = false
    }
    const fch4 = o.fch4
    if (typeof fch4 !== 'number' || !Number.isFinite(fch4) || fch4 < -1000 || fch4 > 5000 ||
        Math.abs(fch4 * 10000 - Math.round(fch4 * 10000)) > 1e-6) {
      v.add(`${prefix}.fch4`, 'must be a number from -1000 to 5000 with at most four decimals')
      ok = false
    }
    const qc: unknown = o.qc
    if (typeof qc !== 'number' || !Number.isInteger(qc) || qc < 0 || qc > 3) {
      v.add(`${prefix}.qc`, 'must be 0, 1, 2 or 3')
      ok = false
    }
    if (ok) {
      const key = `${o.sensor_id}|${o.interval_start}`
      if (seen.has(key)) {
        v.add(prefix, 'repeats a sensor and interval')
      } else {
        seen.add(key)
        out.push({
          sensor_id: o.sensor_id as string,
          interval_start: o.interval_start as string,
          fc: (fc as number).toFixed(4),
          fch4: (fch4 as number).toFixed(4),
          qc: qc as number,
        })
      }
    }
  })
  v.throwIfInvalid()
  return out
}
