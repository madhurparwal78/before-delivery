import { pool, type Queryable } from "./db.js";

/** A durable job table: effects that must happen once and are retried until they do. */

type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export const registerJob = (kind: string, handler: JobHandler): void => {
  handlers.set(kind, handler);
};

export const enqueue = async (q: Queryable, kind: string, key: string, payload: Record<string, unknown>): Promise<void> => {
  await q.query("INSERT INTO jobs (kind, key, payload) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING", [kind, key, payload]);
};

interface JobRow {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

const BACKOFF_SECONDS = 15;

const runOne = async (job: JobRow): Promise<void> => {
  try {
    const handler = handlers.get(job.kind);
    if (!handler) throw new Error(`no handler for ${job.kind}`);
    await handler(job.payload);
    await pool.query("UPDATE jobs SET status = 'done' WHERE id = $1", [job.id]);
  } catch (error) {
    const delay = Math.min(2 ** job.attempts, BACKOFF_SECONDS);
    await pool.query(
      "UPDATE jobs SET status = 'pending', attempts = attempts + 1, run_at = now() + make_interval(secs => $2), last_error = $3 WHERE id = $1",
      [job.id, delay, error instanceof Error ? error.name : "failed"],
    );
  }
};

let draining = false;

const drain = async (): Promise<void> => {
  if (draining) return;
  draining = true;
  try {
    const claimed = await pool.query(
      `UPDATE jobs SET status = 'running', run_at = now() + interval '60 seconds'
       WHERE id IN (SELECT id FROM jobs WHERE status = 'pending' AND run_at <= now() ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
       RETURNING id, kind, payload, attempts`,
    );
    await Promise.all((claimed.rows as JobRow[]).map(runOne));
    await pool.query("UPDATE jobs SET status = 'pending' WHERE status = 'running' AND run_at <= now()");
  } catch {
    return;
  } finally {
    draining = false;
  }
};

export const startJobs = (): void => {
  setInterval(() => void drain(), 400).unref();
};

/** True while unsent jobs of a kind are waiting (used for the staff "waiting" notices). */
export const hasPending = async (kind: string): Promise<boolean> => {
  const row = await pool.query("SELECT 1 FROM jobs WHERE kind = $1 AND status <> 'done' LIMIT 1", [kind]);
  return row.rowCount === 1;
};
