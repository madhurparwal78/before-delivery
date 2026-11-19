import { PNG } from 'pngjs';
import { GifWriter } from 'omggif';
import { q, one } from './db.js';
import { getSprite, getFrames, nextSeq } from './sprites.js';
import { frameComposite, paletteSwatches } from './render.js';
import { putVerified, deleteObject } from './storage.js';
import { sha256Hex, slugify } from './config.js';
import { config } from './http.js';
import { rh } from '../shared/rules.js';
import type { Request } from 'express';

interface JobRow {
  id: string; project_id: string; sprite_id: string | null; kind: string;
  label: string | null; scale: number; frame: number | null;
  padding: number; extrude: number; state: string; done: number; total: number;
  seq: number; owner_id: string; files: { name: string; size: number; sha256: string }[];
}

/** A job whose server died is continued by any running server within 5s. */
export async function recoverJobs(): Promise<void> {
  const rows = await q<{ id: string }>(
    `select id::text from export_jobs where state in ('queued','rendering')`
  );
  for (const row of rows) {
    await q('update export_jobs set state = $1 where id = $2', ['queued', row.id]);
    void runJob(Number(row.id)).catch(() => {});
  }
}

export function startJobLoop(): void {
  const tick = async (): Promise<void> => {
    try {
      const row = await one<{ id: string }>(
        `select id::text from export_jobs where state = 'queued' order by id asc limit 1`
      );
      if (row) {
        await q('update export_jobs set state = $1 where id = $2', ['rendering', row.id]);
        void runJob(Number(row.id)).catch(() => {});
      }
    } catch { /* database not ready */ }
  };
  setInterval(() => { void tick(); }, 500);
}

async function runJob(jobId: number): Promise<void> {
  try {
    const job = await one<JobRow>(
      `select id::text, project_id::text, sprite_id::text, kind, label, scale, frame, padding, extrude,
       state, done, total, seq, owner_id::text, files from export_jobs where id = $1`,
      [jobId]
    );
    if (!job) return;
    const finished = await one<{ state: string }>('select state from export_jobs where id = $1', [jobId]);
    if (finished!.state === 'cancelled') return;
    if (job.kind === 'png' || job.kind === 'gif' || job.kind === 'sheet') {
      await renderSpriteJob(job);
    } else {
      await renderProjectJob(job);
    }
  } catch (e) {
    console.error('job failed:', e instanceof Error ? e.message : e);
    await q('update export_jobs set state = $1 where id = $2', ['failed', jobId]);
  }
}

async function isCancelled(jobId: number): Promise<boolean> {
  const row = await one<{ state: string }>('select state from export_jobs where id = $1', [jobId]);
  return row?.state === 'cancelled';
}

async function setProgress(jobId: number, done: number, total: number): Promise<void> {
  await q('update export_jobs set done = $1, total = $2 where id = $3', [done, total, jobId]);
}

async function renderSpriteJob(job: JobRow): Promise<void> {
  const spriteId = Number(job.sprite_id);
  const sprite = await getSprite(spriteId);
  const frames = await getFrames(spriteId);
  const seqAtQueue = job.seq;
  // render at the state when queued: the job holds the seq, so re-read cels as they are
  const composites: Uint8Array[] = [];
  const durations: number[] = [];
  let count = 0;
  let total = job.kind === 'png' ? 1 : frames.length;
  for (const frame of frames) {
    if (await isCancelled(Number(job.id))) return;
    const { buf } = await frameComposite(spriteId, frame.position);
    composites.push(buf);
    durations.push(frame.duration_ms);
    if (job.kind !== 'png' || frame.position === job.frame) count++;
    await setProgress(Number(job.id), Math.min(count, total), total);
    if (config.jobItemMs > 0) await new Promise((r) => setTimeout(r, config.jobItemMs));
  }
  if (await isCancelled(Number(job.id))) return;
  const slug = slugify(sprite.name);
  const files: { name: string; size: number; sha256: string }[] = [];
  const prefix = `exports/${job.project_id}/${job.id}/`;
  const stored = async (name: string, data: Buffer): Promise<void> => {
    const sha = sha256Hex(data);
    const storedFile = await putVerified(prefix + name, data, sha);
    files.push({ name: storedFile.name, size: storedFile.size, sha256: storedFile.sha256 });
  };
  if (job.kind === 'png') {
    const idx = Math.max(0, (job.frame ?? 1) - 1);
    await stored(`${slug}-frame${job.frame}-x${job.scale}.png`, scalePng(composites[idx]!, sprite.width, sprite.height, job.scale));
  } else if (job.kind === 'gif') {
    const gif = renderGif(composites, durations, sprite.width, sprite.height, job.scale);
    await stored(`${slug}-x${job.scale}.gif`, gif);
  } else {
    const { png, json } = renderSheet(composites, durations, spriteId, sprite.name, sprite.width, sprite.height, job.scale, job.padding, job.extrude);
    await stored(`${slug}-sheet-x${job.scale}.png`, png);
    const tags = await q<{ name: string; from_frame: number; to_frame: number; direction: string }>(
      'select name, from_frame, to_frame, direction from tags where sprite_id = $1', [spriteId]
    );
    const jsonFinal = JSON.parse(json.toString('utf8')) as { tags: unknown; meta: { sprite: string } };
    jsonFinal['tags'] = tags.map((t) => ({ name: t.name, from: t.from_frame, to: t.to_frame, direction: t.direction }));
    await stored(`${slug}-sheet-x${job.scale}.json`, Buffer.from(JSON.stringify(jsonFinal)));
  }
  if (await isCancelled(Number(job.id))) {
    for (const f of files) await deleteObject(prefix + f.name).catch(() => {});
    return;
  }
  await q('update export_jobs set state = $1, files = $2::jsonb where id = $3', ['stored', JSON.stringify(files), job.id]);
  await q('insert into exports (project_id, job_id, label, seq, files) values ($1, $2, $3, $4, $5::jsonb)',
    [job.project_id, job.id, job.label, job.seq, JSON.stringify(files)]);
}

