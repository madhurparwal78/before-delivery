import { config } from '../config.js';
import { now } from '../clock.js';
import { query, queryOne, withClient, withTransaction } from '../db.js';
import { json, route, type Ctx } from '../http.js';
import { newId } from '../util.js';
import { ValidationError, fieldMessages, illegalTransition, notFound } from '../errors.js';
import { practice } from '../domain/practice.js';
import { businessDateAt, formatInstant, monthAt } from '../domain/time.js';
import { FIGURE_OF, type LedgerKind } from '../domain/ledger.js';
import { nextDue } from '../domain/nextdue.js';

/**
 * The dashboard reads the ledger. A figure belongs to the month and date its entry's
 * instant falls on in the practice zone, and applied deposits count as neither new
 * money nor refunds.
 */
interface LedgerEntryRow {
  kind: LedgerKind;
  amount_cents: number;
  at: Date;
}

export interface MonthFigures {
  billedCents: number;
  collectedCents: number;
  refundedCents: number;
  rows: Map<string, { billed: number; collected: number; refunded: number }>;
}

export async function monthFigures(
  db: Parameters<typeof query>[0],
  month: string,
  timeZone: string,
): Promise<MonthFigures> {
  const entries = await query<LedgerEntryRow>(
    db,
    'SELECT kind, amount_cents, at FROM ledger_entries ORDER BY at',
  );
  const figures: MonthFigures = {
    billedCents: 0,
    collectedCents: 0,
    refundedCents: 0,
    rows: new Map(),
  };
  for (const entry of entries) {
    if (monthAt(entry.at, timeZone) !== month) continue;
    const figure = FIGURE_OF[entry.kind];
    if (figure === 'none') continue;
    const date = businessDateAt(entry.at, timeZone);
    const row = figures.rows.get(date) ?? { billed: 0, collected: 0, refunded: 0 };
    if (figure === 'billed') {
      figures.billedCents += entry.amount_cents;
      row.billed += entry.amount_cents;
    } else if (figure === 'collected') {
      figures.collectedCents += entry.amount_cents;
      row.collected += entry.amount_cents;
    } else {
      figures.refundedCents += entry.amount_cents;
      row.refunded += entry.amount_cents;
    }
    figures.rows.set(date, row);
  }
  return figures;
}

