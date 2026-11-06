// POST /api/jobs: idempotency, access, schema validation, media inputs, credits and caps, and the one
// transaction that creates the job, its reservation movement and its idempotency record.

import { createHash } from "node:crypto";
import type pg from "pg";
import type { Caller } from "../auth";
import { allow } from "../auth";
import { one, pool, single } from "../db";
import { ApiError, fail, invalid } from "../errors";
import { json, stringify, type Reply, type Req } from "../http";
import { amountFor } from "../../shared/money";
import { ASSET_REFERENCE, fieldKind, validateInput, type InputSchema } from "../../shared/schema";
import { UNIT_RULES } from "../../shared/units";
import { markStorageDown, storageDown } from "../services/status";
import { putObject, StorageUnavailable } from "../services/storage";
import { checkImageAddress, EXTENSIONS, fetchImage, FetchRefused, imageSize } from "../services/media";
import type { ImageType } from "../http";
import { resolveAccess } from "./access";
import { insertAsset, loadAssets } from "./assets";
import { balances, postMovement } from "./ledger";
import { mailHardCap, mailSoftCap } from "./notices";
import { budgetPeriod, type BudgetPeriod } from "./period";
import { currentPolicy, teamPolicy, type Policy, type TeamPolicy } from "./policy";
import { claimNotice, hardCapMicro, periodSpend, recordAttempt, softCapMicro } from "./budget";
import { rateAt } from "./rates";
import { assetAccess, loadJobs, projectJob, removal, type Viewer } from "./visibility";

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;
type Priority = keyof typeof PRIORITY_RANK;
const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

interface StoredResponse {
  fingerprint: string;
  status: number;
  response: unknown;
}

async function replayOrConflict(client: pg.PoolClient, teamId: string, key: string, fingerprint: string): Promise<Reply | null> {
  const stored = await one<StoredResponse>(client,
    `SELECT fingerprint, status, response FROM idempotency_keys
     WHERE team_id = $1 AND key = $2 AND created_at > now() - interval '24 hours'`, [teamId, key]);
  if (!stored) return null;
  if (stored.fingerprint !== fingerprint) fail("idempotency_key_reused");
  const job = (stored.response as { job: { id: string } }).job;
  await client.query("INSERT INTO replays (job_id, at) VALUES ($1, now())", [job.id]);
  return json(stored.status, stored.response, { "Idempotent-Replayed": "true" });
}

interface MediaInput {
  field: string;
  reference: string | null;
  url: string | null;
}

interface Checked {
  model: { slug: string; name: string; input_schema: InputSchema };
  priority: Priority;
  input: Record<string, string | number>;
  media: MediaInput[];
}

/** Steps 6 and 8 of the precedence for a submission body. */
async function checkBody(body: Record<string, unknown>, caller: Caller, team: TeamPolicy, policy: Policy, now: Date): Promise<Checked> {
  const model = typeof body.model === "string"
    ? await one<Checked["model"]>(pool, "SELECT slug, name, input_schema FROM models WHERE slug = $1", [body.model])
    : undefined;
  if (model && resolveAccess(policy, team.id, model.slug, caller.context) === "blocked") fail("model_blocked");
  const errors: Record<string, string> = {};
  if (!model) errors.model = "Choose a model from the catalogue.";
  const priority = body.priority ?? "normal";
  if (typeof priority !== "string" || !(priority in PRIORITY_RANK)) errors.priority = "Choose high, normal or low.";
  if (!model) invalid(errors);
  const { input, errors: inputErrors } = validateInput(model.input_schema, body.input);
  for (const [field, message] of Object.entries(inputErrors)) errors[`input.${field}`] = message;
  const media: MediaInput[] = [];
  for (const [field, property] of Object.entries(model.input_schema.properties)) {
    const value = input[field];
    if (fieldKind(property) !== "media" || typeof value !== "string" || inputErrors[field]) continue;
    const reference = ASSET_REFERENCE.exec(value);
    if (reference) {
      const [asset] = await loadAssets(pool, "a.id = $1", [reference[1]]);
      if (!asset || assetAccess(caller, asset, policy) === "hidden" || removal(asset, now)) {
        errors[`input.${field}`] = "That asset is not available. Choose a live asset you can see.";
      } else {
        media.push({ field, reference: asset.id, url: null });
      }
      continue;
    }
    try {
      await checkImageAddress(value);
      media.push({ field, reference: null, url: value });
    } catch (error) {
      if (!(error instanceof FetchRefused)) throw error;
      errors[`input.${field}`] = error.copy;
    }
  }
  if (Object.keys(errors).length) invalid(errors);
  return { model, priority: priority as Priority, input, media };
}

