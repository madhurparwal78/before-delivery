import { Router } from 'express';
import crypto from 'node:crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppCtx } from './ctx';
import { ApiError } from './api-errors';
import { requireAuth } from './sessions';
import { respond, currentAllowance, announceAllowance } from './routes-session';
import { memberRole } from './routes-projects';
import { newHex } from './util';
import { rebuildOpeningMinutes } from './allowance';
import { loadTimeline, totalFramesOf } from './timeline';
import { exportLongSide } from '../shared/keyframes';
import { clipLength, frameRate } from '../shared/frames';
import type { ExportRecord, ExportState, Row, Clip, Caption } from '../shared/types';

/** Exports: start, cancel, progress, manifest. */
export function exportRoutes(ctx: AppCtx): Router {
  const r = Router();

  r.post('/projects/:id/exports', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role !== 'owner') throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const cutId = String(body.cut_id ?? '');
      const size = Number(body.size ?? 0);
      if (size !== 2160 && size !== 1080 && size !== 720) {
        throw ApiError.validation({ size: { key: 'other' } });
      }
      const cut = await ctx.db.query('SELECT * FROM cuts WHERE id = $1 AND project_id = $2', [cutId, projectId]);
      if ((cut.rowCount ?? 0) === 0) throw new ApiError('not_found');
      const c = cut.rows[0]!;

      // A repeated request answers 200 with the existing export.
      const existing = await ctx.db.query(
        `SELECT * FROM exports WHERE cut_id = $1 AND size = $2 AND state IN ('queued','running','done') ORDER BY created_at DESC LIMIT 1`,
        [cutId, size],
      );
      if ((existing.rowCount ?? 0) > 0) {
        res.json(await exportJson(existing.rows[0]!));
        return;
      }
      // A queue outage refuses the export before anything is taken.
      if (!ctx.queue.isUp()) {
        if (!(await ctx.queue.ensure())) {
          throw new ApiError('queue_unavailable');
        }
      }
      const rateLabel = await projectRateLabel(ctx, projectId);
      const minutes = exportMinutes(Number(c.total_frames), rateLabel);
      const taken = await ctx.counters.takeExportMinutes(monthNow(), minutes, ctx.config.exportMinuteAllowance, async () => rebuildOpeningMinutes(ctx));
      if (taken === null) {
        const allowance = await currentAllowance(ctx);
        throw new ApiError('allowance_exceeded', {
          used: allowance.export_minutes_used,
          allowance: allowance.export_minutes_allowance,
          usedGB: gbText(allowance.storage_bytes_used),
          allowanceGB: gbText(allowance.storage_bytes_allowance),
        }, { allowance });
      }
      const id = `ex-${newHex(8)}`;
      await ctx.db.query(
        `INSERT INTO exports (id, project_id, cut_id, cut_name, size, state, progress, minutes, stale, requested_by)
         VALUES ($1,$2,$3,$4,$5,'queued',0,$6,false,$7)`,
        [id, projectId, cutId, c.name, size, minutes, person.id],
      );
      await ctx.queue.publish({ export_id: id, project_id: projectId, cut_id: cutId, size, requested_by: person.id });
      await announceAllowance(ctx);
      const row = await ctx.db.query('SELECT * FROM exports WHERE id = $1', [id]);
      res.status(202).json(await exportJson(row.rows[0]!));
    })().catch((err) => respond(res, err));
  });

  r.get('/projects/:id/exports', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      await memberRole(ctx, person.id, projectId);
      const rows = await ctx.db.query('SELECT * FROM exports WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
      const items = [];
      for (const row of rows.rows) {
        items.push(await exportJson(row));
      }
      res.json({ items });
    })().catch((err) => respond(res, err));
  });

  r.get('/exports/:id', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const row = await ctx.db.query('SELECT * FROM exports WHERE id = $1', [req.params.id!]);
      if ((row.rowCount ?? 0) === 0) throw new ApiError('not_found');
      await memberRole(ctx, person.id, row.rows[0]!.project_id);
      res.json(await exportJson(row.rows[0]!));
    })().catch((err) => respond(res, err));
  });

  r.post('/exports/:id/cancel', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const row = await ctx.db.query('SELECT * FROM exports WHERE id = $1', [req.params.id!]);
      if ((row.rowCount ?? 0) === 0) throw new ApiError('not_found');
      const e = row.rows[0]!;
      await memberRole(ctx, person.id, e.project_id);
      if (person.id !== ctx.ownerId) throw new ApiError('forbidden');
      if (e.state === 'done' || e.state === 'failed' || e.state === 'cancelled') {
        throw new ApiError('export_finished', { state: e.state });
      }
      await ctx.db.query(
        `UPDATE exports SET state = 'cancelled', finished_at = $2 WHERE id = $1`,
        [e.id, new Date()],
      );
      await ctx.counters.giveBackExportMinutes(monthNow(), Number(e.minutes));
      await announceAllowance(ctx);
      const updated = await ctx.db.query('SELECT * FROM exports WHERE id = $1', [e.id]);
      ctx.live.publishExport(e.project_id, { type: 'export', export: await exportJson(updated.rows[0]!) });
      res.json(await exportJson(updated.rows[0]!));
    })().catch((err) => respond(res, err));
  });

  r.get('/exports/:id/manifest', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const row = await ctx.db.query('SELECT * FROM exports WHERE id = $1', [req.params.id!]);
      if ((row.rowCount ?? 0) === 0) throw new ApiError('not_found');
      const e = row.rows[0]!;
      await memberRole(ctx, person.id, e.project_id);
      if (e.state !== 'done') throw new ApiError('export_not_ready');
      const link = await presignedManifest(ctx, e.id);
      res.redirect(302, link);
    })().catch((err) => respond(res, err));
  });

  return r;
}

