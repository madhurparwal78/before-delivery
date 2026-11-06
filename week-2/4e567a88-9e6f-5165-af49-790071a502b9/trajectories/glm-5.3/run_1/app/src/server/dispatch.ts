// The dispatcher: claims concurrency slots, runs jobs, stores outputs, settles.
import type { Pool } from "./db.js";
import { recordMovement, resolveAccess, type JobRow } from "./domain.js";
import { jobRowFrom, jobById } from "./jobs.js";
import { billableUnits, chargeMicro } from "./domain.js";
import { modelDef } from "./domain.js";
import { placeholderPng, placeholderWav, placeholderVideo } from "./placeholder.js";
import type { Storage } from "./storage.js";
import type { Config } from "./config.js";

export interface DispatchDeps {
  storage: Storage;
  storageUp(): Promise<boolean>;
  onJobFinal(jobId: string): Promise<void>;
}

interface OutputPlan {
  n: number;
  key: string;
  mediaType: string;
  width: number | null;
  height: number | null;
  duration: string | null;
  bytes: number;
}

interface RunHandle {
  jobId: string;
  timer: NodeJS.Timeout | null;
  renew: NodeJS.Timeout | null;
}

export class Dispatcher {
  private runs = new Map<string, RunHandle>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private pool: Pool, private cfg: Config, private deps: DispatchDeps) {}

  start(): void {
    this.stopped = false;
    this.tick();
    this.timer = setInterval(() => this.tick(), 500);
    this.sweeperTick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.sweeperTimer) clearInterval(this.sweeperTimer);
    for (const run of this.runs.values()) {
      if (run.timer) clearTimeout(run.timer);
      if (run.renew) clearInterval(run.renew);
    }
    this.runs.clear();
  }

  private sweeperTimer: NodeJS.Timeout | null = null;

  private sweeperTick(): void {
    this.sweeperTimer = setInterval(() => void this.handleLapses(), 2_000);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.dispatchOnce();
      await this.clearWaiting();
    } catch {
      // The next tick retries.
    }
  }

  /** Lease queued jobs into free concurrency slots, one claim at a time. */
  private async dispatchOnce(): Promise<void> {
    for (let guard = 0; guard < 50; guard++) {
      const storageUp = await this.deps.storageUp();
      if (!storageUp) return;
      const teams = await this.pool.many<{ id: string; concurrency: number }>(
        `SELECT id, concurrency FROM teams`,
      );
      let leasedAny = false;
      for (const team of teams) {
        const active = await this.pool.one<{ n: number }>(
          `SELECT count(*)::int AS n FROM jobs WHERE team_id = $1 AND status IN ('leased','running')`,
          [team.id],
        );
        const activeN = active?.n ?? 0;
        if (activeN >= team.concurrency) continue;
        const queued = await this.pool.many<Record<string, unknown>>(
          `SELECT j.*, mem.name AS submitted_by_name, r.micro_per_unit::bigint AS rate_micro FROM jobs j
           JOIN members mem ON mem.id = j.submitted_by JOIN rates r ON r.id = j.rate_id
           WHERE j.team_id = $1 AND j.status = 'queued'
           ORDER BY CASE j.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, j.submitted_at ASC, j.id ASC
           LIMIT $2`,
          [team.id, team.concurrency - activeN],
        );
        for (const row of queued) {
          const job = jobRowFrom(row);
          // A queued job whose model has since been blocked fails instead of starting.
          const access = await resolveAccess(this.pool, team.id, job.model_slug, job.context);
          if (access === "blocked") {
            await this.failJob(job, "model_blocked");
            leasedAny = true;
            continue;
          }
          const claimed = await this.pool.tx(async (tx) => {
            const still = await tx.one<{ status: string; n: number }>(
              `SELECT status, (SELECT count(*)::int FROM jobs WHERE team_id = $1 AND status IN ('leased','running')) AS n
               FROM jobs WHERE id = $2 FOR UPDATE`,
              [team.id, job.id],
            );
            if (!still || still.status !== "queued" || still.n >= team.concurrency) return false;
            await tx.exec(
              `UPDATE jobs SET status = 'leased', attempts = attempts + 1, waiting_reason = NULL,
               started_at = now(), lease_expires_at = now() + make_interval(secs => $2) WHERE id = $1`,
              [job.id, this.cfg.leaseSeconds],
            );
            return true;
          });
          if (claimed) {
            leasedAny = true;
            this.runLeased(job.id);
          }
        }
      }
      if (!leasedAny) return;
    }
  }

  /** Clear waiting_reason markers when storage is back (dispatch drains them). */
  private async clearWaiting(): Promise<void> {
    const up = await this.deps.storageUp();
    if (up) {
      await this.pool.exec(
        `UPDATE jobs SET waiting_reason = NULL WHERE status = 'queued' AND waiting_reason = 'storage_unavailable'`,
      );
    } else {
      await this.pool.exec(
        `UPDATE jobs SET waiting_reason = 'storage_unavailable' WHERE status = 'queued' AND waiting_reason IS NULL`,
      );
    }
  }

  /** Run a leased job: wait the run duration, then store outputs and settle. */
  private runLeased(jobId: string): void {
    if (this.runs.has(jobId)) return;
    const renew = setInterval(() => {
      void this.pool
        .exec(`UPDATE jobs SET lease_expires_at = now() + make_interval(secs => $2) WHERE id = $1 AND status IN ('leased','running')`, [jobId, this.cfg.leaseSeconds])
        .catch(() => undefined);
    }, Math.max(1, Math.floor(this.cfg.leaseSeconds / 3)) * 1000);
    const handle: RunHandle = { jobId, timer: null, renew };
    this.runs.set(jobId, handle);
    handle.timer = setTimeout(() => void this.complete(jobId), this.cfg.jobRunSeconds * 1000);
  }

  /** Mark running, write outputs, then settle or fail. */
  private async complete(jobId: string): Promise<void> {
    const handle = this.runs.get(jobId);
    if (!handle) return;
    this.runs.delete(jobId);
    if (handle.renew) clearInterval(handle.renew);
    try {
      const running = await this.pool.tx(async (tx) => {
        const row = await tx.one<{ status: string }>(`SELECT status FROM jobs WHERE id = $1 FOR UPDATE`, [jobId]);
        if (!row || row.status !== "leased") return false;
        await tx.exec(`UPDATE jobs SET status = 'running' WHERE id = $1`, [jobId]);
        return true;
      });
      if (!running) return;
      const job = await jobById(this.pool, jobId);
      // An input asset that is gone fails the run.
      const inputAssets = await this.inputAssets(job);
      for (const asset of inputAssets) {
        if (asset.state !== "live") {
          await this.failJob(job, "input_deleted");
          return;
        }
      }
      const stored = await this.writeOutputs(job);
      if (!stored.ok) {
        await this.failJob(job, "storage_unavailable");
        return;
      }
      await this.settle(job, stored.outputs);
    } catch {
      // A crashed run leaves the lease to lapse.
    }
  }


  private async writeOutputs(job: JobRow): Promise<{ ok: boolean; outputs: OutputPlan[] }> {
    const model = modelDef(job.model_slug);
    const input = (job.input && typeof job.input === "object" ? job.input : {}) as Record<string, unknown>;
    const plans: OutputPlan[] = [];
    for (let n = 1; n <= this.outputCount(job); n++) {
      let key: string;
      let body: Buffer;
      let mediaType: string;
      let width: number | null = null;
      let height: number | null = null;
      let duration: string | null = null;
      switch (model.slug) {
        case "quill-still": {
          width = 1024;
          height = 1024;
          body = placeholderPng(width, height, `${job.id}:${n}`);
          mediaType = "image/png";
          key = `outputs/${job.team_id}/${job.id}/${n}.png`;
          break;
        }
        case "halftone-xl": {
          width = Math.max(1, Math.floor(Number(input.width ?? 1024)));
          height = Math.max(1, Math.floor(Number(input.height ?? 1024)));
          body = placeholderPng(width, height, `${job.id}:${n}`);
          mediaType = "image/png";
          key = `outputs/${job.team_id}/${job.id}/${n}.png`;
          break;
        }
        case "reel-10": {
          body = placeholderVideo(`${job.id}`);
          mediaType = "video/webm";
          key = `outputs/${job.team_id}/${job.id}/1.webm`;
          width = 1280;
          height = 720;
          duration = String(input.duration_seconds ?? 5);
          break;
        }
        case "murmur-voice": {
          const units = billableUnits(model.slug, input);
          const seconds = Number(units.num / units.den);
          body = placeholderWav(seconds, `${job.id}`);
          mediaType = "audio/wav";
          key = `outputs/${job.team_id}/${job.id}/1.wav`;
          duration = String(seconds);
          break;
        }
        default:
          return { ok: false, outputs: [] };
      }
      try {
        await this.deps.storage.put(key, body, mediaType);
      } catch {
        for (const plan of plans) {
          try { await this.deps.storage.delete(plan.key); } catch { /* best effort */ }
        }
        return { ok: false, outputs: [] };
      }
      plans.push({ n, key, mediaType, width, height, duration, bytes: body.byteLength });
    }
    return { ok: true, outputs: plans };
  }

  private outputCount(job: JobRow): number {
    const input = (job.input && typeof job.input === "object" ? job.input : {}) as Record<string, unknown>;
    if (job.model_slug === "quill-still" || job.model_slug === "halftone-xl") {
      return Math.max(1, Math.floor(Number(input.num_images ?? 1)));
    }
    return 1;
  }

  /** Succeeded only after every output object is in storage. */
  private async settle(job: JobRow, plans: OutputPlan[]): Promise<void> {
    const model = modelDef(job.model_slug);
    const input = (job.input && typeof job.input === "object" ? job.input : {}) as Record<string, unknown>;
    const units = billableUnits(model.slug, input);
    const charge = chargeMicro(model.slug, input, job.micro_per_unit);
    const release = Math.max(0, job.reserved_micro - charge);
    const org = await this.pool.one<{ retention_days: number }>(`SELECT retention_days FROM orgs WHERE id = 'org'`);
    const now = new Date();
    const expires = new Date(now.getTime() + (org?.retention_days ?? 30) * this.cfg.retentionDaySeconds * 1000);
    const inputAssetIds = plans.length > 0 ? await this.inputAssetIds(job) : [];

    await this.pool.tx(async (tx) => {
      await tx.exec(
        `UPDATE jobs SET status = 'succeeded', finished_at = now(), billed_num = $2, billed_den = $3,
         charged_micro = $4, waiting_reason = NULL, lease_expires_at = NULL WHERE id = $1`,
        [job.id, units.num, units.den, charge],
      );
      for (const plan of plans) {
        const seq = await tx.one<{ nextval: number }>(`SELECT nextval('asset_seq') AS nextval`);
        const assetId = `a_${seq?.nextval}`;
        await tx.exec(
          `INSERT INTO assets (id, team_id, kind, media_type, job_id, model_slug, width, height,
           duration_seconds, bytes, created_at, expires_at, object_key, state)
           VALUES ($1,$2,'output',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'live')`,
          [assetId, job.team_id, plan.mediaType, job.id, job.model_slug, plan.width, plan.height,
           plan.duration, plan.bytes, now, expires, plan.key],
        );
        await tx.exec(`INSERT INTO job_outputs (job_id, n, asset_id) VALUES ($1,$2,$3)`, [job.id, plan.n, assetId]);
        for (const fromId of inputAssetIds) {
          await tx.exec(
            `INSERT INTO lineage_edges (from_asset, to_asset, job_id) VALUES ($1,$2,$3)
             ON CONFLICT (from_asset, to_asset, job_id) DO NOTHING`,
            [fromId, assetId, job.id],
          );
        }
      }
      await recordMovement(tx, job.team_id, "settle",
        { account: "reserved", amountMicro: charge },
        { account: "settled", amountMicro: charge },
        { jobId: job.id });
      if (release > 0) {
        await tx.exec(`UPDATE jobs SET released_micro = released_micro + $2 WHERE id = $1`, [job.id, release]);
        await recordMovement(tx, job.team_id, "release",
          { account: "reserved", amountMicro: release },
          { account: "available", amountMicro: release },
          { jobId: job.id });
      }
    });
    await this.deps.onJobFinal(job.id);
  }

  /** The asset ids referenced by the job's media fields. */
  private async inputAssetIds(job: JobRow): Promise<string[]> {
    const model = modelDef(job.model_slug);
    const input = (job.input && typeof job.input === "object" ? job.input : {}) as Record<string, unknown>;
    const refs: string[] = [];
    for (const f of model.fields) {
      if (f.type === "media") {
        const v = input[f.name];
        if (typeof v === "string" && v.startsWith("asset:")) refs.push(v.slice("asset:".length));
      }
    }
    return refs;
  }

  private async inputAssets(job: JobRow): Promise<{ id: string; state: string }[]> {
    const refs = await this.inputAssetIds(job);
    if (refs.length === 0) return [];
    return this.pool.many<{ id: string; state: string }>(
      `SELECT id, state FROM assets WHERE id = ANY($1::text[])`,
      [refs],
    );
  }

  /** Fail a job and release its whole reservation. */
  private async failJob(job: JobRow, reason: string): Promise<void> {
    await this.pool.tx(async (tx) => {
      const row = await tx.one<{ status: string; reserved_micro: number; released_micro: number }>(
        `SELECT status, reserved_micro, released_micro FROM jobs WHERE id = $1 FOR UPDATE`,
        [job.id],
      );
      if (!row || (row.status !== "queued" && row.status !== "leased" && row.status !== "running")) return;
      const released = row.reserved_micro - row.released_micro;
      await tx.exec(
        `UPDATE jobs SET status = 'failed', failure_reason = $2, finished_at = now(),
         waiting_reason = NULL, lease_expires_at = NULL WHERE id = $1`,
        [job.id, reason],
      );
      if (released > 0) {
        await tx.exec(`UPDATE jobs SET released_micro = released_micro + $2 WHERE id = $1`, [job.id, released]);
        await recordMovement(tx, job.team_id, "release",
          { account: "reserved", amountMicro: released },
          { account: "available", amountMicro: released },
          { jobId: job.id });
      }
    });
    await this.deps.onJobFinal(job.id);
  }

  /** Lease lapses: back to queued, or failed at the third lapse. */
  private async handleLapses(): Promise<void> {
    const lapsed = await this.pool.many<{ id: string; status: string; lapse_count: number }>(
      `SELECT id, status, lapse_count FROM jobs
       WHERE status IN ('leased','running') AND lease_expires_at < now()`,
    );
    for (const job of lapsed) {
      if (this.runs.has(job.id)) continue; // an in-process run keeps its lease renewed
      if (job.lapse_count + 1 >= 3) {
        const full = await jobById(this.pool, job.id).catch(() => null);
        if (full) await this.failJob(full, "lease_expired");
      } else {
        await this.pool.exec(
          `UPDATE jobs SET status = 'queued', lapse_count = lapse_count + 1, waiting_reason = NULL,
           started_at = NULL, lease_expires_at = NULL WHERE id = $1 AND status IN ('leased','running')`,
          [job.id],
        );
      }
    }
  }
}
