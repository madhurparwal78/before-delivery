import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { asId, require, roleIn } from './access';
import { now } from './clock';
import { config } from './config';
import { one, pool, rows, transaction } from './db';
import { conflict, invalid, notFound, storageUnavailable } from './errors';
import { created, accepted, route, type Ctx } from './http';
import { decodeImage, sniffImage } from './images';
import { loadModel, modelToSnapshot, snapshotToModel, type SnapshotData, type SpriteModel, type SpriteRow } from './model';
import { recordActivity } from './ops';
import { compositesOf, encodeGif, encodePng, renderSheet, scaleRgba, slugOf, TooManyColours } from './render';
import { deleteObject, getObject, putConfirmed, StorageError, storageReachable } from './storage';
import { Errors, intIn, objectBody } from './validate';
import { colourText } from '../shared/colour';
import { formatNumber } from '../shared/format';
import { EXTRUDE_MAX, PADDING_MAX, SCALE_MAX } from '../shared/rules';
import type { JobState } from '../shared/types';

type Format = 'png' | 'gif' | 'sheet';

interface JobSettings {
  format: Format | 'project';
  scale: number;
  frame: number;
  padding: number;
  extrude: number;
}

interface JobPayload {
  sprites: { id: number; name: string; width: number; height: number; snapshot: SnapshotData }[];
}

interface JobRow {
  id: number;
  kind: 'sprite' | 'project';
  project_id: number;
  user_id: number;
  label: string;
  settings: JobSettings;
  state: JobState['state'];
  done: number;
  total: number;
  seq: number;
  payload: Buffer;
  files: JobState['files'];
}

const END_STATES = new Set(['stored', 'failed', 'cancelled']);
const INSTANCE = randomUUID();
const LEASE_SECONDS = 3;

const jobState = (job: Pick<JobRow, 'state' | 'done' | 'total' | 'files'>): JobState => ({ state: job.state, done: job.done, total: job.total, files: job.files });

function exportSettings(body: Record<string, unknown>, kind: 'sprite' | 'project', frames: number): JobSettings {
  const errors = new Errors();
  const format = kind === 'project' ? 'sheet' : body.format;
  if (format !== 'png' && format !== 'gif' && format !== 'sheet') errors.add('format', 'Use png, gif or sheet');
  if (!intIn(body.scale, 1, SCALE_MAX)) errors.add('scale', `Use 1 to ${SCALE_MAX}`);
  if (format === 'png' && !intIn(body.frame, 1, frames)) errors.add('frame', `Use 1 to ${frames}`);
  const sheet = format === 'sheet';
  if (sheet && !intIn(body.padding ?? 0, 0, PADDING_MAX)) errors.add('padding', `Use 0 to ${PADDING_MAX}`);
  if (sheet && !intIn(body.extrude ?? 0, 0, EXTRUDE_MAX)) errors.add('extrude', `Use 0 to ${EXTRUDE_MAX}`);
  if (body.label !== undefined && (typeof body.label !== 'string' || body.label.length > 80)) errors.add('label', 'Use up to 80 characters');
  errors.check();
  return {
    format: kind === 'project' ? 'project' : (format as Format),
    scale: body.scale as number,
    frame: format === 'png' ? (body.frame as number) : 0,
    padding: sheet ? ((body.padding as number | undefined) ?? 0) : 0,
    extrude: sheet ? ((body.extrude as number | undefined) ?? 0) : 0,
  };
}

