import { slugify, storageSafeName } from '../shared/sheet.js';
import type { TagDirection } from '../shared/types.js';
import { recordActivityOutsideSprite } from './activity.js';
import { now } from './clock.js';
import { config } from './config.js';
import { first, one, query, transact } from './db.js';
import { closeJobStreams, publishJob, publishProject } from './live.js';
import { encodeGif, encodePng, encodeSheet, scaleFrame } from './render.js';
import { payloadFrames, type SnapshotPayload } from './snapshots.js';
import { deleteObject, putObject } from './storage.js';

export interface JobSpriteSettings {
  id: number;
  name: string;
  payload: SnapshotPayload;
  tags: { name: string; from: number; to: number; direction: TagDirection }[];
}

export interface JobSettings {
  format: 'png' | 'gif' | 'sheet';
  scale: number;
  frame: number;
  padding: number;
  extrude: number;
  label: string;
  sprites: JobSpriteSettings[];
}

export interface JobRow {
  id: number;
  project_id: number;
  sprite_id: number | null;
  kind: string;
  state: string;
  done: number;
  total: number;
  settings: JobSettings;
  seq: number;
  cancel_requested: boolean;
  by_user_id: number | null;
}

export interface StoredFile {
  name: string;
  size: number;
  sha256: string;
}

class JobCancelled extends Error {}

export async function jobView(jobId: number): Promise<{
  id: number;
  state: string;
  done: number;
  total: number;
  files: StoredFile[];
} | null> {
  const row = await one<{
    id: number;
    state: string;
    done: number;
    total: number;
    files: StoredFile[] | null;
  }>(
    `SELECT j.id, j.state, j.done, j.total,
            CASE WHEN e.state = 'stored' THEN e.files ELSE '[]'::jsonb END AS files
       FROM jobs j LEFT JOIN exports e ON e.job_id = j.id WHERE j.id = $1`,
    [jobId],
  );
  return row === null
    ? null
    : { id: row.id, state: row.state, done: row.done, total: row.total, files: row.files ?? [] };
}

