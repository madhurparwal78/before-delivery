import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { type Row, query, queryOne, transact } from '../db/pool.js';
import { blendShare, covers, maskSignal, projectionOf, type PlacementOptics } from '../domain/photometrics.js';
import { roundWholeHalfEven } from '../domain/round.js';
import { writeEvent } from '../events/outbox.js';
import { problem } from '../http/problem.js';
import { encodeGreyPng } from '../media/png.js';
import { buildZip } from '../media/zip.js';
import { getObject, putObject, StoreUnreachable } from '../services/store.js';
import { opticsOf, placementStatus, requireLayout } from './layouts.js';
import { requireSite } from './sites.js';

type JobPhase = 'queued' | 'rendering' | 'storing' | 'waiting_for_store' | 'done' | 'cancelled';

interface MaskSnapshot {
  readonly widthMetres: number;
  readonly heightMetres: number;
  readonly placements: readonly { readonly serial: string; readonly optics: PlacementOptics }[];
}

interface JobView {
  readonly id: string;
  readonly layoutId: string;
  readonly layoutHash: string;
  readonly phase: JobPhase;
  readonly stepsDone: number;
  readonly stepsTotal: number;
  readonly sha256: string | null;
  readonly key: string | null;
}

interface JobRecord extends JobView {
  readonly snapshot: MaskSnapshot;
  readonly cancelRequested: boolean;
  readonly fence: string;
}

function toJob(row: Row): JobRecord {
  return {
    id: row['id'] as string,
    layoutId: row['layout_id'] as string,
    layoutHash: row['layout_hash'] as string,
    phase: row['phase'] as JobPhase,
    stepsDone: Number(row['steps_done']),
    stepsTotal: Number(row['steps_total']),
    sha256: (row['sha256'] as string | null) ?? null,
    key: (row['object_key'] as string | null) ?? null,
    snapshot: row['snapshot'] as MaskSnapshot,
    cancelRequested: row['cancel_requested'] as boolean,
    fence: String(row['fence']),
  };
}

export function jobView(job: JobRecord): JobView {
  return {
    id: job.id,
    layoutId: job.layoutId,
    layoutHash: job.layoutHash,
    phase: job.phase,
    stepsDone: job.stepsDone,
    stepsTotal: job.stepsTotal,
    sha256: job.sha256,
    key: job.key,
  };
}

async function findJob(jobId: string): Promise<JobRecord | null> {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) return null;
  const row = await queryOne('select * from mask_jobs where id = $1', [jobId]);
  return row === null ? null : toJob(row);
}

export async function requireJob(jobId: string): Promise<JobRecord> {
  const job = await findJob(jobId);
  if (job === null) throw problem('not_found');
  return job;
}

function bundleKey(layoutId: string, hash: string): string {
  return `masks/${layoutId}/${hash}.zip`;
}

function maskKey(layoutId: string, hash: string, serial: string): string {
  return `masks/${layoutId}/${hash}/${serial}.png`;
}

export async function startMaskJob(layoutId: string): Promise<JobView> {
  const layout = await requireLayout(layoutId);
  const unbodied = layout.placements.filter((placement) => placementStatus(placement) !== 'Bodied').length;
  if (unbodied > 0 || layout.placements.length === 0) {
    throw problem('layout_needs_bodies', { placeholders: { n: String(unbodied) } });
  }
  const site = await requireSite(layout.siteId);
  const snapshot: MaskSnapshot = {
    widthMetres: Number(site.widthMetres),
    heightMetres: Number(site.heightMetres),
    placements: layout.placements
      .map((placement) => ({ serial: placement.bodySerial as string, optics: opticsOf(placement) }))
      .sort((left, right) => left.serial.localeCompare(right.serial)),
  };
  const id = randomUUID();
  await transact(async (client) => {
    await client.query(
      `insert into mask_jobs (id, layout_id, layout_hash, phase, steps_total, snapshot)
       values ($1, $2, $3, 'queued', $4, $5::jsonb)`,
      [id, layoutId, layout.hash, snapshot.placements.length + 1, JSON.stringify(snapshot)],
    );
    await writeEvent(client, 'mask_job.changed', id, {
      id,
      phase: 'queued',
      stepsDone: 0,
      stepsTotal: snapshot.placements.length + 1,
    });
  });
  return jobView(await requireJob(id));
}

export async function cancelMaskJob(jobId: string): Promise<JobView> {
  const job = await requireJob(jobId);
  if (job.phase === 'done' || job.phase === 'cancelled') throw problem('job_finished');
  await transact(async (client) => {
    const stopped = await client.query(
      `update mask_jobs set cancel_requested = true,
         phase = case when claim_until is null or claim_until < now() then 'cancelled' else phase end
       where id = $1 returning phase, steps_done, steps_total`,
      [jobId],
    );
    const row = stopped.rows[0] as Row;
    if (row['phase'] === 'cancelled') {
      await writeEvent(client, 'mask_job.changed', jobId, {
        id: jobId,
        phase: 'cancelled',
        stepsDone: Number(row['steps_done']),
        stepsTotal: Number(row['steps_total']),
      });
    }
  });
  return jobView(await requireJob(jobId));
}