async function renderProjectJob(job: JobRow): Promise<void> {
  const sprites = await q<{ id: string; name: string; width: number; height: number }>(
    'select id::text, name, width, height from sprites where project_id = $1 order by id asc', [job.project_id]
  );
  const slugCount = new Map<string, number>();
  for (const s of sprites) slugCount.set(slugify(s.name), (slugCount.get(slugify(s.name)) ?? 0) + 1);
  let total = 0;
  for (const s of sprites) total += (await getFrames(Number(s.id))).length;
  let done = 0;
  const files: { name: string; size: number; sha256: string }[] = [];
  const prefix = `exports/${job.project_id}/${job.id}/`;
  for (const spriteRow of sprites) {
    const frames = await getFrames(Number(spriteRow.id));
    const composites: Uint8Array[] = [];
    const durations: number[] = [];
    for (const frame of frames) {
      if (await isCancelled(Number(job.id))) return;
      const { buf } = await frameComposite(Number(spriteRow.id), frame.position);
      composites.push(buf);
      durations.push(frame.duration_ms);
      done++;
      await setProgress(Number(job.id), done, total);
      if (config.jobItemMs > 0) await new Promise((r) => setTimeout(r, config.jobItemMs));
    }
    let slug = slugify(spriteRow.name);
    if ((slugCount.get(slug) ?? 0) > 1) slug = `${slug}-${spriteRow.id}`;
    const { png, json } = renderSheet(composites, durations, Number(spriteRow.id), spriteRow.name, spriteRow.width, spriteRow.height, job.scale, job.padding, job.extrude);
    const pngSha = sha256Hex(png);
    const pngFile = await putVerified(`${prefix}${slug}-sheet-x${job.scale}.png`, png, pngSha);
    files.push(pngFile);
    const tags = await q<{ name: string; from_frame: number; to_frame: number; direction: string }>(
      'select name, from_frame, to_frame, direction from tags where sprite_id = $1', [spriteRow.id]
    );
    const jsonFinal = JSON.parse(json.toString('utf8'));
    jsonFinal['meta']['sprite'] = spriteRow.name;
    jsonFinal['tags'] = tags.map((t) => ({ name: t.name, from: t.from_frame, to: t.to_frame, direction: t.direction }));
    const jsonBytes = Buffer.from(JSON.stringify(jsonFinal));
    const jsonSha = sha256Hex(jsonBytes);
    const jsonFile = await putVerified(`${prefix}${slug}-sheet-x${job.scale}.json`, jsonBytes, jsonSha);
    files.push(jsonFile);
  }
  if (await isCancelled(Number(job.id))) {
    for (const f of files) await deleteObject(prefix + f.name).catch(() => {});
    return;
  }
  await q('update export_jobs set state = $1, files = $2::jsonb, done = $3, total = $4 where id = $5',
    ['stored', JSON.stringify(files), done, total, job.id]);
  await q('insert into exports (project_id, job_id, label, seq, files) values ($1, $2, $3, $4, $5::jsonb)',
    [job.project_id, job.id, job.label, job.seq, JSON.stringify(files)]);
}