async function queueExport(ctx: Ctx, kind: 'sprite' | 'project') {
  const user = ctx.need();
  const targetId = asId(ctx.params.id);
  const spriteRow = kind === 'sprite' ? await one<SpriteRow>(pool, 'SELECT id, project_id, palette_id, name, width, height, seq FROM sprites WHERE id = $1', [targetId]) : undefined;
  if (kind === 'sprite' && !spriteRow) throw notFound();
  const projectId = spriteRow?.project_id ?? targetId;
  require(await roleIn(pool, user.id, projectId), 'export');
  const sprites = spriteRow ? [spriteRow] : await rows<SpriteRow>(pool, 'SELECT id, project_id, palette_id, name, width, height, seq FROM sprites WHERE project_id = $1 ORDER BY id', [projectId]);
  const body = objectBody(ctx.body);
  const frames = spriteRow ? ((await one<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM frames WHERE sprite_id = $1', [spriteRow.id]))?.n ?? 0) : 0;
  const settings = exportSettings(body, kind, frames);
  if (!(await storageReachable())) throw storageUnavailable();
  const job = await transaction(async (tx) => {
    for (const sprite of sprites) await tx.query('SELECT 1 FROM sprites WHERE id = $1 FOR SHARE', [sprite.id]);
    const payload: JobPayload = { sprites: [] };
    let total = 0;
    for (const sprite of sprites) {
      const fresh = await one<SpriteRow>(tx, 'SELECT id, project_id, palette_id, name, width, height, seq FROM sprites WHERE id = $1', [sprite.id]);
      const model = await loadModel(tx, fresh ?? sprite);
      payload.sprites.push({ id: sprite.id, name: sprite.name, width: sprite.width, height: sprite.height, snapshot: modelToSnapshot(model) });
      total += settings.format === 'png' ? 1 : model.frames.length;
    }
    const row = await one<{ id: number }>(
      tx,
      `INSERT INTO jobs (kind, project_id, sprite_id, user_id, label, settings, state, total, seq, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, $10) RETURNING id`,
      [kind, projectId, spriteRow?.id ?? null, user.id, typeof body.label === 'string' ? body.label : '', JSON.stringify(settings), total, spriteRow?.seq ?? 0, gzipSync(JSON.stringify(payload)), now()],
    );
    return row;
  });
  return accepted({ job: job?.id });
}

route('POST', '/api/sprites/:id/exports', (ctx) => queueExport(ctx, 'sprite'));
route('POST', '/api/projects/:id/exports', (ctx) => queueExport(ctx, 'project'));

route('GET', '/api/projects/:id/exports', async (ctx) => {
  const projectId = asId(ctx.params.id);
  await roleIn(pool, ctx.need().id, projectId);
  return {
    exports: await rows(
      pool,
      `SELECT e.id, e.job_id AS job, e.label, 'stored' AS state, e.seq, e.files FROM exports e WHERE e.project_id = $1 ORDER BY e.id`,
      [projectId],
    ),
  };
});

async function jobFor(ctx: Ctx): Promise<JobRow> {
  const job = await one<JobRow>(pool, 'SELECT id, kind, project_id, user_id, label, settings, state, done, total, seq, files FROM jobs WHERE id = $1 FOR SHARE', [asId(ctx.params.id)]);
  if (!job) throw notFound();
  await roleIn(pool, ctx.need().id, job.project_id);
  return job;
}

route('GET', '/api/jobs/:id', async (ctx) => {
  const job = await jobFor(ctx);
  return { id: job.id, ...jobState(job) };
});

route('GET', '/api/jobs/:id/events', async (ctx) => {
  const first = await jobFor(ctx);
  ctx.res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
  let last = '';
  let alive = true;
  ctx.res.on('close', () => {
    alive = false;
  });
  let job: JobRow | undefined = first;
  while (alive && job) {
    const payload = JSON.stringify(jobState(job));
    if (payload !== last) {
      ctx.res.write(`data: ${payload}\n\n`);
      last = payload;
    }
    if (END_STATES.has(job.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
    job = await one<JobRow>(pool, 'SELECT id, state, done, total, files FROM jobs WHERE id = $1', [first.id]);
  }
  ctx.res.end();
});

route('POST', '/api/jobs/:id/cancel', async (ctx) => {
  const job = await jobFor(ctx);
  require(await roleIn(pool, ctx.need().id, job.project_id), 'export');
  const cancelled = await one<{ done: number; total: number }>(
    pool,
    "UPDATE jobs SET state = 'cancelled' WHERE id = $1 AND state IN ('queued', 'rendering') RETURNING done, total",
    [job.id],
  );
  if (!cancelled) {
    const now2 = await one<{ state: string }>(pool, 'SELECT state FROM jobs WHERE id = $1', [job.id]);
    throw conflict('job_finished', { state: now2?.state });
  }
  return { state: 'cancelled', done: cancelled.done, total: cancelled.total };
});

const TYPES: Record<string, string> = { png: 'image/png', gif: 'image/gif', json: 'application/json' };

async function download(key: string, name: string) {
  try {
    const data = await getObject(key);
    return {
      status: 200,
      raw: data,
      headers: {
        'content-type': TYPES[name.split('.').pop() ?? ''] ?? 'application/octet-stream',
        'content-disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9._ -]/g, '_')}"`,
        'content-length': String(data.length),
      },
    };
  } catch (error) {
    if (error instanceof StorageError) throw storageUnavailable();
    throw error;
  }
}

route('GET', '/api/exports/:id/files/:name', async (ctx) => {
  const found = await one<{ project_id: number; files: JobState['files'] }>(pool, 'SELECT project_id, files FROM exports WHERE id = $1', [asId(ctx.params.id)]);
  if (!found) throw notFound();
  await roleIn(pool, ctx.need().id, found.project_id);
  const name = ctx.params.name ?? '';
  if (!found.files.some((f) => f.name === name)) throw notFound();
  return download(`exports/${found.project_id}/${asId(ctx.params.id)}/${name}`, name);
});

interface Rendered {
  name: string;
  data: Buffer;
}

function renderFiles(job: JobRow, models: SpriteModel[], composites: Uint8Array[][]): Rendered[] {
  const { settings } = job;
  const slugs = models.map((model) => slugOf(model.name));
  const files: Rendered[] = [];
  models.forEach((model, i) => {
    const frames = composites[i] ?? [];
    const slug = job.kind === 'project' && slugs.filter((s) => s === slugs[i]).length > 1 ? `${slugs[i]}-${model.id}` : (slugs[i] ?? '');
    if (settings.format === 'png') {
      const scaled = scaleRgba(frames[settings.frame - 1] ?? new Uint8Array(), model.width, model.height, settings.scale);
      files.push({ name: `${slug}-frame${settings.frame}-x${settings.scale}.png`, data: encodePng(scaled, model.width * settings.scale, model.height * settings.scale) });
    } else if (settings.format === 'gif') {
      const scaled = frames.map((rgba, k) => ({ rgba: scaleRgba(rgba, model.width, model.height, settings.scale), ms: model.frames[k]?.duration_ms ?? 100 }));
      files.push({ name: `${slug}-x${settings.scale}.gif`, data: encodeGif(scaled, model.width * settings.scale, model.height * settings.scale) });
    } else {
      const sheet = renderSheet(model, frames, settings.scale, settings.padding, settings.extrude);
      files.push({ name: `${slug}-sheet-x${settings.scale}.png`, data: sheet.png }, { name: `${slug}-sheet-x${settings.scale}.json`, data: sheet.json });
    }
  });
  return files;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function fail(job: JobRow): Promise<void> {
  await pool.query("UPDATE jobs SET state = 'failed' WHERE id = $1 AND state IN ('queued', 'rendering')", [job.id]);
}

/** Runs one claimed job: one item per frame, each taking at least CELMATE_JOB_ITEM_MS, then a confirmed store. */
async function runJob(job: JobRow): Promise<void> {
  const heartbeat = setInterval(() => {
    void pool.query(`UPDATE jobs SET lease_until = now() + make_interval(secs => ${LEASE_SECONDS}) WHERE id = $1 AND claimed_by = $2 AND state = 'rendering'`, [job.id, INSTANCE]).catch(() => undefined);
  }, 1000);
  const uploaded: string[] = [];
  try {
    const payload = JSON.parse(gunzipSync(job.payload).toString('utf8')) as JobPayload;
    const models = payload.sprites.map((sprite) => snapshotToModel(sprite.snapshot, sprite));
    const frames = models.map(compositesOf);
    for (let item = job.done; item < job.total; item++) {
      await sleep(config.limits.jobItemMs);
      const progressed = await one(
        pool,
        `UPDATE jobs SET done = $2, lease_until = now() + make_interval(secs => ${LEASE_SECONDS}) WHERE id = $1 AND claimed_by = $3 AND state = 'rendering' RETURNING id`,
        [job.id, item + 1, INSTANCE],
      );
      if (!progressed) return;
    }
    const files = renderFiles(job, models, frames);
    // The job row stays locked from the first upload to the commit, so a cancel and the finish exclude each other
    // and a read of the job waits for the confirmed outcome instead of seeing a job half stored.
    const stored = await transaction(async (tx) => {
      const held = await one(tx, "SELECT id FROM jobs WHERE id = $1 AND state = 'rendering' AND claimed_by = $2 FOR UPDATE", [job.id, INSTANCE]);
      if (!held) return false;
      const exportId = (await one<{ id: number }>(tx, "SELECT nextval('export_ids')::int AS id"))?.id ?? 0;
      const listed: JobState['files'] = [];
      for (const file of files) {
        const key = `exports/${job.project_id}/${exportId}/${file.name}`;
        await putConfirmed(key, file.data);
        uploaded.push(key);
        listed.push({ name: file.name, size: file.data.length, sha256: createHash('sha256').update(file.data).digest('hex') });
      }
      await tx.query("UPDATE jobs SET state = 'stored', files = $2, export_id = $3 WHERE id = $1", [job.id, JSON.stringify(listed), exportId]);
      await tx.query('INSERT INTO exports (id, job_id, project_id, label, seq, files) VALUES ($1, $2, $3, $4, $5, $6)', [exportId, job.id, job.project_id, job.label, job.seq, JSON.stringify(listed)]);
      await recordActivity(tx, job.project_id, job.user_id, null, { kind: 'export', data: { file: listed[0]?.name } });
      return true;
    });
    if (!stored) await Promise.all(uploaded.map(deleteObject));
  } catch (error) {
    await Promise.all(uploaded.map(deleteObject));
    if (error instanceof TooManyColours || error instanceof StorageError) await fail(job);
    else {
      await fail(job);
      process.stderr.write(`export job ${job.id} failed: ${String((error as Error).stack ?? error)}\n`);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

let running = 0;

async function claimNext(): Promise<void> {
  if (running >= 2) return;
  const job = await one<JobRow>(
    pool,
    `UPDATE jobs SET state = 'rendering', claimed_by = $1, lease_until = now() + make_interval(secs => ${LEASE_SECONDS})
     WHERE id = (SELECT id FROM jobs WHERE state IN ('queued', 'rendering') AND (lease_until IS NULL OR lease_until < now())
                 ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id, kind, project_id, user_id, label, settings, state, done, total, seq, payload, files`,
    [INSTANCE],
  );
  if (!job) return;
  running += 1;
  void runJob(job).finally(() => {
    running -= 1;
  });
}

export function startJobWorker(): void {
  setInterval(() => void claimNext().catch(() => undefined), 400);
}

const sanitizeName = (name: string): string => name.replace(/[^A-Za-z0-9._-]/g, '_');

route(
  'POST',
  '/api/projects/:id/imports',
  async (ctx) => {
    const user = ctx.need();
    const projectId = asId(ctx.params.id);
    require(await roleIn(pool, user.id, projectId), 'artwork');
    const file = ctx.upload;
    const { number_format: format } = ctx.locale;
    const sniffed = file ? sniffImage(file.data) : null;
    if (!file || !sniffed) throw invalid({ file: 'Not a PNG or GIF image' });
    const { importMaxBytes, spriteMax, paletteMax, frameMinMs, frameMaxMs } = config.limits;
    if (file.data.length > importMaxBytes) throw invalid({ file: `File is larger than ${formatNumber(importMaxBytes, format)} bytes` });
    if (sniffed.width > spriteMax || sniffed.height > spriteMax || sniffed.width < 1 || sniffed.height < 1) {
      throw invalid({ file: `Image is ${formatNumber(sniffed.width, format)} by ${formatNumber(sniffed.height, format)}, limit ${formatNumber(spriteMax, format)}` });
    }
    const image = decodeImage(file.data, sniffed.kind);
    if (!image) throw invalid({ file: 'Not a PNG or GIF image' });
    const palette = new Map<string, number>();
    const cels = image.frames.map(({ rgba }) => {
      const cel = new Uint8Array(image.width * image.height);
      for (let p = 0; p < cel.length; p++) {
        const at = p * 4;
        if ((rgba[at + 3] ?? 0) === 0) continue;
        const colour = colourText(rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0, rgba[at + 3] ?? 0);
        if (!palette.has(colour)) palette.set(colour, palette.size + 1);
        cel[p] = palette.get(colour) ?? 0;
      }
      return cel;
    });
    if (palette.size > paletteMax) throw invalid({ file: `Needs ${formatNumber(palette.size, format)} colours, limit ${formatNumber(paletteMax, format)}` });
    if (!(await storageReachable())) throw storageUnavailable();
    const stem = file.fileName.replace(/\.[^.]*$/, '').trim().slice(0, 80);
    const made = await transaction(async (tx) => {
      const paletteRow = await one<{ id: number }>(tx, 'INSERT INTO palettes (ord) VALUES ($1) RETURNING id', [[...palette.values()]]);
      for (const [colour, index] of palette) {
        await tx.query('INSERT INTO swatches (palette_id, idx, color, version, edited_by) VALUES ($1, $2, $3, 1, $4)', [paletteRow?.id, index, colour, user.id]);
      }
      const sprite = await one<{ id: number }>(
        tx,
        'INSERT INTO sprites (project_id, palette_id, name, width, height, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [projectId, paletteRow?.id, stem === '' ? 'Imported sprite' : stem, image.width, image.height, now()],
      );
      const layer = await one<{ id: number }>(tx, "INSERT INTO layers (sprite_id, name, opacity, blend, visible, position) VALUES ($1, 'Layer 1', 100, 'normal', true, 1) RETURNING id", [sprite?.id]);
      for (const [i, frame] of image.frames.entries()) {
        const ms = Math.min(frameMaxMs, Math.max(frameMinMs, frame.ms));
        const row = await one<{ id: number }>(tx, 'INSERT INTO frames (sprite_id, position, duration_ms) VALUES ($1, $2, $3) RETURNING id', [sprite?.id, i + 1, ms]);
        const buffer = await one<{ id: number }>(tx, 'INSERT INTO buffers (sprite_id, data) VALUES ($1, $2) RETURNING id', [sprite?.id, Buffer.from(cels[i] ?? [])]);
        await tx.query('INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)', [row?.id, layer?.id, buffer?.id]);
      }
      const record = await one<{ id: number }>(tx, "INSERT INTO imports (project_id, sprite_id, file_name, object_key) VALUES ($1, $2, $3, '') RETURNING id", [projectId, sprite?.id, file.fileName]);
      const key = `imports/${projectId}/${record?.id}/${sanitizeName(file.fileName)}`;
      await tx.query('UPDATE imports SET object_key = $2 WHERE id = $1', [record?.id, key]);
      try {
        await putConfirmed(key, file.data);
      } catch (error) {
        if (error instanceof StorageError) throw storageUnavailable();
        throw error;
      }
      return { import: record?.id, sprite: sprite?.id };
    });
    return created({ ...made, file_name: file.fileName, colours: palette.size });
  },
  { multipart: true },
);

route('GET', '/api/imports/:id/original', async (ctx) => {
  const found = await one<{ project_id: number; file_name: string; object_key: string }>(pool, 'SELECT project_id, file_name, object_key FROM imports WHERE id = $1', [asId(ctx.params.id)]);
  if (!found) throw notFound();
  await roleIn(pool, ctx.need().id, found.project_id);
  return download(found.object_key, found.file_name);
});