export function registerDashboardRoutes(): void {
  route({
    method: 'GET',
    path: '/api/dashboard',
    roles: ['farrier'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const body = await withClient(async (db) => {
        const { timeZone } = await practice(db);
        const given = ctx.url.searchParams.get('month');
        if (given !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(given)) {
          throw new ValidationError({ month: fieldMessages.required });
        }
        const month = given ?? monthAt(now(), timeZone);
        const figures = await monthFigures(db, month, timeZone);

        const outstanding = await queryOne<{ total: number }>(
          db,
          `SELECT COALESCE(SUM(balance_cents),0)::int AS total FROM invoices
           WHERE status = 'unpaid' AND to_char(business_date,'YYYY-MM') = $1`,
          [month],
        );

        const today = businessDateAt(now(), timeZone);
        const horses = await query<{ id: string; cycle_weeks: number; last: string | null }>(
          db,
          `SELECT h.id, h.cycle_weeks,
                  (SELECT to_char(MAX(v.business_date),'YYYY-MM-DD') FROM visits v
                   WHERE v.horse_id = h.id AND v.status <> 'open') AS last
           FROM horses h`,
        );
        let overdueHorses = 0;
        for (const horse of horses) {
          const due = nextDue(horse.last, horse.cycle_weeks, today);
          if (due.dueStatus === 'overdue' && due.nextDueDate !== null && due.nextDueDate.startsWith(month)) {
            overdueHorses += 1;
          }
        }

        const rows = [...figures.rows.entries()]
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(([date, row]) => ({
            date,
            billed_cents: row.billed,
            collected_cents: row.collected,
            refunded_cents: row.refunded,
          }));

        return {
          month,
          billed_cents: figures.billedCents,
          collected_cents: figures.collectedCents,
          refunded_cents: figures.refundedCents,
          outstanding_cents: outstanding?.total ?? 0,
          overdue_horses: overdueHorses,
          rows,
        };
      });
      return json(200, body);
    },
  });

  route({
    method: 'POST',
    path: '/api/dashboard/exports',
    roles: ['farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const month = ctx.body<{ month?: unknown }>().month;
      if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new ValidationError({ month: fieldMessages.required });
      }
      const jobId = await withTransaction(async (db) => {
        const at = now();
        const id = newId();
        await query(
          db,
          `INSERT INTO jobs (id, kind, status, payload, max_attempts, run_at, request_id, created_at, updated_at)
           VALUES ($1,'csv_export','queued',$2::jsonb,$3,$4,$5,$4,$4)`,
          [id, JSON.stringify({ month }), config.jobMaxAttempts, at, ctx.requestId],
        );
        return id;
      });
      return json(202, { job_id: jobId });
    },
  });

  route({
    method: 'GET',
    path: '/api/jobs/:id',
    roles: ['farrier'],
    handler: async (ctx: Ctx) => {
      const body = await withClient(async (db) => {
        const { timeZone } = await practice(db);
        const job = await queryOne<JobRow>(db, `${JOB_SELECT} WHERE id = $1`, [ctx.params.id as string]);
        if (job === null) throw notFound();
        return jobJson(job, timeZone);
      });
      return json(200, body);
    },
  });

  route({
    method: 'GET',
    path: '/api/jobs',
    roles: ['farrier'],
    handler: async (ctx: Ctx) => {
      const rows = await withClient(async (db) => {
        const { timeZone } = await practice(db);
        const jobs = await query<JobRow>(
          db,
          `${JOB_SELECT} WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR kind = $2)
           ORDER BY created_at DESC LIMIT 200`,
          [ctx.url.searchParams.get('status'), ctx.url.searchParams.get('kind')],
        );
        return jobs.map((job) => jobJson(job, timeZone));
      });
      return json(200, rows);
    },
  });

  route({
    method: 'POST',
    path: '/api/jobs/:id/retry',
    roles: ['farrier'],
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const body = await withTransaction(async (db) => {
        const at = now();
        const { timeZone } = await practice(db);
        const job = await queryOne<JobRow>(db, `${JOB_SELECT} WHERE id = $1 FOR UPDATE`, [
          ctx.params.id as string,
        ]);
        if (job === null) throw notFound();
        if (job.status !== 'dead') throw illegalTransition(job.status, 'retry');
        await query(
          db,
          `UPDATE jobs SET status = 'queued', attempts = 0, run_at = $2, last_error = NULL,
                           lease_expires_at = NULL, lease_holder = NULL, updated_at = $2
           WHERE id = $1`,
          [job.id, at],
        );
        const updated = await queryOne<JobRow>(db, `${JOB_SELECT} WHERE id = $1`, [job.id]);
        if (updated === null) throw notFound();
        return jobJson(updated, timeZone);
      });
      return json(200, body);
    },
  });

  route({
    method: 'GET',
    path: '/api/audit',
    roles: ['farrier'],
    handler: async (ctx: Ctx) => {
      const limitRaw = ctx.url.searchParams.get('limit');
      const limit = limitRaw === null ? 100 : Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new ValidationError({ limit: fieldMessages.range(1, 500) });
      }
      const rows = await withClient(async (db) => {
        const { timeZone } = await practice(db);
        const entries = await query<{
          id: string;
          at: Date;
          actor_type: string;
          actor_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string;
          from_state: string | null;
          to_state: string | null;
          request_id: string | null;
        }>(
          db,
          `SELECT id, at, actor_type, actor_id, action, entity_type, entity_id, from_state,
                  to_state, request_id
           FROM audit_log
           WHERE ($1::text IS NULL OR entity_type = $1) AND ($2::text IS NULL OR entity_id = $2)
           ORDER BY at DESC, id DESC LIMIT $3`,
          [ctx.url.searchParams.get('entity_type'), ctx.url.searchParams.get('entity_id'), limit],
        );
        return entries.map((entry) => ({
          id: entry.id,
          at: formatInstant(entry.at, timeZone),
          actor: { type: entry.actor_type, id: entry.actor_id },
          action: entry.action,
          entity_type: entry.entity_type,
          entity_id: entry.entity_id,
          from: entry.from_state,
          to: entry.to_state,
          request_id: entry.request_id,
        }));
      });
      return json(200, rows);
    },
  });
}

interface JobRow {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  last_error: string | null;
  result: unknown;
}

const JOB_SELECT = `SELECT id, kind, status, attempts, max_attempts, run_at, last_error, result FROM jobs`;

function jobJson(job: JobRow, timeZone: string): Record<string, unknown> {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    max_attempts: job.max_attempts,
    run_at: formatInstant(job.run_at, timeZone),
    last_error: job.last_error,
    result: job.result,
  };
}