function monthNow(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function projectRateLabel(ctx: AppCtx, projectId: string): Promise<string> {
  const row = await ctx.db.query<{ frame_rate: string }>('SELECT frame_rate FROM projects WHERE id = $1', [projectId]);
  return row.rows[0]?.frame_rate ?? '25';
}

/** minutes = total frames ÷ exact rate ÷ 60, rounded up to a whole minute. */
export function exportMinutes(totalFrames: number, rateLabel: string): number {
  const exact = frameRate(rateLabel).exact;
  const num = BigInt(totalFrames) * exact.den;
  const den = exact.num * 60n;
  const quotient = num / den + (num % den === 0n ? 0n : 1n);
  return Number(quotient);
}

function gbText(bytes: number): string {
  const exact = bytes / 1_000_000_000;
  const scaled = Math.ceil(exact * 10 - 1e-9) / 10;
  return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
}

export async function exportJson(e: Record<string, unknown>): Promise<ExportRecord> {
  return {
    id: String(e.id),
    project_id: String(e.project_id),
    cut_id: String(e.cut_id),
    cut_name: String(e.cut_name),
    size: Number(e.size),
    state: e.state as ExportState,
    progress: Number(e.progress),
    minutes: Number(e.minutes),
    stale: e.stale === true,
    requested_by: String(e.requested_by),
    manifest_checksum: e.manifest_checksum === null ? null : String(e.manifest_checksum),
    created_at: new Date(e.created_at as string).toISOString(),
    finished_at: e.finished_at === null || e.finished_at === undefined ? null : new Date(e.finished_at as string).toISOString(),
  };
}

async function presignedManifest(ctx: AppCtx, exportId: string): Promise<string> {
  const client = (ctx.storage as unknown as { client: import('@aws-sdk/client-s3').S3Client }).client;
  const command = new GetObjectCommand({ Bucket: ctx.config.s3.bucket, Key: `manifests/${exportId}.json` });
  return getSignedUrl(client, command, { expiresIn: ctx.config.manifestLinkSeconds });
}

/** The export worker: 10 steps, progress on every open screen. */
export function makeExportWorker(ctx: AppCtx): (msg: { export_id: string; project_id: string; cut_id: string; size: number; requested_by: string }) => Promise<void> {
  return async (msg) => {
    const row = await ctx.db.query('SELECT * FROM exports WHERE id = $1', [msg.export_id]);
    if ((row.rowCount ?? 0) === 0) return;
    const e = row.rows[0]!;
    if (e.state !== 'queued') return; // second delivery does nothing
    await ctx.db.query(`UPDATE exports SET state = 'running' WHERE id = $1`, [msg.export_id]);
    const running = await ctx.db.query('SELECT * FROM exports WHERE id = $1', [msg.export_id]);
    ctx.live.publishExport(msg.project_id, { type: 'export', export: await exportJson(running.rows[0]!) });
    for (let step = 1; step <= 10; step++) {
      await new Promise((resolve) => setTimeout(resolve, ctx.config.exportStepMs));
      const check = await ctx.db.query<{ state: string }>('SELECT state FROM exports WHERE id = $1', [msg.export_id]);
      if (check.rows[0]!.state !== 'running') return; // cancelled
      const progress = step * 10;
      const updated = await ctx.db.query('UPDATE exports SET progress = $2 WHERE id = $1 RETURNING *', [msg.export_id, progress]);
      ctx.live.publishExport(msg.project_id, { type: 'export', export: await exportJson(updated.rows[0]!) });
    }
    // Write the manifest; a storage outage fails the export.
    try {
      const manifest = await buildManifest(ctx, msg.project_id, msg.cut_id, msg.size);
      await ctx.storage.put(`manifests/${msg.export_id}.json`, new TextEncoder().encode(JSON.stringify(manifest)), 'application/json');
      await ctx.db.query(
        `UPDATE exports SET state = 'done', progress = 100, finished_at = $2, manifest_checksum = $3 WHERE id = $1`,
        [msg.export_id, new Date(), manifest.checksum],
      );
      const done = await ctx.db.query('SELECT * FROM exports WHERE id = $1', [msg.export_id]);
      ctx.live.publishExport(msg.project_id, { type: 'export', export: await exportJson(done.rows[0]!) });
      await queueExportMail(ctx, msg);
    } catch {
      await ctx.db.query(`UPDATE exports SET state = 'failed', finished_at = $2 WHERE id = $1`, [msg.export_id, new Date()]);
      await ctx.counters.giveBackExportMinutes(monthNow(), Number(e.minutes));
      await announceAllowance(ctx);
      const failed = await ctx.db.query('SELECT * FROM exports WHERE id = $1', [msg.export_id]);
      ctx.live.publishExport(msg.project_id, { type: 'export', export: await exportJson(failed.rows[0]!) });
    }
  };
}

async function queueExportMail(ctx: AppCtx, msg: { export_id: string; project_id: string; cut_id: string; size: number; requested_by: string }): Promise<void> {
  const project = await ctx.db.query<{ title: string }>('SELECT title FROM projects WHERE id = $1', [msg.project_id]);
  const cut = await ctx.db.query<{ name: string }>('SELECT name FROM cuts WHERE id = $1', [msg.cut_id]);
  const e = await ctx.db.query<{ manifest_checksum: string }>('SELECT manifest_checksum FROM exports WHERE id = $1', [msg.export_id]);
  const subject = `Gatecut · export ready · ${cut.rows[0]!.name} · ${msg.size}p`;
  const body = `The manifest checksum is ${e.rows[0]!.manifest_checksum}.\nProject page: ${ctx.config.publicUrl}/projects/${msg.project_id}`;
  await ctx.db.query(
    `INSERT INTO outbox (id, workspace_id, to_address, subject, body, state) VALUES ($1,$2,$3,$4,$5,'waiting')`,
    [`ob-${newHex(10)}`, ctx.workspaceId, await emailOf(ctx, msg.requested_by), subject, body],
  );
  void project;
}

async function emailOf(ctx: AppCtx, personId: string): Promise<string> {
  const rows = await ctx.db.query<{ email: string }>('SELECT email FROM people WHERE id = $1', [personId]);
  return rows.rows[0]!.email;
}

/** The manifest form, with frame totals and the checksum. */
export async function buildManifest(
  ctx: AppCtx,
  projectId: string,
  cutId: string,
  size: number,
): Promise<Record<string, unknown> & { checksum: string }> {
  const project = await ctx.db.query('SELECT id, title, frame_rate, aspect_ratio FROM projects WHERE id = $1', [projectId]);
  const p = project.rows[0]!;
  const cut = await ctx.db.query('SELECT * FROM cuts WHERE id = $1', [cutId]);
  const c = cut.rows[0]!;
  const snap = c.snapshot as { rows: Row[]; clips: Clip[]; captions: Caption[] };
  const media = await ctx.db.query('SELECT id, sha256 FROM media');
  const shaById = new Map(media.rows.map((row: { id: string; sha256: string }) => [row.id, row.sha256]));
  const dims = (await import('../shared/frames')).aspectSize(p.aspect_ratio);
  const width = p.aspect_ratio === '9:16' || dims.height > dims.width ? size : exportLongSide(size, dims.width, dims.height);
  const height = width === size ? exportLongSide(size, dims.width, dims.height) : size;
  const manifest = {
    project: { id: p.id, title: p.title },
    cut: { id: c.id, name: c.name },
    frame_rate: frameRate(p.frame_rate).exact.num + '/' + frameRate(p.frame_rate).exact.den,
    size,
    width,
    height,
    total_frames: Number(c.total_frames),
    rows: snap.rows.map((row) => ({
      row_id: row.id,
      name: row.name,
      kind: row.kind,
      items: snap.clips
        .filter((clip) => clip.row_id === row.id)
        .map((clip) => ({
          clip_id: clip.id,
          name: clip.name,
          kind: clip.kind,
          media_sha256: clip.media_id !== null ? shaById.get(clip.media_id) ?? null : null,
          start_frame: clip.start_frame,
          end_frame: clip.end_frame,
          source_in: clip.source_in,
          source_out: clip.source_out,
          speed_percent: clip.speed_percent,
          hidden: clip.hidden,
          keyframes: clip.keyframes,
        })),
    })),
    captions: snap.captions.map((cap) => ({
      row_id: cap.row_id,
      start_frame: cap.start_frame,
      end_frame: cap.end_frame,
      text: cap.text,
    })),
  };
  const without = { ...manifest };
  const serialised = JSON.stringify(without, Object.keys(without).sort());
  const checksum = 'sha256:' + crypto.createHash('sha256').update(serialised).digest('hex');
  return { ...manifest, checksum };
}
