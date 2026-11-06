// The dispatcher: fills free concurrency slots per team in dispatch order, runs each leased job for
// JOB_RUN_SECONDS while renewing its lease, writes every output before success, and returns lapsed leases.

import { reason } from "../log";
import type pg from "pg";
import { config } from "../config";
import { pool, rows, single, tx } from "../db";
import { finishJob, moveJob } from "../domain/lifecycle";
import { resolveAccess } from "../domain/access";
import { currentPolicy } from "../domain/policy";
import { loadJobs, removal, type JobRow } from "../domain/visibility";
import { insertAsset, loadAssets } from "../domain/assets";
import { UNIT_RULES } from "../../shared/units";
import { EXTENSIONS, placeholderPng, placeholderWav, placeholderWebm } from "../services/media";
import { markStorageDown, storageDown } from "../services/status";
import { deleteObject, putObject, StorageUnavailable } from "../services/storage";
import { loop } from "./loop";
import { nudgeWebhooks } from "./webhooks";

const TICK_MS = 500;
const LAPSES_BEFORE_FAILURE = 3;
const leaseInterval = `make_interval(secs => ${config.leaseSeconds})`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function lockJob(client: pg.PoolClient, id: string): Promise<JobRow> {
  const [job] = await loadJobs(client, "j.id = $1", [id], "FOR UPDATE OF j");
  return job;
}

/**
 * Leases queued jobs into free slots in dispatch order; the team row lock makes each claim atomic. A job
 * whose model is now blocked for the context it was submitted in fails instead, and the slot goes on.
 */
async function claim(): Promise<string[]> {
  const policy = await currentPolicy(pool);
  const claimed: string[] = [];
  let notify = false;
  for (const team of policy.teams) {
    const leased = await tx(async (client) => {
      await client.query("SELECT id FROM teams WHERE id = $1 FOR UPDATE", [team.id]);
      const { active } = await single<{ active: number }>(client,
        "SELECT count(*)::int AS active FROM jobs WHERE team_id = $1 AND status IN ('leased', 'running')", [team.id]);
      const ids: string[] = [];
      while (active + ids.length < team.concurrency) {
        const [next] = await loadJobs(client,
          "j.team_id = $1 AND j.status = 'queued' ORDER BY j.priority_rank, j.submitted_at, j.number LIMIT 1", [team.id], "FOR UPDATE OF j");
        if (!next) break;
        if (resolveAccess(policy, team.id, next.model, next.submitted_context) === "blocked") {
          notify = (await finishJob(client, next, { status: "failed", reason: "model_blocked" }, new Date())) || notify;
          continue;
        }
        await moveJob(client, next, "leased", { attempts: next.attempts + 1, lease_expires_at: new Date(Date.now() + config.leaseSeconds * 1000) });
        ids.push(next.id);
      }
      return ids;
    });
    claimed.push(...leased);
  }
  if (notify) nudgeWebhooks();
  return claimed;
}

/** A lease that was not renewed sends its job back to the queue; the third lapse fails it. */
async function returnLapsed(): Promise<boolean> {
  const lapsed = await rows<{ id: string }>(pool,
    "SELECT id FROM jobs WHERE status IN ('leased', 'running') AND lease_expires_at < now()");
  let notify = false;
  for (const { id } of lapsed) {
    notify = await tx(async (client) => {
      const job = await lockJob(client, id);
      if ((job.status !== "leased" && job.status !== "running") || (job.lease_expires_at as Date) >= new Date()) return false;
      if (job.lapses + 1 >= LAPSES_BEFORE_FAILURE) {
        await client.query("UPDATE jobs SET lapses = lapses + 1 WHERE id = $1", [id]);
        return finishJob(client, job, { status: "failed", reason: "lease_expired" }, new Date());
      }
      await moveJob(client, job, "queued", { lapses: job.lapses + 1, lease_expires_at: null });
      return false;
    }) || notify;
  }
  return notify;
}

/** leased → running, or failed when an input asset is gone at run start. */
async function begin(id: string): Promise<JobRow | null> {
  let notify = false;
  const job = await tx(async (client) => {
    const leased = await lockJob(client, id);
    if (leased.status !== "leased") return null;
    const now = new Date();
    const inputs = leased.input_assets.length ? await loadAssets(client, "a.id = ANY($1)", [leased.input_assets]) : [];
    if (inputs.some((asset) => removal(asset, now))) {
      notify = await finishJob(client, leased, { status: "failed", reason: "input_deleted" }, now);
      return null;
    }
    await moveJob(client, leased, "running", { started_at: now, lease_expires_at: new Date(now.getTime() + config.leaseSeconds * 1000) });
    return leased;
  });
  if (notify) nudgeWebhooks();
  return job;
}

