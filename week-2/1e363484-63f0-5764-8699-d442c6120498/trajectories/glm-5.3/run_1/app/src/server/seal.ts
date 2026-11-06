import type { PoolClient } from 'pg'
import { conflict, dependency } from './errors.js'
import type { Store, ProjectRow, FigureRow } from './store.js'
import { ObjectStore } from './storage.js'
import { Mailer } from './mail.js'
import type { Config } from './config.js'
import { buildReadingsFile, type CanonicalReading } from '../domain/readingsFile.js'
import { derive } from '../domain/derive.js'
import { apiTimestampTrunc } from '../domain/time.js'
import { Decimal } from 'decimal.js'
import { randomUUID, createHash } from 'node:crypto'

export type SealRequest = { start: string; end: string; sensor_ids: string[]; preview_fingerprint: string }

/** Per-project serialisation via a transaction-scoped advisory lock. */
export async function lockProject(client: PoolClient, slug: string): Promise<void> {
  const h = createHash('sha256').update(`fluxseal-project:${slug}`).digest()
  await client.query('SELECT pg_advisory_xact_lock($1)', [(h.readBigUInt64BE(0) & 0x7fffffffffffffffn).toString()])
}

export class SealService {
  constructor(
    private store: Store,
    private objects: ObjectStore,
    private mailer: Mailer,
    private cfg: Config,
  ) {}