/** One 8-bit grey mask: 255 outside any blend, the gamma-encoded share inside it. */
function renderMask(snapshot: MaskSnapshot, index: number): Buffer {
  const entry = snapshot.placements[index] as { serial: string; optics: PlacementOptics };
  const projection = projectionOf(entry.optics);
  const others = snapshot.placements
    .filter((_, other) => other !== index)
    .map((candidate) => ({ optics: candidate.optics, projection: projectionOf(candidate.optics) }));
  const width = entry.optics.nativeWidthPx;
  const height = entry.optics.nativeHeightPx;
  const grey = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const down = projection.top + ((row + 0.5) / height) * projection.imageHeightMetres;
    const onWall = down >= 0 && down < snapshot.heightMetres;
    for (let column = 0; column < width; column += 1) {
      const across = projection.left + ((column + 0.5) / width) * projection.imageWidthMetres;
      if (!onWall || across < 0 || across >= snapshot.widthMetres) continue;
      const overlapping = others.find((other) => covers(other.projection, across, down));
      if (overlapping === undefined) {
        grey[row * width + column] = 255;
        continue;
      }
      const share = blendShare(entry.optics, projection, overlapping.optics, overlapping.projection, across);
      grey[row * width + column] = roundWholeHalfEven(maskSignal(share) * 255);
    }
  }
  return encodeGreyPng(width, height, grey);
}

const STORE_RETRY_MILLISECONDS = 5_000;
/** A process that found the store down waits before trying again; the job stays free for any healthy process. */
let storeRetryAfter = 0;

async function claim(): Promise<JobRecord | null> {
  const rows = await query(
    `update mask_jobs set claim_until = now() + interval '15 seconds', fence = fence + 1
     where id in (
       select id from mask_jobs
       where phase in ('queued', 'rendering', 'storing', 'waiting_for_store')
         and (claim_until is null or claim_until < now())
       order by created_at
       limit 1
       for update skip locked
     )
     returning *`,
  );
  const row = rows[0];
  return row === undefined ? null : toJob(row);
}

/** Keeps a claim alive while a step runs, so only a stopped worker loses it. */
function renewClaim(job: JobRecord): () => void {
  const timer = setInterval(() => {
    void query(
      `update mask_jobs set claim_until = now() + interval '15 seconds' where id = $1 and fence = $2`,
      [job.id, job.fence],
    );
  }, 5_000);
  return () => clearInterval(timer);
}

async function finishStep(job: JobRecord, phase: JobPhase, stepsDone: number, stored: { sha256: string; key: string } | null): Promise<void> {
  await transact(async (client) => {
    const current = await client.query('select fence from mask_jobs where id = $1 for update', [job.id]);
    if (String(current.rows[0]?.['fence']) !== job.fence) return;
    await client.query(
      `update mask_jobs set phase = $2, steps_done = greatest(steps_done, $3), sha256 = coalesce($4, sha256),
         object_key = coalesce($5, object_key), claim_until = null
       where id = $1`,
      [job.id, phase, stepsDone, stored?.sha256 ?? null, stored?.key ?? null],
    );
    await writeEvent(client, 'mask_job.changed', job.id, {
      id: job.id,
      phase,
      stepsDone,
      stepsTotal: job.stepsTotal,
    });
  });
}

/** Runs one claimed step, resuming from the last finished step on any process. */
export async function runMaskStep(): Promise<boolean> {
  if (Date.now() < storeRetryAfter) return false;
  const job = await claim();
  if (job === null) return false;
  if (job.cancelRequested) {
    await finishStep(job, 'cancelled', job.stepsDone, null);
    return true;
  }
  const stopRenewing = renewClaim(job);
  const placements = job.snapshot.placements;
  try {
    if (config.maskStepMilliseconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.maskStepMilliseconds));
    }
    if (job.stepsDone < placements.length) {
      const entry = placements[job.stepsDone] as { serial: string };
      const png = renderMask(job.snapshot, job.stepsDone);
      await putObject(maskKey(job.layoutId, job.layoutHash, entry.serial), png, 'image/png');
      const next = job.stepsDone + 1;
      await finishStep(job, next < placements.length ? 'rendering' : 'storing', next, null);
      return true;
    }
    const files = [];
    for (const entry of placements) {
      const bytes = await getObject(maskKey(job.layoutId, job.layoutHash, entry.serial));
      if (bytes === null) throw new StoreUnreachable(`the mask for ${entry.serial} is missing`);
      files.push({ name: `masks/${entry.serial}.png`, bytes });
    }
    const zip = buildZip(files);
    const stored = await putObject(bundleKey(job.layoutId, job.layoutHash), zip, 'application/zip');
    await finishStep(job, 'done', job.stepsTotal, { sha256: stored.sha256, key: stored.key });
    return true;
  } catch (error) {
    if (!(error instanceof StoreUnreachable)) throw error;
    storeRetryAfter = Date.now() + STORE_RETRY_MILLISECONDS;
    await query(`update mask_jobs set phase = 'waiting_for_store', claim_until = null where id = $1 and fence = $2`, [
      job.id,
      job.fence,
    ]);
    await transact(async (client) => {
      await writeEvent(client, 'mask_job.changed', job.id, {
        id: job.id,
        phase: 'waiting_for_store',
        stepsDone: job.stepsDone,
        stepsTotal: job.stepsTotal,
      });
    });
    return true;
  } finally {
    stopRenewing();
  }
}

export async function bundleBytes(job: JobRecord): Promise<Buffer> {
  if (job.phase !== 'done' || job.key === null) throw problem('not_found');
  const bytes = await getObject(job.key);
  if (bytes === null) throw problem('not_found');
  return bytes;
}
