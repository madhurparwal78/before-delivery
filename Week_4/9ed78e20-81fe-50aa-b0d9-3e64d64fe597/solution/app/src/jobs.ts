import { pool, transaction, saveApplication, audit, enqueueJob } from "./db.js";
import type { PoolClient } from "pg";
import { publishContent, voidLapsedSignoffs } from "./content.js";
import { queueGrantExpiry } from "./governance.js";
import { config } from "./config.js";
import {
  deleteObject,
  putObject,
  generatedSamples,
  storage,
  StorageRefused,
} from "./media.js";
import { smtp, MailRefused } from "./mail.js";
import { probe, serviceState } from "./probes.js";
import type {
  Content,
  Application,
  Grant,
  JobKind,
  MailMessage,
} from "./types.js";
// Each sweep runs on one instance at a time under its own transaction-scoped lock.
async function exclusively(
  lock: number,
  fn: (db: PoolClient) => Promise<void>,
): Promise<void> {
  await transaction(async (db) => {
    const acquired = await db.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1) AS locked",
      [lock],
    );
    if (acquired.rows[0].locked) await fn(db);
  });
}
async function releaseDue(): Promise<void> {
  await exclusively(81734921, async (db) => {
    // A linked announcement is not selected on its own: it publishes with its model route.
    const due = await db.query<{ data: Content }>(
      `SELECT data FROM content c WHERE status='scheduled' AND (data->>'release_at')::timestamptz <= now()
       AND NOT EXISTS (SELECT 1 FROM content m WHERE m.kind='model' AND m.status='scheduled' AND m.data->>'linked_news_slug'=c.slug)
       ORDER BY id FOR UPDATE`,
    );
    for (const { data: item } of due.rows)
      await publishContent(db, item, "system:scheduler", item.release_at!);
  });
}
async function grantNotices(): Promise<void> {
  await transaction(async (db) => {
    const due = await db.query<{ data: Grant }>(
      "SELECT data FROM grants WHERE expiry_notified=false FOR UPDATE SKIP LOCKED",
    );
    for (const { data: g } of due.rows) await queueGrantExpiry(db, g);
  });
}
async function lapseSignoffs(): Promise<void> {
  await exclusively(81734923, (db) => voidLapsedSignoffs(db, "system:grants"));
}
async function eraseRetained(): Promise<void> {
  await exclusively(81734922, async (db) => {
    const due = await db.query<{ data: Application }>(
      "SELECT a.data FROM applications a JOIN requisitions r ON r.id=a.requisition_id WHERE (a.data->>'erased')::boolean=false AND r.status='closed' AND (r.data->>'erase_after')::timestamptz <= now() FOR UPDATE OF a",
    );
    for (const { data: a } of due.rows) {
      const expected = a.version;
      await enqueueJob(db, "resume_erase", { key: a.resume_key });
      a.name = "Erased applicant";
      a.email = "";
      a.resume_key = "";
      a.token_digest = null;
      a.token_ciphertext = null;
      a.erased = true;
      a.version++;
      await saveApplication(db, a, expected);
      await audit(
        db,
        "system:retention",
        "application.erase",
        "application",
        a.id,
        {
          reference: a.reference,
        },
      );
    }
  });
}
let samplesQueued = false;
// Queues an upload for every generated sample the bucket is missing.
async function queueMissingSamples(): Promise<void> {
  if (samplesQueued || !serviceState().storage) return;
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('samples'))");
    for (const sample of generatedSamples()) {
      const queued = await db.query(
        "SELECT 1 FROM jobs WHERE kind='sample_upload' AND payload->>'key'=$1 AND state<>'done'",
        [sample.key],
      );
      if (queued.rowCount) continue;
      if ((await storage("HEAD", sample.key)).ok) continue;
      await enqueueJob(db, "sample_upload", { key: sample.key });
    }
  });
  samplesQueued = true;
}
type Outcome =
  | { kind: "done" }
  | { kind: "unreachable" | "refused"; error: string };