  /**
   * One seal, all or nothing: the figure row, its ledger entries, both
   * evidence objects confirmed, and the notice email accepted together, or
   * nothing remains. State checks run in the published order and touch
   * storage and mail only after they all pass.
   */
  async seal(
    project: ProjectRow,
    personId: string,
    req: SealRequest,
    body201: (fig: FigureRow) => unknown,
  ): Promise<{ status: number; body: string }> {
    const client = await this.store.client()
    let figureId = ''
    try {
      await client.query('BEGIN')
      await lockProject(client, project.slug)

      // state checks in the published order
      const { derivation, readings } = await this.store.deriveFor(project, req.start, req.end, req.sensor_ids)
      if (derivation.fingerprint !== req.preview_fingerprint) {
        throw conflict('readings_changed', { fingerprint: derivation.fingerprint })
      }
      if (new Decimal(derivation.coverage_pct).lessThan(new Decimal(project.floor_pct))) {
        throw conflict('below_coverage_floor', {
          coverage_pct: derivation.coverage_pct, floor_pct: project.floor_pct,
        })
      }
      const overlaps = await client.query<{ id: string; same: boolean }>(
        `SELECT id, (start_ts = $2 AND end_ts = $3) AS same FROM figures
         WHERE project = $1 AND status = 'sealed' AND start_ts < $3 AND end_ts > $2`,
        [project.slug, req.start, req.end])
      const sameInterval = overlaps.rows.find((r) => r.same)
      if (sameInterval) throw conflict('already_sealed', { figure_id: sameInterval.id })
      if (overlaps.rows.length > 0) throw conflict('interval_overlaps_sealed', { figure_id: overlaps.rows[0]!.id })

      const now = new Date()
      const { id, seq } = await this.store.nextFigureId(client, project)
      figureId = id

      // a broken figure with exactly this interval becomes superseded
      const brokenMatch = await client.query<{ id: string }>(
        `SELECT id FROM figures
         WHERE project = $1 AND status = 'broken' AND start_ts = $2 AND end_ts = $3
         ORDER BY sealed_at DESC, id DESC LIMIT 1`,
        [project.slug, req.start, req.end])

      const figure: FigureRow = {
        id, project: project.slug, start: req.start, end: req.end,
        sensor_ids: derivation.sensor_ids, status: 'sealed',
        supersedes: brokenMatch.rows[0]?.id ?? null, superseded_by: null,
        coverage_pct: derivation.coverage_pct, floor_pct: derivation.floor_pct,
        net_tco2e: derivation.net_tco2e, co2_tco2e: derivation.co2_tco2e, ch4_tco2e: derivation.ch4_tco2e,
        buffer_pct: derivation.buffer_pct, buffer_tco2e: derivation.buffer_tco2e,
        credited_tco2e: derivation.credited_tco2e, readings_count: derivation.readings_count,
        fingerprint: derivation.fingerprint, contributions: derivation.contributions,
        sealed_at: apiTimestampTrunc(now), sealed_by: personId, checked_at: apiTimestampTrunc(now),
      }

      if (brokenMatch.rows[0]) {
        await this.store.markSuperseded(client, brokenMatch.rows[0].id, id, now)
      }
      await this.store.insertFigure(client, { ...figure, seq })

      const issuanceId = `led-${randomUUID()}`
      await this.store.insertLedgerEntry(client, {
        id: issuanceId, project: project.slug, figure_id: id, kind: 'issuance',
        tco2e: figure.net_tco2e, reverses: null, recorded_at: now,
      })
      if (new Decimal(figure.net_tco2e).isNegative()) {
        await this.store.insertLedgerEntry(client, {
          id: `led-${randomUUID()}`, project: project.slug, figure_id: id, kind: 'buffer',
          tco2e: figure.buffer_tco2e, reverses: null, recorded_at: now,
        })
      }

      // canonical readings file for the evidence bundle
      const canon: CanonicalReading[] = readings.map((r) => ({
        sensor_id: r.sensor_id, interval_start: r.interval_start,
        fc: new Decimal(r.fc).toFixed(4), fch4: new Decimal(r.fch4).toFixed(4), qc: String(r.qc),
      }))
      const file = buildReadingsFile(canon)
      const body = JSON.stringify(body201(figure))

      // evidence bundle, then notice email, then commit
      try {
        await this.objects.putReadings(figureId, file.bytes, figure.fingerprint)
        await this.objects.putDerivation(figureId, body)
        if (!(await this.objects.confirm(figureId, file.bytes.length, figure.fingerprint))) {
          throw new Error('evidence not confirmed')
        }
      } catch {
        await this.objects.deleteEvidence(figureId).catch(() => undefined)
        throw dependency('storage_unavailable')
      }

      try {
        const lead = await this.store.personById(project.lead_person_id)
        await this.mailer.send({
          to: [lead!.email],
          subject: `Sealed ${figureId}: ${figure.net_tco2e} tCO2e at ${figure.coverage_pct}% coverage`,
          bodyLines: [
            `Figure: ${figureId}`,
            `Project: ${project.name}`,
            `Interval: ${figure.start} to ${figure.end}`,
            `Net: ${figure.net_tco2e} tCO2e`,
            `Buffer: ${figure.buffer_tco2e} tCO2e`,
            `Credited: ${figure.credited_tco2e} tCO2e`,
            `Coverage: ${figure.coverage_pct}%`,
            `Fingerprint: ${figure.fingerprint.slice(0, 12)}`,
          ],
        })
      } catch {
        await this.objects.deleteEvidence(figureId).catch(() => undefined)
        throw dependency('mail_unavailable')
      }

      await client.query('COMMIT')
      return { status: 201, body }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * Insert or revise readings in one batch. Sealed figures whose scope
   * includes a changed reading are re-derived in the same commit; a changed
   * fingerprint breaks the figure, writes its reversals and queues its alert.
   */
  async ingest(
    project: ProjectRow,
    batch: { sensor_id: string; interval_start: string; fc: string; fch4: string; qc: number }[],
  ): Promise<{ batch_id: string; inserted: number; revised: number; unchanged: number; broken_figures: string[] }> {
    const batchId = `batch-${randomUUID()}`
    const client = await this.store.client()
    try {
      await client.query('BEGIN')
      await lockProject(client, project.slug)

      let inserted = 0, revised = 0, unchanged = 0
      const changed: { sensor_id: string; interval_start: string }[] = []
      const now = new Date()

      for (const r of batch) {
        const existing = await client.query<{ fc: string; fch4: string; qc: number }>(
          `SELECT fc, fch4, qc FROM readings
           WHERE project = $1 AND sensor_id = $2 AND interval_start = $3`,
          [project.slug, r.sensor_id, r.interval_start])
        const prev = existing.rows[0]
        if (!prev) {
          await client.query(
            `INSERT INTO readings (project, sensor_id, interval_start, fc, fch4, qc)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [project.slug, r.sensor_id, r.interval_start, r.fc, r.fch4, r.qc])
          await client.query(
            `INSERT INTO revisions (project, sensor_id, interval_start,
              old_fc, old_fch4, old_qc, new_fc, new_fch4, new_qc, batch_id, revised_at)
             VALUES ($1,$2,$3,NULL,NULL,NULL,$4,$5,$6,$7,$8)`,
            [project.slug, r.sensor_id, r.interval_start, r.fc, r.fch4, r.qc, batchId, now])
          inserted++
          changed.push({ sensor_id: r.sensor_id, interval_start: r.interval_start })
        } else if (new Decimal(prev.fc).eq(r.fc) && new Decimal(prev.fch4).eq(r.fch4) && prev.qc === r.qc) {
          unchanged++
        } else {
          await client.query(
            `UPDATE readings SET fc = $4, fch4 = $5, qc = $6
             WHERE project = $1 AND sensor_id = $2 AND interval_start = $3`,
            [project.slug, r.sensor_id, r.interval_start, r.fc, r.fch4, r.qc])
          await client.query(
            `INSERT INTO revisions (project, sensor_id, interval_start,
              old_fc, old_fch4, old_qc, new_fc, new_fch4, new_qc, batch_id, revised_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [project.slug, r.sensor_id, r.interval_start, prev.fc, prev.fch4, prev.qc,
              r.fc, r.fch4, r.qc, batchId, now])
          revised++
          changed.push({ sensor_id: r.sensor_id, interval_start: r.interval_start })
        }
      }

      const brokenFigures: string[] = []
      if (changed.length > 0) {
        const sealedFigs = await client.query<{
          id: string; start_ts: string; end_ts: string; sensor_ids: string[]
          fingerprint: string
        }>(
          `SELECT id, start_ts, end_ts, sensor_ids, fingerprint
           FROM figures WHERE project = $1 AND status = 'sealed'`, [project.slug])
        for (const fig of sealedFigs.rows) {
          const figSensors = new Set(fig.sensor_ids)
          const inScope = changed.filter((c) =>
            figSensors.has(c.sensor_id) && c.interval_start >= fig.start_ts && c.interval_start < fig.end_ts)
          if (inScope.length === 0) continue
          const readings = await this.store.readingsInRange(project.slug, fig.start_ts, fig.end_ts, [...figSensors], client)
          const d = derive(this.store.deriveProject(project), fig.start_ts, fig.end_ts, [...figSensors], readings)
          if (d.fingerprint === fig.fingerprint) continue

          await this.store.markBroken(client, fig.id, now)
          const entries = await client.query<{ id: string; tco2e: string }>(
            `SELECT id, tco2e FROM ledger WHERE figure_id = $1`, [fig.id])
          let reversed = new Decimal(0)
          for (const e of entries.rows) {
            const neg = new Decimal(e.tco2e).neg()
            await this.store.insertLedgerEntry(client, {
              id: `led-${randomUUID()}`, project: project.slug, figure_id: fig.id, kind: 'reversal',
              tco2e: neg.toFixed(3), reverses: e.id, recorded_at: now,
            })
            reversed = reversed.plus(neg)
          }
          await this.store.queueAlert(client, {
            figure_id: fig.id,
            moved: inScope.length,
            reversed_tco2e: reversed.toFixed(3),
          })
          brokenFigures.push(fig.id)
        }
      }

      await client.query('COMMIT')
      return { batch_id: batchId, inserted, revised, unchanged, broken_figures: brokenFigures }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  }
}
