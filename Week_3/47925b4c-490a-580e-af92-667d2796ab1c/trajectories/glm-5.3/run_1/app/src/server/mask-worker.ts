// The mask bundle job worker: every process claims steps through row claims with a
// 15-second lease renewed while working and fencing tokens, so a stopped claimant's
// work is taken over (DP-49, DP-51).

import { randomBytes } from 'node:crypto';
import type { Database } from './db.js';
import type { S3 } from './s3.js';
import type { Config } from './config.js';
import { buildBundle, maskPng, spanInput } from './masks.js';
import { writeOutbox } from './events.js';
import { sleep } from './timers.js';
import { sha256Hex } from './hash.js';
import { loadPlacements, loadLayout, geometriesOf } from './layout-helpers.js';


interface JobRecord {
  id: string;
  layout_id: string;
  layout_hash: string;
  phase: 'queued' | 'rendering' | 'storing' | 'waiting_for_store' | 'done' | 'cancelled';
  steps_done: number;
  steps_total: number;
  sha256: string | null;
  key: string | null;
}

interface StepRecord {
  job_id: string;
  position: number;
  serial: string;
  state: 'pending' | 'claimed' | 'done';
  claim_fence: number;
  claim_until: Date | null;
}

export class MaskWorker {
  private timer: NodeJS.Timeout | null = null;
  private working = false;
  private readonly owner = `mask-${process.pid}-${randomBytes(4).toString('hex')}`;

