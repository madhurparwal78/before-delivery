import { connectDb, withTx, type Tx, type Row } from './db.js';
import { config } from './config.js';
import { now } from './time.js';
import { newId, sweepDay, offerPass } from './domain.js';
import { runJob } from './jobhandlers.js';

/** Durable job queue claimed by one live lease across instances (DP-77). */
export async function enqueueJob(tx: Tx, kind: 'thumbnail' | 'dunning_retry' | 'due_reminder' | 'offer_pass' | 'csv_export', runAt: Date, params: Record<string, unknown>, maxAttempts?: number): Promise<string> {
  const id = newId('job');
  await tx.query(
    `insert into jobs(id, kind, status, attempts, max_attempts, run_at, params, created_at)
     values($1,$2,'queued',0,$3,$4,$5,$6)`,
    [id, kind, maxAttempts ?? config.jobMaxAttempts, runAt, JSON.stringify(params), now()]
  );
  return id;
}

/** Claims one due job. Returns null when nothing is due or the job is taken. */
export async function claimJob(): Promise<Row | null> {
  return withTx(async tx => {
    const due = await tx.query(
      `select * from jobs where status = 'queued' and run_at <= $1 order by run_at limit 1 for update skip locked`,
      [now()]
    );
    if (due.length === 0) {
      // Reclaim a running job whose lease expired; counts as an attempt.
      const stale = await tx.query(
        `select * from jobs where status = 'running' and lease_expires_at <= $1 order by run_at limit 1 for update skip locked`,
        [now()]
      );
      if (stale.length === 0) return null;
      const j = stale[0];
      await tx.query(
        `update jobs set status = 'running', attempts = attempts + 1, lease_expires_at = $2, leased_by = $3 where id = $1`,
        [j.id, new Date(now().getTime() + config.jobLeaseSeconds * 1000), config.instanceLabel]
      );
      return (await tx.query(`select * from jobs where id = $1`, [j.id]))[0];
    }
    const j = due[0];
    await tx.query(
      `update jobs set status = 'running', attempts = attempts + 1, lease_expires_at = $2, leased_by = $3 where id = $1`,
      [j.id, new Date(now().getTime() + config.jobLeaseSeconds * 1000), config.instanceLabel]
    );
    return (await tx.query(`select * from jobs where id = $1`, [j.id]))[0];
  });
}

export async function finishJob(jobId: string, result: unknown): Promise<void> {
  await withTx(async tx => {
    // Discard a superseded worker's result (DP-77).
    const rows = await tx.query(`select leased_by, lease_expires_at from jobs where id = $1 for update`, [jobId]);
    if (rows.length === 0) return;
    const j = rows[0];
    if (j.leased_by !== null && j.lease_expires_at.getTime() <= now().getTime()) {
      // lease was taken over; our result is stale, but the row now belongs to another worker.
      return;
    }
    await tx.query(
      `update jobs set status = 'succeeded', result = $2, last_error = null, lease_expires_at = null, leased_by = null where id = $1`,
      [jobId, JSON.stringify(result ?? null)]
    );
  });
}

export async function failJob(jobId: string, error: string): Promise<void> {
  await withTx(async tx => {
    const rows = await tx.query(`select attempts, max_attempts, leased_by, lease_expires_at from jobs where id = $1 for update`, [jobId]);
    if (rows.length === 0) return;
    const j = rows[0];
    if (j.leased_by !== null && j.lease_expires_at.getTime() <= now().getTime()) return;
    const backoff = Math.min(config.jobBackoffBaseSeconds * Math.pow(2, Math.max(0, j.attempts - 1)), config.jobBackoffMaxSeconds);
    if (j.attempts >= j.max_attempts) {
      await tx.query(
        `update jobs set status = 'dead', last_error = $2, lease_expires_at = null, leased_by = null where id = $1`,
        [jobId, error.slice(0, 500)]
      );
    } else {
      await tx.query(
        `update jobs set status = 'queued', run_at = $2, last_error = $3, lease_expires_at = null, leased_by = null where id = $1`,
        [jobId, new Date(now().getTime() + backoff * 1000), error.slice(0, 500)]
      );
    }
  });
}

let stopped = false;

export function stopWorkers(): void {
  stopped = true;
}

let workerTimer: NodeJS.Timeout | null = null;

/** The shared worker loop: claims jobs, runs them, releases unstarted claims on drain. */
export function startWorkers(): void {
  stopped = false;
  workerTimer = setInterval(async () => {
    if (stopped) return;
    for (let i = 0; i < 3; i++) {
      let job: Row | null = null;
      try {
        job = await claimJob();
      } catch {
        return;
      }
      if (!job) break;
      try {
        const result = await runJob(job);
        await finishJob(job.id, result);
      } catch (e) {
        await failJob(job.id, e instanceof Error ? e.message : String(e));
      }
    }
  }, 1000);
  workerTimer.unref?.();
}

/** Returns unstarted claims to queued on shutdown (DP-85). */
export async function releaseClaims(): Promise<void> {
  await withTx(async tx => {
    await tx.query(
      `update jobs set status = 'queued', lease_expires_at = null, leased_by = null, attempts = greatest(attempts - 1, 0)
       where status = 'running' and leased_by = $1 and lease_expires_at > $2`,
      [config.instanceLabel, now()]
    );
  }).catch(() => {});
}

export async function workersBusy(): Promise<boolean> {
  const rows = await connectDb().query(
    `select count(*)::int as n from jobs where status = 'running' and leased_by = $1`,
    [config.instanceLabel]
  );
  return rows.rows[0].n > 0;
}
