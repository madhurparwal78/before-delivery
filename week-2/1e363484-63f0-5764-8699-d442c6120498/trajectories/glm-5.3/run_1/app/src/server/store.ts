import pg, { type Pool, type PoolClient } from 'pg'
import { derive, type Contribution, type DeriveProject, type ReadingRow, type SensorDef } from '../domain/derive.js'
import type { Polygon } from '../domain/geometry.js'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { apiTimestampTrunc, halfHourIndex } from '../domain/time.js'
import { Decimal } from 'decimal.js'

export type ProjectRow = {
  slug: string; name: string; kind: string; code: string
  floor_pct: string; buffer_pct: string; lead_person_id: string
  boundary: Polygon; boundary_area_m2: number
  sensors: SensorDef[]
  record_start: string | null
  record_end: string | null
}

export type PersonRow = { id: string; name: string; email: string; org_role: 'admin' | 'steward' | 'member' }

export type FigureRow = {
  id: string; project: string; start: string; end: string
  sensor_ids: string[]; status: 'sealed' | 'broken' | 'superseded'
  supersedes: string | null; superseded_by: string | null
  coverage_pct: string; floor_pct: string
  net_tco2e: string; co2_tco2e: string; ch4_tco2e: string
  buffer_pct: string; buffer_tco2e: string; credited_tco2e: string
  readings_count: number; fingerprint: string
  contributions: Contribution[]
  sealed_at: string; sealed_by: string; checked_at: string
}

export type LedgerRow = {
  id: string; project: string; figure_id: string
  kind: 'issuance' | 'buffer' | 'reversal'
  tco2e: string; reverses: string | null; recorded_at: string
}

export type Summary = {
  sealed_net_tco2e: string; buffer_tco2e: string
  intact_count: number; broken_count: number; superseded_count: number
}

