import { storageSafeName } from '../../shared/sheet.js';
import type { TagDirection } from '../../shared/types.js';
import { openProject, openSprite, requireArtwork, requireExporting, requirePerson, roleIn } from '../access.js';
import { now } from '../clock.js';
import { config } from '../config.js';
import { first, one, query, transact } from '../db.js';
import { conflict, notFound, storageUnavailable, unprocessable } from '../errors.js';
import type { Ctx, Reply, Route } from '../http.js';
import { closeStream, openStream, publishProject } from '../live.js';
import { decodeImport, parseMultipart } from '../imports.js';
import { jobView, type JobSettings, type JobSpriteSettings, type StoredFile } from '../jobs.js';
import { captureSnapshot } from '../snapshots.js';
import { getObject, putObject, storageReachable, StorageUnavailable } from '../storage.js';
import { idParam, optionalWholeNumber, wholeNumber } from '../validate.js';
import { readBody } from '../http.js';

async function spriteSettings(spriteId: number): Promise<JobSpriteSettings> {
  return transact(async (client) => {
    const sprite = await first<{
      id: number;
      project_id: number;
      palette_id: number;
      name: string;
      width: number;
      height: number;
      seq: number;
    }>(client, 'SELECT id, project_id, palette_id, name, width, height, seq FROM sprites WHERE id = $1', [
      spriteId,
    ]);
    if (sprite === null) throw notFound();
    const payload = await captureSnapshot(client, sprite);
    return {
      id: sprite.id,
      name: sprite.name,
      payload,
      tags: payload.tags.map((tag) => ({
        name: tag.name,
        from: tag.from,
        to: tag.to,
        direction: tag.direction as TagDirection,
      })),
    };
  });
}

function itemCount(settings: JobSettings, kind: 'sprite' | 'project'): number {
  if (kind === 'project') {
    return settings.sprites.reduce((total, sprite) => total + sprite.payload.frames.length, 0);
  }
  if (settings.format === 'png') return 1;
  return settings.sprites[0]?.payload.frames.length ?? 0;
}

async function queueJob(
  ctx: Ctx,
  projectId: number,
  spriteId: number | null,
  kind: 'sprite' | 'project',
  settings: JobSettings,
): Promise<Reply> {
  if (!(await storageReachable())) throw storageUnavailable();
  const total = itemCount(settings, kind);
  const at = await now();
  const person = requirePerson(ctx);
  const spriteSeq = spriteId === null ? 0 : (await one<{ seq: number }>('SELECT seq FROM sprites WHERE id = $1', [spriteId]))?.seq ?? 0;
  const job = await one<{ id: number }>(
    `INSERT INTO jobs (project_id, sprite_id, kind, state, done, total, settings, seq, by_user_id, created_at)
     VALUES ($1, $2, $3, 'queued', 0, $4, $5, $6, $7, $8) RETURNING id`,
    [projectId, spriteId, kind, total, JSON.stringify(settings), spriteSeq, person.id, at],
  );
  const jobId = (job as { id: number }).id;
  await query(
    `INSERT INTO exports (project_id, job_id, label, state, seq, files, created_at)
     VALUES ($1, $2, $3, 'pending', $4, '[]'::jsonb, $5)`,
    [projectId, jobId, settings.label, spriteSeq, at],
  );
  return { status: 202, body: { job: jobId } };
}

