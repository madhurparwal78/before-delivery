import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, type Queryable } from '../db/pool.js';
import { generateSampleObject } from '../media/samples.js';
import {
  MailRefused,
  MailUnreachable,
  sendMail,
  type Recipient,
} from './mail.js';
import { mailIsUp, storageIsUp } from './probes.js';
import { StorageRefused, StorageUnreachable, deleteObject, putObject } from './storage.js';

export type JobKind = 'mail' | 'resume_erase' | 'sample_upload';
export type JobState = 'pending' | 'running' | 'done' | 'dead';

export type MailPayload = {
  readonly to: Recipient;
  readonly subject: string;
  readonly text: string;
};

export type ResumeErasePayload = { readonly key: string };

export type SampleUploadPayload = {
  readonly model_slug: string;
  readonly sample_id: string;
  readonly file: string;
  readonly frames: number;
};

export type JobRow = {
  id: string;
  kind: JobKind;
  payload: MailPayload | ResumeErasePayload | SampleUploadPayload;
  state: JobState;
  attempts: number;
  refusals: number;
  last_error: string | null;
  next_attempt_at: Date;
  created_at: Date;
  finished_at: Date | null;
};

export async function queueJob(
  tx: Queryable,
  kind: JobKind,
  payload: MailPayload | ResumeErasePayload | SampleUploadPayload,
  dedupeKey?: string,
): Promise<string> {
  const id = randomUUID();
  const result = await tx.query<{ id: string }>(
    `INSERT INTO jobs (id, kind, payload, dedupe_key, state, next_attempt_at, created_at)
     VALUES ($1,$2,$3,$4,'pending',now(),now())
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [id, kind, JSON.stringify(payload), dedupeKey ?? null],
  );
  return result.rows[0]?.id ?? id;
}

function backoffSeconds(refusals: number): number {
  const delay = config.outboxRetrySeconds * 2 ** Math.max(0, refusals - 1);
  return Math.min(delay, config.outboxRetryMaxSeconds);
}

async function claimJob(kinds: readonly JobKind[]): Promise<JobRow | undefined> {
  if (kinds.length === 0) return undefined;
  const result = await query<JobRow>(
    `UPDATE jobs SET state='running', lease_until = now() + interval '60 seconds',
            attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs
         WHERE state = 'pending' AND kind = ANY($1::text[]) AND next_attempt_at <= now()
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING id, kind, payload, state, attempts, refusals, last_error, next_attempt_at,
                created_at, finished_at`,
    [kinds],
  );
  return result.rows[0];
}

async function finishJob(id: string): Promise<void> {
  await query(
    `UPDATE jobs SET state='done', finished_at=now(), last_error=null, lease_until=null
      WHERE id=$1`,
    [id],
  );
}

async function recordUnreachable(id: string, error: string): Promise<void> {
  await query(
    `UPDATE jobs SET state='pending', lease_until=null, last_error=$2,
            next_attempt_at = now() + ($3 || ' seconds')::interval
      WHERE id=$1`,
    [id, error, String(config.outboxRetrySeconds)],
  );
}

async function recordRefusal(id: string, error: string, refusals: number): Promise<void> {
  const next = refusals + 1;
  if (next >= config.jobMaxAttempts) {
    await query(
      `UPDATE jobs SET state='dead', refusals=$2, last_error=$3, lease_until=null,
              finished_at=now()
        WHERE id=$1`,
      [id, next, error],
    );
    return;
  }
  await query(
    `UPDATE jobs SET state='pending', refusals=$2, last_error=$3, lease_until=null,
            next_attempt_at = now() + ($4 || ' seconds')::interval
      WHERE id=$1`,
    [id, next, error, String(backoffSeconds(next))],
  );
}

async function runJob(job: JobRow): Promise<void> {
  if (job.kind === 'mail') {
    const payload = job.payload as MailPayload;
    await sendMail({
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      messageId: `<outbox-${job.id}@aldermoor.example>`,
    });
    return;
  }
  if (job.kind === 'resume_erase') {
    await deleteObject((job.payload as ResumeErasePayload).key);
    return;
  }
  const payload = job.payload as SampleUploadPayload;
  const object = generateSampleObject(payload.sample_id, payload.file, payload.frames);
  await putObject(
    `samples/${payload.model_slug}/${payload.sample_id}/${payload.file}`,
    object.bytes,
    object.contentType,
  );
}

async function releaseLapsedLeases(): Promise<void> {
  await query(
    `UPDATE jobs SET state='pending', lease_until=null
      WHERE state='running' AND lease_until IS NOT NULL AND lease_until < now()`,
  );
}

function reachableKinds(): JobKind[] {
  const kinds: JobKind[] = [];
  if (mailIsUp()) kinds.push('mail');
  if (storageIsUp()) {
    kinds.push('resume_erase');
    kinds.push('sample_upload');
  }
  return kinds;
}

async function drain(): Promise<void> {
  await releaseLapsedLeases();
  for (let processed = 0; processed < 50; processed += 1) {
    const job = await claimJob(reachableKinds());
    if (job === undefined) return;
    try {
      await runJob(job);
      await finishJob(job.id);
    } catch (error) {
      if (error instanceof MailUnreachable || error instanceof StorageUnreachable) {
        await recordUnreachable(
          job.id,
          error instanceof MailUnreachable ? 'mail_unreachable' : 'storage_unreachable',
        );
      } else if (error instanceof MailRefused || error instanceof StorageRefused) {
        await recordRefusal(
          job.id,
          error instanceof MailRefused ? 'mail_refused' : 'storage_refused',
          job.refusals,
        );
      } else {
        await recordRefusal(
          job.id,
          job.kind === 'mail' ? 'mail_refused' : 'storage_refused',
          job.refusals,
        );
      }
    }
  }
}

export function startJobWorker(): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await drain();
    } catch {
      // A database hiccup leaves the jobs pending for the next tick.
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, 1000);
  timer.unref();
  void tick();
}