interface Funds {
  reservation: bigint;
  rate: { id: string; micro_per_unit: bigint };
  estimatedUnits: bigint;
  spend: bigint;
}

/** Step 10: 402 when the reservation exceeds available credits, then 429 above the hard cap. */
async function checkFunds(db: pg.PoolClient | pg.Pool, team: TeamPolicy, checked: Checked, period: BudgetPeriod, at: Date): Promise<Funds> {
  const rate = await rateAt(db, checked.model.slug, at);
  const estimatedUnits = UNIT_RULES[checked.model.slug].estimate(checked.input);
  const reservation = amountFor(estimatedUnits, rate.micro_per_unit);
  const { available_micro } = await balances(db, team.id);
  if (reservation > available_micro) {
    fail("insufficient_credits", { required_micro: Number(reservation), available_micro: Number(available_micro) });
  }
  const spend = await periodSpend(db, team.id, period);
  if (spend + reservation > hardCapMicro(team)) fail("budget_hard_cap", { period_ends_at: period.endsAt.toISOString() });
  return { reservation, rate, estimatedUnits, spend };
}

/**
 * A refusal at the funds step is the team's latest attempt: one for the hard cap is remembered for the meter
 * and mailed once per period; one for credits clears the remembered hard-cap refusal.
 */
async function noteHardCap(error: unknown, team: TeamPolicy, period: BudgetPeriod, zone: string): Promise<void> {
  if (!(error instanceof ApiError)) return;
  if (error.code === "insufficient_credits") await recordAttempt(pool, team.id, period, false);
  if (error.code !== "budget_hard_cap") return;
  await recordAttempt(pool, team.id, period, true);
  if (await claimNotice(pool, team.id, period, "hard")) await mailHardCap(team, period, zone);
}

/** Fetches each image URL input and stores it as an upload asset owned by the submitter. */
async function storeUrlInputs(caller: Caller, media: MediaInput[], policy: Policy): Promise<string[]> {
  const ids: string[] = [];
  for (const item of media) {
    if (item.reference) {
      ids.push(item.reference);
      continue;
    }
    let image: { type: ImageType; bytes: Buffer };
    try {
      image = await fetchImage(item.url as string);
    } catch (error) {
      if (error instanceof FetchRefused) invalid({ [`input.${item.field}`]: error.copy });
      throw error;
    }
    ids.push(await storeUpload(caller, image.type, image.bytes, policy));
  }
  return ids;
}

/** Writes an upload object, then its asset row; a failed write is 503 and leaves nothing behind. */
export async function storeUpload(caller: Viewer, type: ImageType, bytes: Buffer, policy: Policy): Promise<string> {
  const teamId = caller.team_id as string;
  const { n } = await single<{ n: bigint }>(pool, "SELECT nextval('asset_number') AS n");
  const id = `a_${n}`;
  const key = `uploads/${teamId}/${id}.${EXTENSIONS[type]}`;
  try {
    await putObject(key, bytes, type);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    markStorageDown();
    fail("storage_unavailable");
  }
  const size = imageSize(type, bytes);
  return insertAsset(pool, {
    number: n, teamId, kind: "upload", mediaType: type, jobId: null, outputIndex: null, ownerId: caller.id,
    width: size.width, height: size.height, durationSeconds: null, bytes: bytes.length, objectKey: key,
  }, policy, new Date());
}

interface Submitted {
  reply: Reply;
  created: boolean;
}