function scalePng(buf: Uint8Array, w: number, h: number, scale: number): Buffer {
  const png = new PNG({ width: w * scale, height: h * scale });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const dst = (((y * scale + dy) * w * scale) + (x * scale + dx)) * 4;
          png.data[dst] = buf[src];
          png.data[dst + 1] = buf[src + 1];
          png.data[dst + 2] = buf[src + 2];
          png.data[dst + 3] = buf[src + 3];
        }
      }
    }
  }
  return PNG.sync.write(png);
}

function renderGif(composites: Uint8Array[], durations: number[], w: number, h: number, scale: number): Buffer {
  const allColors = new Map<string, number>();
  for (const buf of composites) {
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i + 3] < 128) continue;
      const key = `${buf[i]},${buf[i + 1]},${buf[i + 2]}`;
      if (!allColors.has(key)) allColors.set(key, allColors.size);
      if (allColors.size > 255) throw new Error('too many colours');
    }
  }
  // omggif takes packed 0xRRGGBB entries and a power-of-two count
  let colorCount = allColors.size + 1;
  let padded = 2;
  while (padded < colorCount) padded *= 2;
  const palette: number[] = [];
  for (const [key] of allColors) {
    const [r, g, b] = key.split(',').map(Number);
    palette.push((r << 16) | (g << 8) | b);
  }
  while (palette.length < padded) palette.push(0);
  const transparentIndex = allColors.size;
  const scaledW = w * scale, scaledH = h * scale;
  const buf = new Array(Math.max(1024 * 64, scaledW * scaledH * composites.length * 4 + 4096));
  const writer = new GifWriter(buf, scaledW, scaledH, { loop: null });
  for (let f = 0; f < composites.length; f++) {
    const index = new Uint8Array(scaledW * scaledH);
    const frame = composites[f];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = (y * w + x) * 4;
        const alpha = frame[src + 3];
        let idx = transparentIndex;
        if (alpha >= 128) idx = allColors.get(`${frame[src]},${frame[src + 1]},${frame[src + 2]}`)!;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            index[(y * scale + dy) * scaledW + (x * scale + dx)] = idx;
          }
        }
      }
    }
    writer.addFrame(0, 0, scaledW, scaledH, index, {
      palette,
      delay: Math.max(2, rh(durations[f], 10)),
      transparent: { index: transparentIndex },
      dispose: 2
    });
  }
  const length = writer.end();
  return Buffer.from(buf.slice(0, length));
}

function renderSheet(
  composites: Uint8Array[], durations: number[], spriteId: number, spriteName: string,
  w: number, h: number, scale: number, padding: number, extrude: number
): { png: Buffer; json: Buffer } {
  const cols = Math.ceil(Math.sqrt(composites.length));
  const rows = Math.ceil(composites.length / cols);
  const cellW = w * scale + 2 * extrude;
  const cellH = h * scale + 2 * extrude;
  const sheetW = cols * cellW + (cols - 1) * padding;
  const sheetH = rows * cellH + (rows - 1) * padding;
  const png = new PNG({ width: sheetW, height: sheetH });
  const framesJson: { index: number; x: number; y: number; w: number; h: number; duration_ms: number }[] = [];
  for (let i = 0; i < composites.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const ox = col * (cellW + padding) + extrude;
    const oy = row * (cellH + padding) + extrude;
    const frame = composites[i];
    for (let y = -extrude; y < h * scale + extrude; y++) {
      for (let x = -extrude; x < w * scale + extrude; x++) {
        // extrude repeats edge pixels outward
        const sx = Math.min(w * scale - 1, Math.max(0, x));
        const sy = Math.min(h * scale - 1, Math.max(0, y));
        const src = (Math.floor(sy / scale) * w + Math.floor(sx / scale)) * 4;
        const dst = ((oy + y) * sheetW + (ox + x)) * 4;
        png.data[dst] = frame[src];
        png.data[dst + 1] = frame[src + 1];
        png.data[dst + 2] = frame[src + 2];
        png.data[dst + 3] = frame[src + 3];
      }
    }
    framesJson.push({ index: i + 1, x: ox, y: oy, w: w * scale, h: h * scale, duration_ms: durations[i] });
  }
  const json = {
    meta: { sprite: spriteName, scale, size: { w: sheetW, h: sheetH }, padding, extrude },
    frames: framesJson,
    tags: [] as { name: string; from: number; to: number; direction: string }[]
  };
  return { png: PNG.sync.write(png), json: Buffer.from(JSON.stringify(json)) };
}