export const mediaRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/projects/:id/imports',
    raw: true,
    handler: async (ctx) => {
      const access = await openProject(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      const raw = await readBody(ctx.req, config.importMaxBytes + 1048576);
      const file = parseMultipart(raw, String(ctx.req.headers['content-type'] ?? ''));
      if (file === null) throw unprocessable({ file: 'Choose a PNG or GIF image' });
      const decoded = decodeImport(ctx, file.bytes);
      if (!(await storageReachable())) throw storageUnavailable();

      const at = await now();
      const spriteName = file.fileName.replace(/\.[^.]+$/, '');
      const made = await transact(async (client) => {
        const palette = await first<{ id: number }>(
          client,
          'INSERT INTO palettes (created_at) VALUES ($1) RETURNING id',
          [at],
        );
        const paletteId = (palette as { id: number }).id;
        for (let index = 0; index < decoded.colours.length; index += 1) {
          await client.query(
            'INSERT INTO swatches (palette_id, index, color, version, present) VALUES ($1, $2, $3, 1, true)',
            [paletteId, index + 1, decoded.colours[index]],
          );
        }
        const sprite = await first<{ id: number }>(
          client,
          `INSERT INTO sprites (project_id, palette_id, name, width, height, seq, created_at)
           VALUES ($1, $2, $3, $4, $5, 0, $6) RETURNING id`,
          [access.project.id, paletteId, spriteName, decoded.width, decoded.height, at],
        );
        const spriteId = (sprite as { id: number }).id;
        const layer = await first<{ id: number }>(
          client,
          `INSERT INTO layers (sprite_id, name, opacity, blend, visible, position)
           VALUES ($1, 'Layer 1', 100, 'normal', true, 1) RETURNING id`,
          [spriteId],
        );
        const layerId = (layer as { id: number }).id;
        const colourIndex = new Map(decoded.colours.map((colour, at2) => [colour, at2 + 1]));
        for (let frameAt = 0; frameAt < decoded.frames.length; frameAt += 1) {
          const frame = decoded.frames[frameAt];
          const frameRow = await first<{ id: number }>(
            client,
            'INSERT INTO frames (sprite_id, number, duration_ms) VALUES ($1, $2, $3) RETURNING id',
            [spriteId, frameAt + 1, frame.duration_ms],
          );
          const data = Buffer.alloc(decoded.width * decoded.height);
          for (let cell = 0; cell < data.length; cell += 1) {
            const pixel = cell * 4;
            if (frame.rgba[pixel + 3] === 0) continue;
            const colour = [
              frame.rgba[pixel],
              frame.rgba[pixel + 1],
              frame.rgba[pixel + 2],
              frame.rgba[pixel + 3],
            ]
              .map((channel) => channel.toString(16).padStart(2, '0'))
              .join('');
            data[cell] = colourIndex.get(colour) ?? 0;
          }
          const buffer = await first<{ id: number }>(
            client,
            'INSERT INTO buffers (sprite_id, data) VALUES ($1, $2) RETURNING id',
            [spriteId, data],
          );
          await client.query('INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)', [
            (frameRow as { id: number }).id,
            layerId,
            (buffer as { id: number }).id,
          ]);
        }
        const safeName = storageSafeName(file.fileName);
        const importRow = await first<{ id: number }>(
          client,
          `INSERT INTO imports (project_id, sprite_id, file_name, object_key, size, sha256, created_at)
           VALUES ($1, $2, $3, '', $4, '', $5) RETURNING id`,
          [access.project.id, spriteId, file.fileName, file.bytes.length, at],
        );
        const importId = (importRow as { id: number }).id;
        const key = `imports/${access.project.id}/${importId}/${safeName}`;
        const confirmed = await putObject(key, file.bytes, 'application/octet-stream');
        await client.query('UPDATE imports SET object_key = $2, sha256 = $3 WHERE id = $1', [
          importId,
          key,
          confirmed.sha256,
        ]);
        return { importId, spriteId };
      }).catch((error: unknown) => {
        if (error instanceof StorageUnavailable) throw storageUnavailable();
        throw error;
      });
      publishProject(access.project.id, { type: 'sprites' });
      return {
        status: 201,
        body: {
          import: made.importId,
          sprite: made.spriteId,
          file_name: file.fileName,
          colours: decoded.colours.length,
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/imports/:id/original',
    handler: async (ctx) => {
      const row = await one<{ id: number; project_id: number; file_name: string; object_key: string }>(
        'SELECT id, project_id, file_name, object_key FROM imports WHERE id = $1',
        [idParam(ctx, 'id')],
      );
      if (row === null) throw notFound();
      await openProject(ctx, row.project_id);
      try {
        const bytes = await getObject(row.object_key);
        return {
          status: 200,
          bytes,
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': `attachment; filename="${storageSafeName(row.file_name)}"`,
          },
        };
      } catch {
        throw storageUnavailable();
      }
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/exports',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireExporting(access);
      const format = String(ctx.body.format ?? '');
      if (format !== 'png' && format !== 'gif' && format !== 'sheet') {
        throw unprocessable({ format: 'Choose PNG, GIF or Sheet' });
      }
      const scale = wholeNumber(ctx, 'scale', { min: 1, max: 16, text: 'Use 1 to 16' });
      const frames = await query<{ number: number }>(
        'SELECT number FROM frames WHERE sprite_id = $1 ORDER BY number',
        [sprite.id],
      );
      const frame =
        format === 'png'
          ? wholeNumber(ctx, 'frame', {
              min: 1,
              max: frames.length,
              text: `Use 1 to ${ctx.num(frames.length)}`,
            })
          : 1;
      const padding =
        format === 'sheet'
          ? optionalWholeNumber(ctx, 'padding', { min: 0, max: 64, text: 'Use 0 to 64', fallback: 0 })
          : 0;
      const extrude =
        format === 'sheet'
          ? optionalWholeNumber(ctx, 'extrude', { min: 0, max: 16, text: 'Use 0 to 16', fallback: 0 })
          : 0;
      const label = String(ctx.body.label ?? '').trim();
      const settings: JobSettings = {
        format,
        scale,
        frame,
        padding,
        extrude,
        label,
        sprites: [await spriteSettings(sprite.id)],
      };
      return queueJob(ctx, sprite.project_id, sprite.id, 'sprite', settings);
    },
  },
  {
    method: 'POST',
    pattern: '/api/projects/:id/exports',
    handler: async (ctx) => {
      const access = await openProject(ctx, idParam(ctx, 'id'));
      requireExporting(access);
      const scale = wholeNumber(ctx, 'scale', { min: 1, max: 16, text: 'Use 1 to 16' });
      const padding = optionalWholeNumber(ctx, 'padding', { min: 0, max: 64, text: 'Use 0 to 64', fallback: 0 });
      const extrude = optionalWholeNumber(ctx, 'extrude', { min: 0, max: 16, text: 'Use 0 to 16', fallback: 0 });
      const label = String(ctx.body.label ?? '').trim();
      const sprites = await query<{ id: number }>(
        'SELECT id FROM sprites WHERE project_id = $1 ORDER BY id',
        [access.project.id],
      );
      const settings: JobSettings = {
        format: 'sheet',
        scale,
        frame: 1,
        padding,
        extrude,
        label,
        sprites: await Promise.all(sprites.map((sprite) => spriteSettings(sprite.id))),
      };
      return queueJob(ctx, access.project.id, null, 'project', settings);
    },
  },
  {
    method: 'GET',
    pattern: '/api/projects/:id/exports',
    handler: async (ctx) => {
      const access = await openProject(ctx, idParam(ctx, 'id'));
      const list = await query<{
        id: number;
        job_id: number;
        label: string;
        state: string;
        seq: number;
        files: StoredFile[];
      }>(
        `SELECT id, job_id, label, state, seq, files FROM exports
          WHERE project_id = $1 AND state = 'stored' ORDER BY id DESC`,
        [access.project.id],
      );
      return {
        status: 200,
        body: {
          exports: list.map((row) => ({
            id: row.id,
            job: row.job_id,
            label: row.label,
            state: row.state,
            seq: row.seq,
            files: row.files,
          })),
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id',
    handler: async (ctx) => {
      const job = await one<{ id: number; project_id: number }>(
        'SELECT id, project_id FROM jobs WHERE id = $1',
        [idParam(ctx, 'id')],
      );
      if (job === null) throw notFound();
      await openProject(ctx, job.project_id);
      const view = await jobView(job.id);
      if (view === null) throw notFound();
      return { status: 200, body: view };
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id/events',
    raw: true,
    handler: async (ctx) => {
      const job = await one<{ id: number; project_id: number }>(
        'SELECT id, project_id FROM jobs WHERE id = $1',
        [idParam(ctx, 'id')],
      );
      if (job === null) throw notFound();
      await openProject(ctx, job.project_id);
      const client = openStream(ctx.res, { jobId: job.id });
      const view = await jobView(job.id);
      if (view !== null) {
        ctx.res.write(
          `data: ${JSON.stringify({ type: 'job', state: view.state, done: view.done, total: view.total, files: view.files })}\n\n`,
        );
        if (view.state === 'stored' || view.state === 'failed' || view.state === 'cancelled') {
          closeStream(client);
          return;
        }
      }
      ctx.req.on('close', () => closeStream(client));
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/cancel',
    handler: async (ctx) => {
      const job = await one<{ id: number; project_id: number }>(
        'SELECT id, project_id FROM jobs WHERE id = $1',
        [idParam(ctx, 'id')],
      );
      if (job === null) throw notFound();
      const access = await openProject(ctx, job.project_id);
      requireExporting(access);
      return transact(async (client) => {
        const row = await first<{ state: string; done: number; total: number }>(
          client,
          'SELECT state, done, total FROM jobs WHERE id = $1 FOR UPDATE',
          [job.id],
        );
        if (row === null) throw notFound();
        if (row.state === 'stored' || row.state === 'failed' || row.state === 'cancelled') {
          throw conflict({ error: 'job_finished', state: row.state });
        }
        await client.query(
          "UPDATE jobs SET cancel_requested = true, state = 'cancelled' WHERE id = $1",
          [job.id],
        );
        await client.query('DELETE FROM exports WHERE job_id = $1', [job.id]);
        return { status: 200, body: { state: 'cancelled', done: row.done, total: row.total } };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/exports/:id/files/:name',
    handler: async (ctx) => {
      const row = await one<{ id: number; project_id: number; files: StoredFile[]; state: string }>(
        'SELECT id, project_id, files, state FROM exports WHERE id = $1',
        [idParam(ctx, 'id')],
      );
      if (row === null || row.state !== 'stored') throw notFound();
      const person = requirePerson(ctx);
      const role = await roleIn(row.project_id, person.id);
      if (role === null) throw notFound();
      const file = row.files.find((entry) => entry.name === ctx.params.name);
      if (file === undefined) throw notFound();
      try {
        const bytes = await getObject(
          `exports/${row.project_id}/${row.id}/${storageSafeName(file.name)}`,
        );
        return {
          status: 200,
          bytes,
          headers: {
            'content-type': file.name.endsWith('.json') ? 'application/json' : 'image/png',
            'content-disposition': `attachment; filename="${storageSafeName(file.name)}"`,
          },
        };
      } catch {
        throw storageUnavailable();
      }
    },
  },
];
