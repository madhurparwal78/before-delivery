// Job submission, idempotency, cancellation and final-state settlement.
import type { Pool, Tx } from "./db.js";
import {
  recordMovement, reservationMicro, payloadVisibleTo,
  projectJob, type JobRow, type MemberRow, type Context, type PeriodInfo, type AssetRow,
} from "./domain.js";
import { hashRequest } from "./schema.js";
import { effectiveInput, validateInput, type FieldError } from "./validate.js";
import { modelBySlug, estimatedUnits, type ModelDef } from "../shared/models.js";

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly fields?: Record<string, string>;
  public readonly extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }
}

export interface SubmitOutcome {
  jobId: string;
  replayed: boolean;
  responseBody: unknown;
}

export interface SubmitRequest {
  teamId: string;
  submitter: MemberRow;
  model: string;
  input: Record<string, unknown>;
  priority: "high" | "normal" | "low";
  idempotencyKey: string | null;
  context: Context;
}

interface KeyRecord {
  state: string;
  request_hash: string;
  response_body: unknown;
  job_id: string | null;
}

export interface Deps {
  resolveAccess(teamId: string, slug: string, context: Context): Promise<"allowed" | "blocked">;
  rateAt(slug: string, at: Date): Promise<{ id: string; micro_per_unit: number }>;
  availableMicro(teamId: string): Promise<number>;
  periodFor(teamId: string): Promise<PeriodInfo>;
  periodSpend(teamId: string, period: PeriodInfo): Promise<{ spendMicro: number }>;
  storageUp(): Promise<boolean>;
  checkAddress(url: string): Promise<boolean>;
  fetchImage(url: string, teamId: string, uploader: MemberRow): Promise<{ assetId?: string; error?: string }>;
  visibleAsset(assetId: string, caller: MemberRow): Promise<AssetRow | null>;
  onHardCapRefusal(teamId: string, period: PeriodInfo): Promise<void>;
}

/**
 * Submit a job. The job, its reservation movement and its idempotency record
 * commit in one transaction; concurrent duplicates wait for the winner and
 * replay its response. A stored replay is answered before anything else is checked.
 */