export class Store {
  private pool: Pool

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 10 })
  }

  async client(): Promise<PoolClient> {
    return this.pool.connect()
  }


  async close(): Promise<void> {
    await this.pool.end()
  }

  // ---- people, sessions, grants ----

  async personByEmail(email: string): Promise<(PersonRow & { password_hash: string }) | null> {
    const res = await this.pool.query(
      'SELECT id, name, email, password_hash, org_role FROM people WHERE email = $1', [email])
    return res.rows[0] ?? null
  }

  async personById(id: string): Promise<PersonRow | null> {
    const res = await this.pool.query(
      'SELECT id, name, email, org_role FROM people WHERE id = $1', [id])
    return res.rows[0] ?? null
  }

  async createSession(personId: string, ttlSeconds: number): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    await this.pool.query(
      'INSERT INTO sessions (token, person_id, expires_at) VALUES ($1,$2, now() + ($3 || \' seconds\')::interval)',
      [token, personId, String(ttlSeconds)])
    return token
  }

  async personBySession(token: string): Promise<PersonRow | null> {
    const res = await this.pool.query<PersonRow>(
      `SELECT p.id, p.name, p.email, p.org_role FROM sessions s
       JOIN people p ON p.id = s.person_id
       WHERE s.token = $1 AND s.expires_at > now()`, [token])
    return res.rows[0] ?? null
  }

  async deleteSession(token: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token = $1', [token])
  }

  async grantFor(personId: string, slug: string): Promise<'viewer' | 'analyst' | 'sealer' | null> {
    const res = await this.pool.query<{ role: string }>(
      'SELECT role FROM grants WHERE person_id = $1 AND project = $2', [personId, slug])
    return (res.rows[0]?.role as 'viewer' | 'analyst' | 'sealer' | undefined) ?? null
  }

  async allGrants(): Promise<{ person_id: string; project: string; role: string }[]> {
    const res = await this.pool.query(
      'SELECT person_id, project, role FROM grants ORDER BY person_id, project')
    return res.rows
  }

  async setGrant(personId: string, slug: string, role: 'viewer' | 'analyst' | 'sealer'): Promise<void> {
    await this.pool.query(
      `INSERT INTO grants (person_id, project, role) VALUES ($1,$2,$3)
       ON CONFLICT (person_id, project) DO UPDATE SET role = EXCLUDED.role`,
      [personId, slug, role])
  }

  async removeGrant(personId: string, slug: string): Promise<void> {
    await this.pool.query('DELETE FROM grants WHERE person_id = $1 AND project = $2', [personId, slug])
  }

  async allPeople(): Promise<PersonRow[]> {
    const res = await this.pool.query('SELECT id, name, email, org_role FROM people ORDER BY id')
    return res.rows
  }

  // ---- projects ----

  async projectBySlug(slug: string): Promise<ProjectRow | null> {
    const res = await this.pool.query(
      'SELECT slug, name, kind, code, floor_pct, buffer_pct, lead_person_id, boundary, boundary_area_m2 FROM projects WHERE slug = $1', [slug])
    const row = res.rows[0]
    if (!row) return null
    const sensors = await this.pool.query(
      'SELECT id, kind, polygon FROM sensors WHERE project = $1 ORDER BY id', [slug])
    const bounds = await this.pool.query<{ lo: string | null; hi: string | null }>(
      'SELECT min(interval_start) AS lo, max(interval_start) AS hi FROM readings WHERE project = $1', [slug])
    // record_end is the end of the last half-hour, i.e. last start + 30 minutes
    let recordEnd: string | null = null
    const hi = bounds.rows[0]!.hi
    if (hi) recordEnd = apiTimestampTrunc(new Date(new Date(hi).getTime() + 1800000))
    return {
      ...row,
      boundary: row.boundary as Polygon,
      sensors: sensors.rows.map((s) => ({ id: s.id, kind: s.kind, polygon: s.polygon as Polygon })),
      record_start: bounds.rows[0]!.lo,
      record_end: recordEnd,
    }
  }

  async visibleProjects(): Promise<ProjectRow[]> {
    const res = await this.pool.query('SELECT slug FROM projects ORDER BY slug')
    const out: ProjectRow[] = []
    for (const r of res.rows) {
      const p = await this.projectBySlug(r.slug)
      if (p) out.push(p)
    }
    return out
  }

  // ---- readings ----

  async readingsInRange(slug: string, start: string, end: string, sensorIds: string[], client?: PoolClient): Promise<ReadingRow[]> {
    const res = await (client ?? this.pool).query(
      `SELECT sensor_id, interval_start, fc, fch4, qc FROM readings
       WHERE project = $1 AND interval_start >= $2 AND interval_start < $3
         AND sensor_id = ANY($4)
       ORDER BY sensor_id, interval_start`,
      [slug, start, end, sensorIds])
    return res.rows.map((r) => ({
      sensor_id: r.sensor_id, interval_start: r.interval_start,
      fc: r.fc, fch4: r.fch4, qc: r.qc as number,
    }))
  }

  // ---- derivation ----

  deriveProject(p: ProjectRow): DeriveProject {
    return {
      boundary: p.boundary,
      boundary_area_m2: p.boundary_area_m2,
      floor_pct: p.floor_pct,
      buffer_pct: p.buffer_pct,
      sensors: p.sensors,
    }
  }

  async deriveFor(p: ProjectRow, start: string, end: string, sensorIds: string[], client?: PoolClient) {
    const readings = await this.readingsInRange(p.slug, start, end, sensorIds, client)
    return { derivation: derive(this.deriveProject(p), start, end, sensorIds, readings), readings }
  }

  // ---- figures ----

  async nextFigureId(client: PoolClient, project: ProjectRow): Promise<{ id: string; seq: number }> {
    const res = await client.query<{ next: number }>(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM figures WHERE project = $1', [project.slug])
    const seq = res.rows[0]!.next
    return { id: `${project.code}-F${String(seq).padStart(4, '0')}`, seq }
  }

  async insertFigure(client: PoolClient, fig: { id: string; seq: number } & FigureRow): Promise<void> {
    await client.query(
      `INSERT INTO figures (id, project, seq, start_ts, end_ts, sensor_ids, status, supersedes,
        coverage_pct, floor_pct, net_tco2e, co2_tco2e, ch4_tco2e, buffer_pct, buffer_tco2e,
        credited_tco2e, readings_count, fingerprint, contributions, sealed_at, sealed_by, checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,'sealed',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [fig.id, fig.project, fig.seq, fig.start, fig.end, JSON.stringify(fig.sensor_ids),
        fig.supersedes, fig.coverage_pct, fig.floor_pct, fig.net_tco2e, fig.co2_tco2e,
        fig.ch4_tco2e, fig.buffer_pct, fig.buffer_tco2e, fig.credited_tco2e,
        fig.readings_count, fig.fingerprint, JSON.stringify(fig.contributions),
        fig.sealed_at, fig.sealed_by, fig.checked_at])
  }

  async figureById(id: string): Promise<FigureRow | null> {
    const res = await this.pool.query(
      `SELECT id, project, start_ts AS start, end_ts AS end, sensor_ids, status,
        supersedes, superseded_by, coverage_pct, floor_pct, net_tco2e, co2_tco2e, ch4_tco2e,
        buffer_pct, buffer_tco2e, credited_tco2e, readings_count, fingerprint, contributions,
        sealed_at, sealed_by, checked_at
       FROM figures WHERE id = $1`, [id])
    const row = res.rows[0]
    if (!row) return null
    return {
      ...row,
      sensor_ids: row.sensor_ids as string[],
      contributions: row.contributions as Contribution[],
      sealed_at: apiTimestampTrunc(new Date(row.sealed_at)),
      checked_at: apiTimestampTrunc(new Date(row.checked_at)),
    }
  }

  async figuresForProject(slug: string): Promise<FigureRow[]> {
    const res = await this.pool.query(
      `SELECT id, project, start_ts AS start, end_ts AS end, sensor_ids, status,
        supersedes, superseded_by, coverage_pct, floor_pct, net_tco2e, co2_tco2e, ch4_tco2e,
        buffer_pct, buffer_tco2e, credited_tco2e, readings_count, fingerprint, contributions,
        sealed_at, sealed_by, checked_at
       FROM figures WHERE project = $1 ORDER BY sealed_at DESC, id DESC`, [slug])
    return res.rows.map((row) => ({
      ...row,
      sensor_ids: row.sensor_ids as string[],
      contributions: row.contributions as Contribution[],
      sealed_at: apiTimestampTrunc(new Date(row.sealed_at)),
      checked_at: apiTimestampTrunc(new Date(row.checked_at)),
    }))
  }

  async markBroken(client: PoolClient, figId: string, when: Date): Promise<void> {
    await client.query(`UPDATE figures SET status = 'broken' WHERE id = $1`, [figId])
  }

  async markSuperseded(client: PoolClient, figId: string, byId: string, when: Date): Promise<void> {
    await client.query(
      `UPDATE figures SET status = 'superseded', superseded_by = $2 WHERE id = $1`, [figId, byId])
  }

  async touchCheckedAt(client: PoolClient, figId: string, when: Date): Promise<void> {
    await client.query(`UPDATE figures SET checked_at = $2 WHERE id = $1`, [figId, when])
  }

  // ---- ledger ----

  async ledgerForProject(slug: string): Promise<LedgerRow[]> {
    const res = await this.pool.query(
      `SELECT id, project, figure_id, kind, tco2e, reverses, recorded_at
       FROM ledger WHERE project = $1 ORDER BY seq`, [slug])
    return res.rows.map((r) => ({
      ...r,
      recorded_at: apiTimestampTrunc(new Date(r.recorded_at)),
    }))
  }

  async insertLedgerEntry(client: PoolClient, entry: { id: string; project: string; figure_id: string; kind: 'issuance' | 'buffer' | 'reversal'; tco2e: string; reverses: string | null; recorded_at: Date }): Promise<void> {
    await client.query(
      `INSERT INTO ledger (id, project, figure_id, kind, tco2e, reverses, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entry.id, entry.project, entry.figure_id, entry.kind, entry.tco2e, entry.reverses, entry.recorded_at])
  }

  async summaryForProject(slug: string): Promise<Summary> {
    return this.summary(this.pool, slug)
  }

  async summary(client: PoolClient | Pool, slug: string): Promise<Summary> {
    const res = await client.query<{
      sealed_net: string | null; buffer_total: string | null
      intact: string; broken: string; superseded: string
    }>(
      `SELECT
        COALESCE(sum(credited_tco2e::numeric) FILTER (WHERE status = 'sealed'), 0)::text AS sealed_net,
        COALESCE(sum(buffer_tco2e::numeric) FILTER (WHERE status = 'sealed'), 0)::text AS buffer_total,
        count(*) FILTER (WHERE status = 'sealed') AS intact,
        count(*) FILTER (WHERE status = 'broken') AS broken,
        count(*) FILTER (WHERE status = 'superseded') AS superseded
       FROM figures WHERE project = $1`, [slug])
    const r = res.rows[0]!
    return {
      sealed_net_tco2e: new Decimal(r.sealed_net ?? '0').toFixed(3),
      buffer_tco2e: new Decimal(r.buffer_total ?? '0').toFixed(3),
      intact_count: Number(r.intact),
      broken_count: Number(r.broken),
      superseded_count: Number(r.superseded),
    }
  }

  // ---- links ----

  async insertLink(client: PoolClient, link: {
    id: string; figure_id: string; token: string; issued_at: Date; expires_at: Date
  }): Promise<void> {
    await client.query(
      `INSERT INTO links (id, figure_id, token, issued_at, expires_at) VALUES ($1,$2,$3,$4,$5)`,
      [link.id, link.figure_id, link.token, link.issued_at, link.expires_at])
  }

  async linksForFigure(figureId: string): Promise<{
    id: string; figure_id: string; token: string; issued_at: Date; expires_at: Date; revoked_at: Date | null
  }[]> {
    const res = await this.pool.query(
      `SELECT id, figure_id, token, issued_at, expires_at, revoked_at
       FROM links WHERE figure_id = $1 ORDER BY issued_at`, [figureId])
    return res.rows
  }

  async linkByToken(token: string): Promise<{
    id: string; figure_id: string; token: string; issued_at: Date; expires_at: Date; revoked_at: Date | null
  } | null> {
    const res = await this.pool.query(
      `SELECT id, figure_id, token, issued_at, expires_at, revoked_at FROM links WHERE token = $1`, [token])
    return res.rows[0] ?? null
  }

  async revokeLink(client: PoolClient, linkId: string, when: Date): Promise<void> {
    await client.query(`UPDATE links SET revoked_at = $2 WHERE id = $1`, [linkId, when])
  }

  // ---- alert queue ----

  async queueAlert(client: PoolClient, entry: {
    figure_id: string; moved: number; reversed_tco2e: string
  }): Promise<void> {
    await client.query(
      `INSERT INTO alert_queue (figure_id, moved, reversed_tco2e) VALUES ($1,$2,$3)`,
      [entry.figure_id, entry.moved, entry.reversed_tco2e])
  }

  /** Claim one unsent alert for this instance; returns null when none pending. */
  async claimAlert(instanceId: string): Promise<{
    id: number; figure_id: string; moved: number; reversed_tco2e: string
  } | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const res = await client.query<{ id: number; figure_id: string; moved: number; reversed_tco2e: string }>(
        `UPDATE alert_queue SET claimed_by = $1, claimed_at = now()
         WHERE id = (
           SELECT id FROM alert_queue
           WHERE sent_at IS NULL AND (claimed_at IS NULL OR claimed_at < now() - interval '2 minutes')
           ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
         )
         RETURNING id, figure_id, moved, reversed_tco2e`, [instanceId])
      await client.query('COMMIT')
      return res.rows[0] ?? null
    } catch {
      await client.query('ROLLBACK')
      return null
    } finally {
      client.release()
    }
  }

  async markAlertSent(id: number): Promise<void> {
    await this.pool.query('UPDATE alert_queue SET sent_at = now() WHERE id = $1', [id])
  }

  async releaseAlertClaim(id: number): Promise<void> {
    await this.pool.query('UPDATE alert_queue SET claimed_by = NULL, claimed_at = NULL WHERE id = $1 AND sent_at IS NULL', [id])
  }

  // ---- idempotency ----

  async idempotentReplay(personId: string, key: string): Promise<{ status: number; body: unknown; request: unknown } | null> {
    const res = await this.pool.query<{ status: number; body: unknown; request: unknown }>(
      `SELECT status, body, request FROM idempotency
       WHERE person_id = $1 AND key = $2 AND expires_at > now()`,
      [personId, key])
    return res.rows[0] ?? null
  }

  async storeIdempotentClient(client: PoolClient, personId: string, key: string, project: string, request: unknown, status: number, body: string, ttlSeconds: number): Promise<void> {
    await client.query(
      `INSERT INTO idempotency (person_id, key, project, request, status, body, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' seconds')::interval)
       ON CONFLICT (person_id, key) DO NOTHING`,
      [personId, key, project, JSON.stringify(request), status, body, String(ttlSeconds)])
  }

  async storeIdempotent(personId: string, key: string, project: string, request: unknown, status: number, body: string, ttlSeconds: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO idempotency (person_id, key, project, request, status, body, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' seconds')::interval)
       ON CONFLICT (person_id, key) DO NOTHING`,
      [personId, key, project, JSON.stringify(request), status, body, String(ttlSeconds)])
  }

  // ---- per-project serialisation ----

  async projectLockKey(slug: string): Promise<string> {
    // stable 64-bit advisory lock key per project
    const hash = createHash('sha256').update(slug).digest()
    return hash.readBigUInt64BE(0).toString()
  }
}

export function newToken(): string {
  return randomBytes(24).toString('base64url')
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}