async function attempt(
  id: number,
  kind: JobKind,
  payload: Record<string, unknown>,
): Promise<Outcome> {
  const service = kind === "mail" ? "mail" : "storage";
  try {
    if (kind === "mail") await smtp(id, mailMessage(payload));
    else if (kind === "resume_erase") await deleteObject(String(payload.key));
    else {
      const sample = generatedSamples().find((s) => s.key === payload.key)!;
      await putObject(sample.key, sample.body, sample.type);
    }
    return { kind: "done" };
  } catch (error) {
    return error instanceof MailRefused || error instanceof StorageRefused
      ? { kind: "refused", error: `${service}_refused` }
      : { kind: "unreachable", error: `${service}_unreachable` };
  }
}
const mailMessage = (payload: Record<string, unknown>): MailMessage => ({
  to_name: String(payload.to_name),
  to_email: String(payload.to_email),
  subject: String(payload.subject),
  body: String(payload.body),
});
// Only the holder of the job's current lease may record its outcome.
async function settle(
  id: number,
  lease: string,
  outcome: Outcome,
): Promise<void> {
  if (outcome.kind === "done")
    await pool.query(
      "UPDATE jobs SET state='done',finished_at=now(),lease_until=NULL WHERE id=$1 AND lease_until=$2",
      [id, lease],
    );
  else if (outcome.kind === "unreachable")
    await pool.query(
      "UPDATE jobs SET state='pending',last_error=$2,lease_until=NULL,next_attempt_at=now()+make_interval(secs=>$3) WHERE id=$1 AND lease_until=$4",
      [id, outcome.error, config.outboxRetry, lease],
    );
  else
    await pool.query(
      `UPDATE jobs SET refusals=refusals+1,last_error=$2,lease_until=NULL,
        state=CASE WHEN refusals+1>=$3 THEN 'dead' ELSE 'pending' END,
        finished_at=CASE WHEN refusals+1>=$3 THEN now() END,
        next_attempt_at=now()+make_interval(secs=>LEAST($4*power(2,refusals),$5))
       WHERE id=$1 AND lease_until=$6`,
      [
        id,
        outcome.error,
        config.jobMaxAttempts,
        config.outboxRetry,
        config.outboxRetryMax,
        lease,
      ],
    );
}
// Claims due jobs only for services this instance can currently reach.
async function runJobs(): Promise<void> {
  const { mail, storage: store } = serviceState();
  const kinds = [
    ...(mail ? ["mail"] : []),
    ...(store ? ["resume_erase", "sample_upload"] : []),
  ];
  if (!kinds.length) return;
  for (let n = 0; n < 50; n++) {
    const claimed = await pool.query<{
      id: number;
      kind: JobKind;
      payload: Record<string, unknown>;
      lease: string;
    }>(
      `UPDATE jobs SET state='running',attempts=attempts+1,lease_until=now()+interval '60 seconds'
       WHERE id=(SELECT id FROM jobs WHERE kind=ANY($1) AND ((state='pending' AND next_attempt_at<=now()) OR (state='running' AND lease_until<now()))
                 ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING id::int AS id,kind,payload,lease_until::text AS lease`,
      [kinds],
    );
    const job = claimed.rows[0];
    if (!job) return;
    await settle(
      job.id,
      job.lease,
      await attempt(job.id, job.kind, job.payload),
    );
  }
}
export async function startJobs(): Promise<() => void> {
  await probe();
  const tasks = [
    { fn: probe, ms: 5000 },
    { fn: queueMissingSamples, ms: 5000 },
    { fn: releaseDue, ms: 800 },
    { fn: grantNotices, ms: 5000 },
    { fn: lapseSignoffs, ms: 5000 },
    { fn: eraseRetained, ms: 5000 },
    // Frequent short claims; OUTBOX_RETRY_SECONDS is the upper bound.
    { fn: runJobs, ms: Math.min(config.outboxRetry * 1000, 250) },
  ];
  let stopped = false;
  const timers = new Set<NodeJS.Timeout>();
  // Each sweep waits a random half to whole period before running again, so no instance
  // holds a fixed lead over the others and due work spreads across every capable instance.
  for (const { fn, ms } of tasks) {
    const run = async (): Promise<void> => {
      try {
        await fn();
      } catch (error) {
        console.error(
          "Background task failed",
          error instanceof Error ? error.message : "Unknown error",
        );
      }
      if (stopped) return;
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          void run();
        },
        ms * (0.5 + Math.random() * 0.5),
      );
      timers.add(timer);
    };
    void run();
  }
  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
  };
}