export async function submitJob(pool: Pool, req: SubmitRequest, deps: Deps): Promise<SubmitOutcome> {
  const model = modelBySlug(req.model);
  if (!model) throw new ApiError(404, "not_found", "That model does not exist.");

  const requestHash = hashRequest(req.model, req.input, req.priority);

  // Idempotency first: a stored replay is answered even when the request
  // would now be refused.
  let heldKey = false;
  if (req.idempotencyKey) {
    const hold = await holdKey(pool, req.teamId, req.idempotencyKey, requestHash, req.submitter);
    if (hold.kind === "replay") return hold.outcome;
    heldKey = true;
  }
  const releaseKey = async () => {
    if (req.idempotencyKey && heldKey) {
      await pool.exec(`DELETE FROM idempotency_keys WHERE team_id = $1 AND key = $2`, [req.teamId, req.idempotencyKey]);
    }
  };

  // Precedence: 404 unknown model, then 403 model_blocked, then 422 schema and
  // static media checks, then 402 credits, then 429 the hard cap, then 503
  // storage for URL fetches.
  const modelAccess = await deps.resolveAccess(req.teamId, model.slug, req.context);
  if (modelAccess === "blocked") {
    await releaseKey();
    throw new ApiError(403, "model_blocked", `${model.name} is blocked for ${req.context === "api" ? "API" : "playground"} runs.`);
  }

  const errors: FieldError[] = validateInput(model, req.input);
  const input = effectiveInput(model, req.input);

  // Static media checks: asset references must be live and visible; URL
  // addresses must be public. Fetching happens after the credit checks.
  const staticMedia = await checkMediaStatic(req, model, input, deps);
  errors.push(...staticMedia.errors);
  if (errors.length > 0) {
    await releaseKey();
    throw validationError(errors);
  }

  const submittedAt = new Date();
  const rate = await deps.rateAt(model.slug, submittedAt);
  const reserved = reservationMicro(model.slug, staticMedia.input, rate.micro_per_unit);

  // Credits and hard cap.
  const available = await deps.availableMicro(req.teamId);
  if (reserved > available) {
    await releaseKey();
    throw new ApiError(402, "insufficient_credits", "Not enough credits for this run.", undefined, {
      required_micro: reserved,
      available_micro: available,
    });
  }
  const period = await deps.periodFor(req.teamId);
  const spend = await deps.periodSpend(req.teamId, period);
  if (spend.spendMicro + reserved > period.hardCapMicro) {
    await pool.exec(`INSERT INTO refusals (team_id, reason) VALUES ($1,'budget_hard_cap')`, [req.teamId]);
    await deps.onHardCapRefusal(req.teamId, period);
    await releaseKey();
    throw new ApiError(429, "budget_hard_cap", "The team reached its hard cap for this period.", undefined, {
      period_ends_at: period.endsAt,
    });
  }

  // Fetch image URLs now; storage must be up.
  const resolved = await fetchMediaUrls(req, model, staticMedia.input, deps);
  if (resolved.errors.length > 0) {
    await releaseKey();
    throw validationError(resolved.errors);
  }

  const units = estimatedUnits(model, resolved.input);
  // Text-only inputs still queue during a storage outage.
  const storageUp = await deps.storageUp();
  const waitingReason = storageUp ? null : "storage_unavailable";

  const jobId = await pool.tx(async (tx) => {
    const avail = await availableMicroTx(tx, req.teamId);
    if (reserved > avail) {
      throw new ApiError(402, "insufficient_credits", "Not enough credits for this run.", undefined, {
        required_micro: reserved,
        available_micro: avail,
      });
    }
    const seq = await tx.one<{ nextval: number }>(`SELECT nextval('job_seq') AS nextval`);
    const id = `j_${seq?.nextval}`;
    await tx.exec(
      `INSERT INTO jobs (id, team_id, model_slug, status, priority, submitted_by, submitted_at, attempts,
        rate_id, est_num, est_den, reserved_micro, input, context, waiting_reason)
       VALUES ($1,$2,$3,'queued',$4,$5,$6,0,$7,$8,$9,$10,$11,$12,$13)`,
      [id, req.teamId, model.slug, req.priority, req.submitter.id, submittedAt,
       rate.id, units.num, units.den, reserved, JSON.stringify(resolved.input), req.context, waitingReason],
    );
    await recordMovement(tx, req.teamId, "reserve",
      { account: "available", amountMicro: reserved },
      { account: "reserved", amountMicro: reserved },
      { jobId: id });
    if (req.idempotencyKey) {
      await tx.exec(`UPDATE idempotency_keys SET state = 'ready' WHERE team_id = $1 AND key = $2`, [req.teamId, req.idempotencyKey]);
    }
    return id;
  }).catch(async (e) => {
    await releaseKey();
    throw e;
  });

  const job = await jobById(pool, jobId);
  const projection = projectJob(job, true, 1);
  projection.outputs = await outputsOf(pool, jobId);
  const body = { job: projection };
  if (req.idempotencyKey) {
    await pool.exec(
      `UPDATE idempotency_keys SET response_status = 201, response_body = $3, job_id = $4 WHERE team_id = $1 AND key = $2`,
      [req.teamId, req.idempotencyKey, JSON.stringify(body), jobId],
    );
  }
  return { jobId, replayed: false, responseBody: body };
}

async function availableMicroTx(tx: Tx, teamId: string): Promise<number> {
  const row = await tx.one<{ total: bigint }>(
    `SELECT COALESCE(sum(amount_micro),0)::bigint AS total FROM ledger_entries
     WHERE account = 'available' AND movement_id IN (SELECT id FROM ledger_movements WHERE team_id = $1)`,
    [teamId],
  );
  return Number(row?.total ?? 0n);
}

type HoldResult =
  | { kind: "held" }
  | { kind: "replay"; outcome: SubmitOutcome };