export async function submitJob(req: Req, caller: Caller): Promise<Submitted> {
  const header = req.headers["idempotency-key"];
  const key = typeof header === "string" ? header : null;
  if ((caller.context === "api" && key === null) || (key !== null && !KEY_PATTERN.test(key))) fail("idempotency_key_required");
  const body = req.json !== null && typeof req.json === "object" && !Array.isArray(req.json) ? req.json as Record<string, unknown> : {};
  const fingerprint = createHash("sha256")
    .update(canonical({ model: body.model ?? null, input: body.input ?? null, priority: body.priority ?? "normal" }))
    .digest("hex");
  const client = await pool.connect();
  const lock = key !== null && caller.team_id !== null ? `${caller.team_id}\n${key}` : null;
  try {
    if (lock) {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lock]);
      const replay = await replayOrConflict(client, caller.team_id as string, key as string, fingerprint);
      if (replay) return { reply: replay, created: false };
    }
    allow(caller, "member");
    const now = new Date();
    const policy = await currentPolicy(client);
    const team = teamPolicy(policy, caller.team_id as string);
    const period = budgetPeriod(now, policy.timezone);
    const checked = await checkBody(body, caller, team, policy, now);
    try {
      await checkFunds(client, team, checked, period, now);
    } catch (error) {
      await noteHardCap(error, team, period, policy.timezone);
      throw error;
    }
    if (checked.media.some((m) => m.url) && storageDown()) fail("storage_unavailable");
    const inputAssets = await storeUrlInputs(caller, checked.media, policy);
    const outcome = await create(client, caller, team, policy, checked, inputAssets, key, fingerprint);
    if (outcome.softCapCrossed) await mailSoftCap(team, period, outcome.spendAfter, softCapMicro(team));
    return { reply: outcome.reply, created: true };
  } finally {
    if (lock) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lock]);
    client.release();
  }
}

async function create(
  client: pg.PoolClient, caller: Caller, team: TeamPolicy, policy: Policy, checked: Checked,
  inputAssets: string[], key: string | null, fingerprint: string,
): Promise<{ reply: Reply; softCapCrossed: boolean; spendAfter: bigint }> {
  await client.query("BEGIN");
  const submittedAt = new Date();
  const period = budgetPeriod(submittedAt, policy.timezone);
  let funds: Funds;
  try {
    await client.query("SELECT id FROM teams WHERE id = $1 FOR UPDATE", [team.id]);
    funds = await checkFunds(client, team, checked, period, submittedAt);
  } catch (error) {
    await client.query("ROLLBACK");
    await noteHardCap(error, team, period, policy.timezone);
    throw error;
  }
  try {
    const { n } = await single<{ n: bigint }>(client, "SELECT nextval('job_number') AS n");
    const jobId = `j_${n}`;
    await client.query(
      `INSERT INTO jobs (number, id, team_id, model, status, priority, priority_rank, submitted_by, submitted_at,
         submitted_context, rate_id, rate_micro, unit, estimated_units_micro, reserved_micro, input, input_assets)
       VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $16, $9, $10, $11, $12, $13, $14, $15)`,
      [n, jobId, team.id, checked.model.slug, checked.priority, PRIORITY_RANK[checked.priority], caller.id, submittedAt,
        funds.rate.id, funds.rate.micro_per_unit, UNIT_RULES[checked.model.slug].unit, funds.estimatedUnits,
        funds.reservation, stringify(checked.input), inputAssets, caller.context]);
    await postMovement(client, { teamId: team.id, kind: "reserve", amount: funds.reservation, at: submittedAt, jobId });
    await recordAttempt(client, team.id, period, false);
    const [job] = await loadJobs(client, "j.id = $1", [jobId]);
    const response = { job: projectJob(job, caller, policy, storageDown()) };
    if (key !== null) {
      await client.query(
        `INSERT INTO idempotency_keys (team_id, key, fingerprint, status, response, created_at) VALUES ($1, $2, $3, 201, $4, now())
         ON CONFLICT (team_id, key) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, status = 201,
           response = EXCLUDED.response, created_at = EXCLUDED.created_at`,
        [team.id, key, fingerprint, stringify(response)]);
    }
    const spendAfter = funds.spend + funds.reservation;
    const softCapCrossed = spendAfter >= softCapMicro(team) && await claimNotice(client, team.id, period, "soft");
    await client.query("COMMIT");
    return { reply: json(201, response), softCapCrossed, spendAfter };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