  constructor(
    private readonly db: Database,
    private readonly s3: S3,
    private readonly config: Config,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.runOnce(), 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      const claimed = await this.claimStep();
      if (claimed === null) return;
      await this.runStep(claimed);
    } catch {
      // the next sweep retries; claims lapse
    } finally {
      this.working = false;
    }
  }

  // Claims one unfinished step with a lease and a fencing token.
  private async claimStep(): Promise<{ job: JobRecord; step: StepRecord; fence: number } | null> {
    const result = await this.db.withClient(async (client) => {
      await client.query('BEGIN');
      const stale = await client.query(
        `UPDATE mask_steps SET state = 'pending', claim_until = NULL, claim_owner = NULL
          WHERE state = 'claimed' AND claim_until < now()`,
      );
      void stale;
      const step = await client.query<StepRecord>(
        `SELECT * FROM mask_steps
          WHERE state = 'pending'
            AND job_id IN (SELECT id FROM mask_jobs WHERE phase IN ('queued','rendering','waiting_for_store'))
          ORDER BY job_id, position
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
      );
      const target = step.rows[0];
      if (target === undefined) {
        await client.query('COMMIT');
        return null;
      }
      const fence = target.claim_fence + 1;
      await client.query(
        `UPDATE mask_steps SET state = 'claimed', claim_fence = $3, claim_until = now() + interval '15 seconds', claim_owner = $4
          WHERE job_id = $1 AND position = $2`,
        [target.job_id, target.position, fence, this.owner],
      );
      await client.query(
        `UPDATE mask_jobs SET phase = 'rendering' WHERE id = $1 AND phase IN ('queued','waiting_for_store')`,
        [target.job_id],
      );
      await writeOutbox(client, 'mask_job.changed', 'mask_job', target.job_id, {
        id: target.job_id,
        phase: 'rendering',
        stepsDone: 0,
        stepsTotal: 0,
      });
      await client.query('COMMIT');
      const job = await client.query<JobRecord>('SELECT * FROM mask_jobs WHERE id = $1', [target.job_id]);
      return { job: job.rows[0]!, step: target, fence };
    });
    if (!result.ok) return null;
    return result.value;
  }

  private async runStep(claimed: { job: JobRecord; step: StepRecord; fence: number }): Promise<void> {
    const { job, step, fence } = claimed;
    await sleep(this.config.maskStepMilliseconds);
    if (step.position >= job.steps_total - 1) {
      await this.storeBundle(job, fence);
      return;
    }
    await this.renderStep(job, step, fence);
  }

  // Each step waits MASK_STEP_MILLISECONDS first, then renders one body's mask.
  private async renderStep(job: JobRecord, step: StepRecord, fence: number): Promise<void> {
    const rendered = await this.renderMask(job, step.serial);
    if (rendered === null) return; // layout vanished; leave the claim to lapse
    const key = `masks/${job.layout_id}/${job.layout_hash}/${step.serial}.png`;
    const stored = await this.tryStore(key, rendered);
    if (!stored) {
      await this.markWaitingForStore(job);
      return;
    }
    await this.db.withClient(async (client) => {
      await client.query('BEGIN');
      const fenced = await client.query(
        `UPDATE mask_steps SET state = 'done' WHERE job_id = $1 AND position = $2 AND claim_fence = $3 AND state = 'claimed'`,
        [job.id, step.position, fence],
      );
      if (fenced.rowCount === 0) {
        await client.query('ROLLBACK');
        return;
      }
      const done = await client.query<{ steps_done: number }>(
        'UPDATE mask_jobs SET steps_done = steps_done + 1, phase = \'rendering\' WHERE id = $1 RETURNING steps_done',
        [job.id],
      );
      await writeOutbox(client, 'mask_job.changed', 'mask_job', job.id, {
        id: job.id,
        phase: 'rendering',
        stepsDone: done.rows[0]!.steps_done,
        stepsTotal: job.steps_total,
      });
      await client.query('COMMIT');
    });
  }

  private async storeBundle(job: JobRecord, fence: number): Promise<void> {
    const placements = await this.db.withClient(async (client) => {
      const rows = await client.query<{ serial: string }>(
        'SELECT serial FROM mask_steps WHERE job_id = $1 ORDER BY position',
        [job.id],
      );
      return rows.rows.filter((row) => row.serial !== '');
    });
    if (!placements.ok) return;
    const entries: { serial: string; png: Buffer }[] = [];
    for (const placement of placements.value) {
      const png = await this.renderMask(job, placement.serial);
      if (png !== null) entries.push({ serial: placement.serial, png });
    }
    const bundle = buildBundle(entries);
    const sha = sha256Hex(bundle);
    const key = `masks/${job.layout_id}/${job.layout_hash}.zip`;
    const stored = await this.tryStore(key, bundle);
    if (!stored) {
      await this.markWaitingForStore(job);
      return;
    }
    await this.db.withClient(async (client) => {
      await client.query('BEGIN');
      const fenced = await client.query(
        `UPDATE mask_steps SET state = 'done' WHERE job_id = $1 AND position = $2 AND claim_fence = $3 AND state = 'claimed'`,
        [job.id, job.steps_total - 1, fence],
      );
      if (fenced.rowCount === 0) {
        await client.query('ROLLBACK');
        return;
      }
      await client.query(
        `UPDATE mask_jobs SET steps_done = steps_total, phase = 'done', sha256 = $2, key = $3 WHERE id = $1`,
        [job.id, sha, key],
      );
      await writeOutbox(client, 'mask_job.changed', 'mask_job', job.id, {
        id: job.id,
        phase: 'done',
        stepsDone: job.steps_total,
        stepsTotal: job.steps_total,
      });
      await client.query('COMMIT');
    });
  }

  private async renderMask(job: JobRecord, serial: string): Promise<Buffer | null> {
    const loaded = await this.db.withClient(async (client) => {
      const { layout } = await loadLayout(client, job.layout_id);
      const placements = await loadPlacements(client, layout.id);
      const target = placements.find((p) => p.body_serial === serial);
      if (target === undefined) return null;
      const geometries = await geometriesOf(client, placements);
      return { target: geometries.find((g) => g.placementId === target.id) ?? null, geometries };
    });
    if (!loaded.ok || loaded.value === null || loaded.value.target === null) return null;
    const span = spanInput(loaded.value.geometries, loaded.value.target);
    return maskPng(loaded.value.target, span);
  }

  private async tryStore(key: string, bytes: Buffer): Promise<boolean> {
    try {
      await this.s3.put(key, bytes, key.endsWith('.png') ? 'image/png' : 'application/zip');
      const readBack = await this.s3.get(key);
      return readBack !== null && readBack.length === bytes.length && sha256Hex(readBack) === sha256Hex(bytes);
    } catch {
      return false;
    }
  }

  private async markWaitingForStore(job: JobRecord): Promise<void> {
    await this.db.withClient(async (client) => {
      await client.query('BEGIN');
      await client.query(`UPDATE mask_jobs SET phase = 'waiting_for_store' WHERE id = $1`, [job.id]);
      await writeOutbox(client, 'mask_job.changed', 'mask_job', job.id, {
        id: job.id,
        phase: 'waiting_for_store',
        stepsDone: job.steps_done,
        stepsTotal: job.steps_total,
      });
      await client.query('COMMIT');
    });
  }
}
