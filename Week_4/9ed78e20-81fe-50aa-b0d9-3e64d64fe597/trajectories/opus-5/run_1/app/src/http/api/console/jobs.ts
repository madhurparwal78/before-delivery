import { pool, withTransaction } from '../../../db/pool.js';
import { appendAuditEntry } from '../../../domain/audit.js';
import type { JobKind, JobState } from '../../../services/jobs.js';
import { errors } from '../../errors.js';
import { jsonReply } from '../../reply.js';
import { route } from '../../server.js';
import { consoleRead, consoleWrite, objectBody, onlyKeys, requireRole } from './guard.js';

type JobView = {
  id: string;
  kind: JobKind;
  state: JobState;
  attempts: number;
  refusals: number;
  last_error: string | null;
  next_attempt_at: Date;
  created_at: Date;
  finished_at: Date | null;
};

const JOB_COLUMNS = `id, kind, state, attempts, refusals, last_error, next_attempt_at,
  created_at, finished_at`;

function jobObject(row: JobView): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    attempts: row.attempts,
    refusals: row.refusals,
    last_error: row.last_error,
    next_attempt_at: row.next_attempt_at.toISOString(),
    created_at: row.created_at.toISOString(),
    finished_at: row.finished_at === null ? null : row.finished_at.toISOString(),
  };
}

export function registerConsoleJobsApi(): void {
  route('GET', '/api/console/jobs', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      requireRole(session, 'administrator');
      const result = await pool.query<JobView>(
        `SELECT ${JOB_COLUMNS} FROM jobs
          WHERE ($1::text IS NULL OR state = $1::text)
            AND ($2::text IS NULL OR kind = $2::text)
          ORDER BY created_at DESC, id
          LIMIT 200`,
        [ctx.url.searchParams.get('state'), ctx.url.searchParams.get('kind')],
      );
      return jsonReply(200, { jobs: result.rows.map(jobObject) });
    }),
  );

  route('POST', '/api/console/jobs/:id/retry', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      const existing = await pool.query<JobView>(
        `SELECT ${JOB_COLUMNS} FROM jobs WHERE id = $1`,
        [id],
      );
      if ((existing.rowCount ?? 0) === 0) throw errors.consoleNotFound();
      requireRole(session, 'administrator');
      onlyKeys(objectBody(ctx.json()), []);

      const job = await withTransaction(async (tx) => {
        const retried = await tx.query<JobView>(
          `UPDATE jobs SET state='pending', attempts=0, refusals=0, last_error=NULL,
                  next_attempt_at=now(), lease_until=NULL, finished_at=NULL
            WHERE id = $1 AND state = 'dead'
            RETURNING ${JOB_COLUMNS}`,
          [id],
        );
        const row = retried.rows[0];
        if (row === undefined) {
          throw errors.conflict('job_not_dead', 'Only dead jobs can be retried.');
        }
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'job.retry',
          targetType: 'job',
          targetId: id,
          detail: { kind: row.kind },
        });
        return row;
      });
      return jsonReply(200, { job: jobObject(job) });
    }),
  );
}