/** Hold the idempotency key, or resolve to the winner's replay (or a reuse conflict). */
async function holdKey(
  pool: Pool,
  teamId: string,
  key: string,
  requestHash: string,
  submitter: MemberRow,
): Promise<HoldResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const inserted = await pool.exec(
      `INSERT INTO idempotency_keys (team_id, key, request_hash, state) VALUES ($1,$2,$3,'in_progress')
       ON CONFLICT (team_id, key) DO NOTHING`,
      [teamId, key, requestHash],
    );
    if (inserted > 0) return { kind: "held" };
    for (let i = 0; i < 400; i++) {
      const row = await pool.one<KeyRecord>(
        `SELECT state, request_hash, response_body, job_id FROM idempotency_keys WHERE team_id = $1 AND key = $2`,
        [teamId, key],
      );
      if (!row) break; // the holder refused and freed the key: try to hold again
      if (row.state === "ready") {
        if (row.request_hash !== requestHash) {
          throw new ApiError(409, "idempotency_key_reused", "This idempotency key was used with a different request body.");
        }
        return { kind: "replay", outcome: await replayStored(pool, submitter, row.job_id, row.response_body) };
      }
      await sleep(25);
    }
  }
  throw new ApiError(409, "idempotency_key_reused", "This idempotency key is in use with a different request body.");
}

/** A replay returns the stored response, re-projected for the caller's visibility. */
async function replayStored(
  pool: Pool,
  submitter: MemberRow,
  jobId: string | null,
  stored: unknown,
): Promise<SubmitOutcome> {
  if (!jobId || !stored) throw new ApiError(409, "idempotency_key_reused", "This idempotency key was used with a different request body.");
  const job = await jobById(pool, jobId);
  const visible = await payloadVisibleTo(pool, job, submitter);
  const body = stored as { job: Record<string, unknown> };
  if (visible) return { jobId, replayed: true, responseBody: body };
  const restricted = { ...body.job };
  delete restricted.input;
  delete restricted.input_assets;
  restricted.payload_visible = false;
  return { jobId, replayed: true, responseBody: { job: restricted } };
}

export function validationError(errors: FieldError[]): ApiError {
  const fields: Record<string, string> = {};
  for (const e of errors) fields[e.path] = e.message;
  return new ApiError(422, "validation_failed", "Fix the highlighted fields.", fields);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Static media checks: asset references live and visible; URL addresses public. */
async function checkMediaStatic(
  req: SubmitRequest,
  model: ModelDef,
  input: Record<string, unknown>,
  deps: Deps,
): Promise<{ input: Record<string, unknown>; errors: FieldError[] }> {
  const errors: FieldError[] = [];
  for (const field of model.fields) {
    if (field.type !== "media") continue;
    const value = input[field.name];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string") {
      errors.push({ path: `input.${field.name}`, message: "Enter an image URL or an asset reference." });
      continue;
    }
    if (value.startsWith("asset:")) {
      const assetId = value.slice("asset:".length);
      const asset = await deps.visibleAsset(assetId, req.submitter);
      if (!asset || asset.state !== "live") {
        errors.push({ path: `input.${field.name}`, message: "That asset could not be found." });
      }
      continue;
    }
    const publicAddress = await deps.checkAddress(value);
    if (!publicAddress) {
      errors.push({ path: `input.${field.name}`, message: "This address is not allowed. Use a public address." });
    }
  }
  return { input, errors };
}

/** Fetch image URLs and store them as upload assets; storage must be up. */
async function fetchMediaUrls(
  req: SubmitRequest,
  model: ModelDef,
  input: Record<string, unknown>,
  deps: Deps,
): Promise<{ input: Record<string, unknown>; errors: FieldError[] }> {
  const out = { ...input };
  const errors: FieldError[] = [];
  let hasUrl = false;
  for (const field of model.fields) {
    if (field.type !== "media") continue;
    const value = out[field.name];
    if (typeof value !== "string" || value === "" || value.startsWith("asset:")) continue;
    hasUrl = true;
  }
  if (!hasUrl) return { input: out, errors };
  if (!(await deps.storageUp())) {
    throw new ApiError(503, "storage_unavailable", "Storage is unreachable, so the image could not be saved. Nothing was reserved.");
  }
  for (const field of model.fields) {
    if (field.type !== "media") continue;
    const value = out[field.name];
    if (typeof value !== "string" || value === "" || value.startsWith("asset:")) continue;
    const fetched = await deps.fetchImage(value, req.teamId, req.submitter);
    if (fetched.error) {
      errors.push({ path: `input.${field.name}`, message: fetched.error });
    } else if (fetched.assetId) {
      out[field.name] = `asset:${fetched.assetId}`;
    }
  }
  return { input: out, errors };
}