/** Waits out the run, renewing the lease; false when the job stopped running meanwhile. */
async function hold(id: string): Promise<boolean> {
  const renewMs = Math.max(1, config.leaseSeconds / 3) * 1000;
  const end = Date.now() + config.jobRunSeconds * 1000;
  for (let left = end - Date.now(); left > 0; left = end - Date.now()) {
    await sleep(Math.min(renewMs, left));
    const renewed = await pool.query(
      `UPDATE jobs SET lease_expires_at = now() + ${leaseInterval} WHERE id = $1 AND status = 'running'`, [id]);
    if (renewed.rowCount === 0) return false;
  }
  return true;
}

interface Output {
  mediaType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  render: () => Promise<Buffer>;
}

/** The placeholder media each model produces for a job. */
function outputsOf(job: JobRow, billedUnitsMicro: bigint): Output[] {
  const input = job.input;
  const seed = Number(job.number);
  if (job.model === "reel-10") {
    const seconds = Number(input.duration_seconds);
    return [{ mediaType: "video/webm", width: 1280, height: 720, durationSeconds: seconds, render: async () => placeholderWebm(seconds) }];
  }
  if (job.model === "murmur-voice") {
    const seconds = Number(billedUnitsMicro / 1_000_000n);
    return [{ mediaType: "audio/wav", width: null, height: null, durationSeconds: seconds, render: async () => placeholderWav(seconds) }];
  }
  const width = job.model === "halftone-xl" ? Number(input.width) : 1024;
  const height = job.model === "halftone-xl" ? Number(input.height) : 1024;
  return Array.from({ length: Number(input.num_images) }, (_, i) => ({
    mediaType: "image/png", width, height, durationSeconds: null, render: () => placeholderPng(width, height, seed + i),
  }));
}

async function finishRun(id: string, outcome: (client: pg.PoolClient, job: JobRow) => Promise<boolean>): Promise<boolean> {
  let stillRunning = false;
  const notify = await tx(async (client) => {
    const job = await lockJob(client, id);
    if (job.status !== "running") return false;
    stillRunning = true;
    return outcome(client, job);
  });
  if (notify) nudgeWebhooks();
  return stillRunning;
}

async function run(id: string): Promise<void> {
  const job = await begin(id);
  if (!job || !(await hold(id))) return;
  const billedUnitsMicro = UNIT_RULES[job.model].bill(job.input);
  const outputs = outputsOf(job, billedUnitsMicro);
  const written: Array<{ key: string; bytes: number }> = [];
  try {
    for (const [index, output] of outputs.entries()) {
      const key = `outputs/${job.team_id}/${job.id}/${index + 1}.${EXTENSIONS[output.mediaType]}`;
      const bytes = await output.render();
      await putObject(key, bytes, output.mediaType);
      written.push({ key, bytes: bytes.length });
    }
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    markStorageDown();
    await Promise.allSettled(written.map((w) => deleteObject(w.key)));
    await finishRun(id, (client, current) =>
      finishJob(client, current, { status: "failed", reason: "storage_unavailable" }, new Date()));
    return;
  }
  const succeeded = await finishRun(id, async (client, current) => {
    const now = new Date();
    const policy = await currentPolicy(client);
    for (const [index, output] of outputs.entries()) {
      const { n } = await single<{ n: bigint }>(client, "SELECT nextval('asset_number') AS n");
      const assetId = await insertAsset(client, {
        number: n, teamId: current.team_id, kind: "output", mediaType: output.mediaType, jobId: current.id,
        outputIndex: index + 1, ownerId: current.submitted_by, width: output.width, height: output.height,
        durationSeconds: output.durationSeconds, bytes: written[index].bytes, objectKey: written[index].key,
      }, policy, now);
      for (const input of current.input_assets) {
        await client.query("INSERT INTO asset_edges (from_asset, to_asset) VALUES ($1, $2)", [input, assetId]);
      }
    }
    return finishJob(client, current, { status: "succeeded", billedUnitsMicro }, now);
  });
  if (!succeeded) await Promise.allSettled(written.map((w) => deleteObject(w.key)));
}

async function pass(): Promise<void> {
  if (await returnLapsed()) nudgeWebhooks();
  if (storageDown()) return;
  for (const id of await claim()) {
    run(id).catch((error: unknown) => console.error(`job ${id} run failed: ${reason(error)}`))
      .finally(() => dispatcher.nudge());
  }
}

const dispatcher = loop("dispatch", TICK_MS, pass);
export const startDispatcher = dispatcher.start;
/** Runs a dispatch pass now instead of at the next tick. */
export const nudgeDispatcher = dispatcher.nudge;
