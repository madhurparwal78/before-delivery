// Export jobs: the stored record, the state machine (queued -> rendering -> ready | failed, retry back to queued)
// and the worker that moves a job along, one step pause at a time.
import { createHash } from 'node:crypto';
import type { ExportJob, ExportKind, ExportStatus, Filter, ParameterValue } from '../../shared/model.ts';
import { newId } from '../db/ids.ts';
import type { App } from '../http/app.ts';
import { notFound } from '../http/errors.ts';
import type { Reply } from '../http/reply.ts';
import { stream } from '../http/reply.ts';
import { frame } from '../events/hub.ts';

export type ExportTarget = { sheet: string } | { dashboard: string };

export interface ExportRequest {
  kind: ExportKind;
  target: ExportTarget;
  filters: Filter[];
  parameters: Record<string, ParameterValue>;
}

export interface JobRow {
  id: string;
  user_id: string;
  kind: ExportKind;
  target: 'sheet' | 'dashboard';
  target_id: string;
  filters: Filter[];
  parameters: Record<string, ParameterValue>;
  status: ExportStatus;
  progress: 0 | 50 | 100;
}

export const jobSchema = [
  `CREATE TABLE IF NOT EXISTS export_jobs (
     id text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users(id),
     kind text NOT NULL,
     target text NOT NULL,
     target_id text NOT NULL,
     filters jsonb NOT NULL,
     parameters jsonb NOT NULL,
     request_key text NOT NULL,
     status text NOT NULL,
     progress integer NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS export_jobs_request ON export_jobs (user_id, request_key)`,
  // A restart ends every worker, so a job still queued or rendering can only be retried from failed.
  `UPDATE export_jobs SET status = 'failed', progress = 0 WHERE status IN ('queued', 'rendering')`,
];

const FILE_TYPES: Record<ExportKind, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  csv: 'text/csv; charset=utf-8',
};

export const fileType = (kind: ExportKind): string => FILE_TYPES[kind];
export const objectKey = (job: { id: string; kind: ExportKind }): string => `exports/${job.id}.${job.kind}`;

const RUNNING = `SELECT * FROM export_jobs WHERE user_id = $1 AND request_key = $2 AND status IN ('queued', 'rendering')`;
const PAUSED_POLL_MS = 25;
const TERMINAL: readonly ExportStatus[] = ['ready', 'failed'];

/** Object keys in sorted order, so the same request always produces the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The same kind, target, filters and parameters make the same request. */
export function requestKey(request: ExportRequest): string {
  return createHash('sha256')
    .update(canonical([request.kind, request.target, request.filters, request.parameters]))
    .digest('hex');
}

export function jobOf(row: JobRow): ExportJob {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    progress: row.progress,
    download: row.status === 'ready' ? `/api/exports/${row.id}/file` : null,
  };
}

type Watcher = (status: ExportStatus, progress: 0 | 50 | 100) => void;

/** Renders one job's file; the worker stores what it returns. */
type Renderer = (job: JobRow) => Promise<Buffer>;

export class ExportJobs {
  private readonly watchers = new Map<string, Set<Watcher>>();

  constructor(
    private readonly app: App,
    private readonly render: Renderer,
  ) {}

  async find(id: string, userId: string): Promise<JobRow> {
    const row = await this.app.db.row<JobRow>(`SELECT * FROM export_jobs WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!row) throw notFound();
    return row;
  }

  /** The user's job with the same request that is still queued or rendering. */
  running(userId: string, request: ExportRequest): Promise<JobRow | null> {
    return this.app.db.row<JobRow>(RUNNING, [userId, requestKey(request)]);
  }

  /**
   * Stores a queued job and starts it, unless the same request is already running: then that job comes back.
   * The lock makes two identical requests that arrive together one job.
   */
  async submit(userId: string, request: ExportRequest): Promise<{ job: JobRow; created: boolean }> {
    const key = requestKey(request);
    const [target, targetId] = 'sheet' in request.target ? (['sheet', request.target.sheet] as const) : (['dashboard', request.target.dashboard] as const);
    const answer = await this.app.db.transaction(async (tx) => {
      await tx.exec(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${userId}:${key}`]);
      const existing = await tx.row<JobRow>(RUNNING, [userId, key]);
      if (existing) return { job: existing, created: false };
      const job: JobRow = {
        id: newId(), user_id: userId, kind: request.kind, target, target_id: targetId,
        filters: request.filters, parameters: request.parameters, status: 'queued', progress: 0,
      };
      await tx.exec(
        `INSERT INTO export_jobs (id, user_id, kind, target, target_id, filters, parameters, request_key, status, progress)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', 0)`,
        [job.id, userId, job.kind, target, targetId, JSON.stringify(job.filters), JSON.stringify(job.parameters), key],
      );
      return { job, created: true };
    });
    if (answer.created) this.start(answer.job);
    return answer;
  }

  /** `failed -> queued`; null when the job is not failed. */
  async retry(job: JobRow): Promise<JobRow | null> {
    const moved = await this.app.db.exec(
      `UPDATE export_jobs SET status = 'queued', progress = 0 WHERE id = $1 AND status = 'failed'`,
      [job.id],
    );
    if (moved === 0) return null;
    const queued: JobRow = { ...job, status: 'queued', progress: 0 };
    this.announce(queued);
    this.start(queued);
    return queued;
  }

  /** The job's own event stream: its current state, each later state, then the end. */
  events(job: JobRow): Reply {
    return stream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
      const write = (status: ExportStatus, progress: 0 | 50 | 100): void => {
        res.write(frame('state', { status, progress }));
        if (!TERMINAL.includes(status)) return;
        res.write(frame('end', { status }));
        res.end();
      };
      const set = this.watchers.get(job.id) ?? new Set<Watcher>();
      this.watchers.set(job.id, set);
      set.add(write);
      res.on('close', () => {
        set.delete(write);
        if (set.size === 0) this.watchers.delete(job.id);
      });
      write(job.status, job.progress);
    });
  }

  /** A job whose failure cannot even be recorded stays as it was. */
  private start(job: JobRow): void {
    void this.run(job).catch(() => undefined);
  }

  private async run(job: JobRow): Promise<void> {
    try {
      await this.drive(job);
    } catch {
      await this.settle(job, 'failed', 0);
    }
  }

  private async drive(job: JobRow): Promise<void> {
    while (this.app.flags.exportsPaused) await this.pause(PAUSED_POLL_MS);
    await this.pause(this.app.config.exportStepMs);
    await this.settle(job, 'rendering', 50);
    await this.pause(this.app.config.exportStepMs);
    const file = await this.render(job);
    await this.app.storage.put(objectKey(job), file, fileType(job.kind));
    await this.settle(job, 'ready', 100);
  }

  private async settle(job: JobRow, status: ExportStatus, progress: 0 | 50 | 100): Promise<void> {
    await this.app.db.exec(`UPDATE export_jobs SET status = $2, progress = $3 WHERE id = $1`, [job.id, status, progress]);
    this.announce({ ...job, status, progress });
  }

  private announce(job: JobRow): void {
    this.app.events.toUser(job.user_id, 'export', { id: job.id, status: job.status, progress: job.progress });
    for (const watch of this.watchers.get(job.id) ?? []) watch(job.status, job.progress);
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