/** Sprite names shared inside one project export get their id appended. */
export function fileSlugs(sprites: { id: number; name: string }[]): Map<number, string> {
  const counts = new Map<string, number>();
  for (const sprite of sprites) {
    const slug = slugify(sprite.name);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const out = new Map<number, string>();
  for (const sprite of sprites) {
    const slug = slugify(sprite.name);
    out.set(sprite.id, (counts.get(slug) ?? 0) > 1 ? `${slug}-${sprite.id}` : slug);
  }
  return out;
}

function publish(job: JobRow, files: StoredFile[] = []): void {
  publishJob(job.id, { type: 'job', state: job.state, done: job.done, total: job.total, files });
}

async function stopRequested(jobId: number): Promise<boolean> {
  const row = await one<{ state: string; cancel_requested: boolean }>(
    'SELECT state, cancel_requested FROM jobs WHERE id = $1',
    [jobId],
  );
  return row === null || row.state === 'cancelled' || row.cancel_requested;
}

interface RenderedFile {
  name: string;
  bytes: Buffer;
}

async function renderJob(job: JobRow, onItem: () => Promise<void>): Promise<RenderedFile[]> {
  const settings = job.settings;
  const slugs = fileSlugs(settings.sprites);
  const files: RenderedFile[] = [];
  for (const sprite of settings.sprites) {
    const frames = payloadFrames(sprite.payload);
    const slug = slugs.get(sprite.id) as string;
    if (job.kind === 'project' || settings.format === 'sheet') {
      const sheet = encodeSheet(sprite.name, frames, sprite.tags, {
        scale: settings.scale,
        padding: settings.padding,
        extrude: settings.extrude,
      });
      for (let at = 0; at < frames.length; at += 1) await onItem();
      files.push({ name: `${slug}-sheet-x${settings.scale}.png`, bytes: sheet.png });
      files.push({ name: `${slug}-sheet-x${settings.scale}.json`, bytes: sheet.json });
      continue;
    }
    if (settings.format === 'png') {
      const chosen = Math.min(Math.max(settings.frame, 1), frames.length);
      const scaled = scaleFrame(frames[chosen - 1], settings.scale);
      await onItem();
      files.push({
        name: `${slug}-frame${settings.frame}-x${settings.scale}.png`,
        bytes: encodePng(scaled.width, scaled.height, scaled.rgba),
      });
      continue;
    }
    const scaled = frames.map((frame) => scaleFrame(frame, settings.scale));
    for (let at = 0; at < frames.length; at += 1) await onItem();
    files.push({ name: `${slug}-x${settings.scale}.gif`, bytes: encodeGif(scaled) });
  }
  return files;
}

async function runJob(job: JobRow): Promise<void> {
  const exportRow = await one<{ id: number }>('SELECT id FROM exports WHERE job_id = $1', [job.id]);
  const exportId = exportRow === null ? null : exportRow.id;
  const keys: string[] = [];
  try {
    job.state = 'rendering';
    await query('UPDATE jobs SET state = $2 WHERE id = $1', [job.id, 'rendering']);
    publish(job);
    const rendered = await renderJob(job, async () => {
      if (await stopRequested(job.id)) throw new JobCancelled();
      await new Promise((resolve) => setTimeout(resolve, config.jobItemMs));
      job.done += 1;
      await query('UPDATE jobs SET done = $2, lease_until = $3 WHERE id = $1', [
        job.id,
        job.done,
        new Date(Date.now() + 5000),
      ]);
      publish(job);
    });
    if (await stopRequested(job.id)) throw new JobCancelled();

    const stored: StoredFile[] = [];
    for (const file of rendered) {
      const key = `exports/${job.project_id}/${exportId}/${storageSafeName(file.name)}`;
      const confirmed = await putObject(
        key,
        file.bytes,
        file.name.endsWith('.json') ? 'application/json' : 'image/png',
      );
      keys.push(key);
      stored.push({ name: file.name, size: confirmed.size, sha256: confirmed.sha256 });
    }

    const won = await transact(async (client) => {
      const row = await first<{ state: string; cancel_requested: boolean }>(
        client,
        'SELECT state, cancel_requested FROM jobs WHERE id = $1 FOR UPDATE',
        [job.id],
      );
      if (row === null || row.state === 'cancelled' || row.cancel_requested) return false;
      await client.query(
        "UPDATE jobs SET state = 'stored', done = total, lease_until = NULL WHERE id = $1",
        [job.id],
      );
      await client.query("UPDATE exports SET state = 'stored', files = $2 WHERE id = $1", [
        exportId,
        JSON.stringify(stored),
      ]);
      return true;
    });
    if (!won) {
      for (const key of keys) await deleteObject(key);
      return;
    }
    job.state = 'stored';
    job.done = job.total;
    publish(job, stored);
    if (job.by_user_id !== null && stored.length > 0) {
      const person = await one<{ name: string }>('SELECT name FROM users WHERE id = $1', [job.by_user_id]);
      await recordActivityOutsideSprite({
        projectId: job.project_id,
        kind: 'export',
        userId: job.by_user_id,
        userName: person?.name ?? '',
        detail: stored[0].name,
        at: await now(),
      });
      publishProject(job.project_id, { type: 'activity' });
    }
    publishProject(job.project_id, { type: 'exports' });
    closeJobStreams(job.id);
  } catch (error) {
    for (const key of keys) await deleteObject(key);
    await query('DELETE FROM exports WHERE job_id = $1', [job.id]);
    const ending = error instanceof JobCancelled ? 'cancelled' : 'failed';
    await query('UPDATE jobs SET state = $2, lease_until = NULL WHERE id = $1', [job.id, ending]);
    job.state = ending;
    publish(job);
    closeJobStreams(job.id);
  }
}

/** A job whose server died is picked up by any running server within five seconds. */
export function startJobWorker(): void {
  const running = new Set<number>();
  const tick = async (): Promise<void> => {
    try {
      const claimable = await query<JobRow>(
        `UPDATE jobs SET lease_until = $1
          WHERE id IN (
            SELECT id FROM jobs
             WHERE state IN ('queued', 'rendering')
               AND (lease_until IS NULL OR lease_until < now())
             ORDER BY id LIMIT 2
          )
          RETURNING id, project_id, sprite_id, kind, state, done, total, settings, seq,
                    cancel_requested, by_user_id`,
        [new Date(Date.now() + 5000)],
      );
      for (const job of claimable) {
        if (running.has(job.id)) continue;
        running.add(job.id);
        void runJob(job).finally(() => running.delete(job.id));
      }
    } catch {
      /* the worker waits while a service is away */
    }
    setTimeout(() => void tick(), 500);
  };
  setTimeout(() => void tick(), 200);
}