async function outputsOf(pool: Pool, jobId: string): Promise<string[]> {
  const rows = await pool.many<{ asset_id: string }>(
    `SELECT asset_id FROM job_outputs WHERE job_id = $1 ORDER BY n`, [jobId],
  );
  return rows.map((r) => r.asset_id);
}

export async function jobById(pool: Pool, id: string): Promise<JobRow> {
  const row = await pool.one<Record<string, unknown>>(
    `SELECT j.*, mem.name AS submitted_by_name, r.micro_per_unit::bigint AS rate_micro
     FROM jobs j JOIN members mem ON mem.id = j.submitted_by
     JOIN rates r ON r.id = j.rate_id WHERE j.id = $1`,
    [id],
  );
  if (!row) throw new ApiError(404, "not_found", "That job does not exist.");
  return jobRowFrom(row);
}

export function jobRowFrom(r: Record<string, unknown>): JobRow {
  return {
    id: r.id as string,
    team_id: r.team_id as string,
    model_slug: r.model_slug as string,
    status: r.status as JobRow["status"],
    priority: r.priority as JobRow["priority"],
    submitted_by: r.submitted_by as string,
    submitted_by_name: (r.submitted_by_name as string) ?? "",
    submitted_at: r.submitted_at as Date,
    started_at: (r.started_at as Date | null) ?? null,
    finished_at: (r.finished_at as Date | null) ?? null,
    attempts: Number(r.attempts ?? 0),
    failure_reason: (r.failure_reason as string | null) ?? null,
    waiting_reason: (r.waiting_reason as string | null) ?? null,
    rate_id: r.rate_id as string,
    micro_per_unit: Number(r.rate_micro ?? 0),
    est_num: BigInt(r.est_num as string),
    est_den: BigInt(r.est_den as string),
    billed_num: r.billed_num === null ? null : BigInt(r.billed_num as string),
    billed_den: r.billed_den === null ? null : BigInt(r.billed_den as string),
    reserved_micro: Number(r.reserved_micro),
    charged_micro: r.charged_micro === null ? null : Number(r.charged_micro),
    released_micro: Number(r.released_micro ?? 0),
    input: r.input,
    context: (r.context as Context) ?? "api",
  };
}

/** Cancel a job: queued, leased or running release the whole reservation. */
export async function cancelJob(pool: Pool, jobId: string): Promise<{ job: JobRow; released: number; alreadyCancelled: boolean }> {
  return pool.tx(async (tx) => {
    const row = await tx.one<Record<string, unknown>>(
      `SELECT j.*, mem.name AS submitted_by_name, r.micro_per_unit::bigint AS rate_micro FROM jobs j
       JOIN members mem ON mem.id = j.submitted_by JOIN rates r ON r.id = j.rate_id WHERE j.id = $1 FOR UPDATE`,
      [jobId],
    );
    if (!row) throw new ApiError(404, "not_found", "That job does not exist.");
    const job = jobRowFrom(row);
    if (job.status === "cancelled") return { job, released: 0, alreadyCancelled: true };
    if (job.status === "succeeded" || job.status === "failed") {
      throw new ApiError(409, "job_not_cancellable", `Job ${jobId} already ${job.status}; nothing to cancel.`, undefined, { status: job.status });
    }
    const released = job.reserved_micro - job.released_micro;
    await tx.exec(
      `UPDATE jobs SET status = 'cancelled', finished_at = now(), waiting_reason = NULL, lease_expires_at = NULL WHERE id = $1`,
      [jobId],
    );
    if (released > 0) {
      await tx.exec(`UPDATE jobs SET released_micro = released_micro + $2 WHERE id = $1`, [jobId, released]);
      await recordMovement(tx, job.team_id, "release",
        { account: "reserved", amountMicro: released },
        { account: "available", amountMicro: released },
        { jobId });
    }
    const fresh = await tx.one<Record<string, unknown>>(
      `SELECT j.*, mem.name AS submitted_by_name, r.micro_per_unit::bigint AS rate_micro FROM jobs j
       JOIN members mem ON mem.id = j.submitted_by JOIN rates r ON r.id = j.rate_id WHERE j.id = $1`,
      [jobId],
    );
    return { job: jobRowFrom(fresh as Record<string, unknown>), released, alreadyCancelled: false };
  });
}
