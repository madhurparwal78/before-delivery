import { Router, type Response } from 'express';
import crypto from 'node:crypto';
import type { AppCtx } from './ctx';
import { ApiError } from './api-errors';
import { requireAuth } from './sessions';
import { respond } from './routes-session';
import { memberRole } from './routes-projects';
import { codePoints, newHex } from './util';
import { loadTimeline, totalFramesOf } from './timeline';
import { commentJson } from './routes-comments';
import type { Clip, Caption, Row, Cut, Approval } from '../shared/types';

/** Cuts, compare, restore, approvals, review links and the client review. */
export function cutRoutes(ctx: AppCtx): Router {
  const r = Router();

  r.get('/projects/:id/cuts', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      await memberRole(ctx, person.id, projectId);
      const rows = await ctx.db.query(
        'SELECT id, name, version, total_frames, shared, created_at FROM cuts WHERE project_id = $1 ORDER BY created_at',
        [projectId],
      );
      const items: Cut[] = [];
      for (const row of rows.rows) {
        items.push(await cutJson(ctx, row));
      }
      res.json({ items });
    })().catch((err) => respond(res, err));
  });

  r.post('/projects/:id/cuts', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role !== 'owner') throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const name = String(body.name ?? '').trim();
      if (codePoints(name) < 1 || codePoints(name) > 60) {
        throw ApiError.validation({ name: { key: 'name' } });
      }
      const existing = await ctx.db.query('SELECT 1 FROM cuts WHERE project_id = $1 AND name = $2', [projectId, name]);
      if ((existing.rowCount ?? 0) > 0) {
        throw new ApiError('cut_name_taken', { name });
      }
      const timeline = await loadTimeline(ctx.db, projectId);
      if (timeline === null) throw new ApiError('not_found');
      const snapshot = {
        rows: timeline.rows,
        clips: timeline.clips,
        captions: timeline.captions,
      };
      const id = `cut-${newHex(6)}`;
      await ctx.db.query(
        `INSERT INTO cuts (id, project_id, name, version, total_frames, shared, snapshot)
         VALUES ($1,$2,$3,$4,$5,false,$6)`,
        [id, projectId, name, timeline.meta.version, timeline.totalFrames, JSON.stringify(snapshot)],
      );
      const row = await ctx.db.query('SELECT * FROM cuts WHERE id = $1', [id]);
      res.status(201).json(await cutJson(ctx, row.rows[0]!));
    })().catch((err) => respond(res, err));
  });

  r.get('/projects/:id/cuts/:cutId', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      await memberRole(ctx, person.id, projectId);
      const cut = await ctx.db.query('SELECT * FROM cuts WHERE id = $1 AND project_id = $2', [req.params.cutId!, projectId]);
      if ((cut.rowCount ?? 0) === 0) throw new ApiError('not_found');
      const snap = cut.rows[0]!.snapshot as { rows: Row[]; clips: Clip[]; captions: Caption[] };
      res.json({
        cut: await cutJson(ctx, cut.rows[0]!),
        rows: snap.rows,
        clips: snap.clips,
        captions: snap.captions,
      });
    })().catch((err) => respond(res, err));
  });

  r.get('/projects/:id/cuts/:a/compare/:b', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      await memberRole(ctx, person.id, projectId);
      const a = await ctx.db.query('SELECT * FROM cuts WHERE id = $1 AND project_id = $2', [req.params.a!, projectId]);
      const b = await ctx.db.query('SELECT * FROM cuts WHERE id = $1 AND project_id = $2', [req.params.b!, projectId]);
      if (a.rowCount === 0 || (b.rowCount ?? 0) === 0) throw new ApiError('not_found');
      const snapA = a.rows[0]!.snapshot as { clips: Clip[] };
      const snapB = b.rows[0]!.snapshot as { clips: Clip[] };
      const added: string[] = [];
      const removed: string[] = [];
      const changed: { clip_id: string; from: { row_id: string; start_frame: number; end_frame: number }; to: { row_id: string; start_frame: number; end_frame: number } }[] = [];
      for (const cb of snapB.clips) {
        if (!snapA.clips.some((c) => c.id === cb.id)) added.push(cb.id);
      }
      for (const ca of snapA.clips) {
        if (!snapB.clips.some((c) => c.id === ca.id)) removed.push(ca.id);
      }
      for (const cb of snapB.clips) {
        const ca = snapA.clips.find((c) => c.id === cb.id);
        if (ca === undefined) continue;
        if (ca.start_frame !== cb.start_frame || ca.end_frame !== cb.end_frame || ca.row_id !== cb.row_id) {
          changed.push({
            clip_id: cb.id,
            from: { row_id: ca.row_id, start_frame: ca.start_frame, end_frame: ca.end_frame },
            to: { row_id: cb.row_id, start_frame: cb.start_frame, end_frame: cb.end_frame },
          });
        }
      }
      res.json({
        added,
        removed,
        changed,
        frame_delta: Number(b.rows[0]!.total_frames) - Number(a.rows[0]!.total_frames),
      });
    })().catch((err) => respond(res, err));
  });

  r.post('/projects/:id/cuts/:cutId/approval', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role !== 'owner' && role !== 'commenter') throw new ApiError('forbidden');
      const cutId = req.params.cutId!;
      const cut = await ctx.db.query('SELECT id FROM cuts WHERE id = $1 AND project_id = $2', [cutId, projectId]);
      if ((cut.rowCount ?? 0) === 0) throw new ApiError('not_found');
      await ctx.db.query(
        `INSERT INTO cut_approvals (cut_id, name, at) VALUES ($1,$2,$3)
         ON CONFLICT (cut_id, name) DO NOTHING`,
        [cutId, person.name, new Date()],
      );
      const approvals = await approvalsOf(ctx, cutId);
      res.json({ cut_id: cutId, approvals });
    })().catch((err) => respond(res, err));
  });

  r.post('/projects/:id/cuts/:cutId/restore', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role !== 'owner') throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const cutId = req.params.cutId!;
      const cut = await ctx.db.query('SELECT * FROM cuts WHERE id = $1 AND project_id = $2', [cutId, projectId]);
      if ((cut.rowCount ?? 0) === 0) throw new ApiError('not_found');
      const output = await restoreCut(ctx, projectId, cut.rows[0]!, person, {
        op_id: String(body.op_id ?? ''),
        base_version: Number(body.base_version ?? -1),
      });
      ctx.live.publishOp(projectId, {
        type: 'op',
        version: Number(output.version),
        author: { id: person.id, name: person.name },
        op: { type: 'restore_cut', cut: String(cut.rows[0]!.name ?? '') },
        changes: output.changes,
        removed: output.removed,
        stopped: null,
      });
      res.json(output);
    })().catch((err) => respond(res, err));
  });

  r.post('/projects/:id/review-links', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role !== 'owner') throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const cutId = String(body.cut_id ?? '');
      const expires = Number(body.expires_in_seconds ?? 0);
      if (expires < 10 || expires > 2592000) {
        throw ApiError.validation({ expires_in_seconds: { key: 'expires_in_seconds' } });
      }
      const cut = await ctx.db.query('SELECT id FROM cuts WHERE id = $1 AND project_id = $2', [cutId, projectId]);
      if ((cut.rowCount ?? 0) === 0) throw new ApiError('not_found');
      const token = `rv-${newHex(12)}`;
      const id = `lnk-${newHex(6)}`;
      const expiresAt = new Date(Date.now() + expires * 1000);
      await ctx.db.query(
        `INSERT INTO review_links (id, project_id, token, cut_id, expires_at, state) VALUES ($1,$2,$3,$4,$5,'active')`,
        [id, projectId, token, cutId, expiresAt],
      );
      await ctx.db.query('UPDATE cuts SET shared = true WHERE id = $1', [cutId]);
      res.status(201).json(await linkJson(ctx, id));
    })().catch((err) => respond(res, err));
  });

  r.get('/projects/:id/review-links', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      if (role !== 'owner') throw new ApiError('forbidden');
      await refreshExpiry(ctx);
      const rows = await ctx.db.query('SELECT id FROM review_links WHERE project_id = $1 ORDER BY created_at', [projectId]);
      const items = [];
      for (const row of rows.rows) {
        items.push(await linkJson(ctx, row.id));
      }
      res.json({ items });
    })().catch((err) => respond(res, err));
  });

  r.put('/review-links/:id', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const linkId = req.params.id!;
      const role = await linkRole(ctx, person.id, linkId);
      if (role !== 'owner') throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const cutId = String(body.cut_id ?? '');
      await ctx.db.query('UPDATE review_links SET cut_id = $2 WHERE id = $1', [linkId, cutId]);
      await ctx.db.query('UPDATE cuts SET shared = true WHERE id = $1', [cutId]);
      const link = await linkJson(ctx, linkId);
      ctx.live.publishCutShared(String(link.project_id), { type: 'cut_shared', cut: { id: cutId } });
      res.json(link);
    })().catch((err) => respond(res, err));
  });

  r.post('/review-links/:id/regenerate', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const linkId = req.params.id!;
      const role = await linkRole(ctx, person.id, linkId);
      if (role !== 'owner') throw new ApiError('forbidden');
      const old = await ctx.db.query('SELECT token, cut_id, expires_at FROM review_links WHERE id = $1', [linkId]);
      const o = old.rows[0]!;
      await ctx.db.query("UPDATE review_links SET state = 'revoked' WHERE id = $1", [linkId]);
      ctx.live.closeReview(linkId);
      const token = `rv-${newHex(12)}`;
      const id = `lnk-${newHex(6)}`;
      await ctx.db.query(
        `INSERT INTO review_links (id, project_id, token, cut_id, expires_at, state) VALUES ($1,(SELECT project_id FROM review_links WHERE id = $2),$3,$4,$5,'active')`,
        [id, linkId, token, o.cut_id, o.expires_at],
      );
      res.status(201).json(await linkJson(ctx, id));
    })().catch((err) => respond(res, err));
  });

  r.delete('/review-links/:id', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const linkId = req.params.id!;
      const role = await linkRole(ctx, person.id, linkId);
      if (role !== 'owner') throw new ApiError('forbidden');
      await ctx.db.query("UPDATE review_links SET state = 'revoked' WHERE id = $1", [linkId]);
      ctx.live.closeReview(linkId);
      res.status(204).end();
    })().catch((err) => respond(res, err));
  });

  // ---- The client review surface: the token is the only credential. ----

  r.get('/review/:token', (req, res) => {
    void (async () => {
      await refreshExpiry(ctx);
      const link = await reviewLinkByToken(ctx, req.params.token!);
      const body = await reviewBody(ctx, link);
      const json = JSON.stringify(body);
      const etag = `"${crypto.createHash('sha256').update(json).digest('hex')}"`;
      if (req.headers['if-none-match'] === etag) {
        res.status(304).set('ETag', etag).set('Cache-Control', 'private, no-cache').end();
        return;
      }
      res.set('ETag', etag).set('Cache-Control', 'private, no-cache').json(body);
    })().catch((err) => respond(res, err));
  });

  r.post('/review/:token/comments', (req, res) => {
    void (async () => {
      await refreshExpiry(ctx);
      const link = await reviewLinkByToken(ctx, req.params.token!);
      const body = req.body as Record<string, unknown>;
      const name = String(body.name ?? '').trim();
      const noteBody = String(body.body ?? '');
      const frame = Number(body.frame ?? 0);
      if (codePoints(name) < 1 || codePoints(name) > 60) {
        throw ApiError.validation({ name: { key: 'other' } });
      }
      if (codePoints(noteBody) < 1 || codePoints(noteBody) > 2000 || noteBody.trim() === '') {
        throw ApiError.validation({ body: { key: 'body' } });
      }
      const id = `cm-${newHex(8)}`;
      await ctx.db.query(
        `INSERT INTO comments (id, project_id, author_name, body, visibility, cut_id, frame, live_frame, mentions, created_at)
         VALUES ($1,$2,$3,$4,'review',$5,$6::numeric,$6::numeric,'{}',$7)`,
        [id, link.project_id, name, noteBody, link.cut_id, frame, new Date()],
      );
      const row = await ctx.db.query('SELECT * FROM comments WHERE id = $1', [id]);
      res.status(201).json(await commentJson(ctx, row.rows[0]!, link.project_id));
    })().catch((err) => respond(res, err));
  });

  r.post('/review/:token/approve', (req, res) => {
    void (async () => {
      await refreshExpiry(ctx);
      const link = await reviewLinkByToken(ctx, req.params.token!);
      const body = req.body as Record<string, unknown>;
      const name = String(body.name ?? '').trim();
      if (codePoints(name) < 1 || codePoints(name) > 60) {
        throw ApiError.validation({ name: { key: 'other' } });
      }
      await ctx.db.query(
        `INSERT INTO cut_approvals (cut_id, name, at) VALUES ($1,$2,$3) ON CONFLICT (cut_id, name) DO NOTHING`,
        [link.cut_id, name, new Date()],
      );
      res.json({ cut_id: link.cut_id, approvals: await approvalsOf(ctx, link.cut_id) });
    })().catch((err) => respond(res, err));
  });

  return r;
}

async function linkRole(ctx: AppCtx, personId: string, linkId: string): Promise<string> {
  const rows = await ctx.db.query<{ role: string }>(
    `SELECT m.role FROM review_links l JOIN members m ON m.project_id = l.project_id WHERE l.id = $1 AND m.person_id = $2`,
    [linkId, personId],
  );
  if ((rows.rowCount ?? 0) === 0) throw new ApiError('not_found');
  return rows.rows[0]!.role;
}

export async function linkJson(ctx: AppCtx, id: string): Promise<Record<string, unknown>> {
  const rows = await ctx.db.query('SELECT * FROM review_links WHERE id = $1', [id]);
  const l = rows.rows[0]!;
  const expired = new Date(l.expires_at).getTime() < Date.now();
  const state = l.state === 'active' && expired ? 'expired' : l.state;
  return {
    id: l.id,
    token: l.token,
    url: `${ctx.config.publicUrl}/review/${l.token}`,
    cut_id: l.cut_id,
    expires_at: l.expires_at,
    state,
    project_id: l.project_id,
  };
}

export async function refreshExpiry(ctx: AppCtx): Promise<void> {
  const expired = await ctx.db.query(
    `SELECT id FROM review_links WHERE state = 'active' AND expires_at < now()`,
  );
  for (const row of expired.rows) {
    await ctx.db.query("UPDATE review_links SET state = 'expired' WHERE id = $1", [row.id]);
    ctx.live.closeReview(row.id);
  }
}

async function reviewLinkByToken(ctx: AppCtx, token: string): Promise<{ id: string; project_id: string; cut_id: string; state: string; ownerName: string }> {
  const rows = await ctx.db.query('SELECT * FROM review_links WHERE token = $1', [token]);
  if ((rows.rowCount ?? 0) === 0) throw new ApiError('not_found');
  const l = rows.rows[0]!;
  if (l.state === 'revoked') {
    const owner = await ownerNameOf(ctx, l.project_id);
    throw new ApiError('link_revoked', { owner });
  }
  if (new Date(l.expires_at).getTime() < Date.now() || l.state === 'expired') {
    const owner = await ownerNameOf(ctx, l.project_id);
    throw new ApiError('link_expired', { owner });
  }
  return { id: l.id, project_id: l.project_id, cut_id: l.cut_id, state: l.state, ownerName: '' };
}

async function ownerNameOf(ctx: AppCtx, projectId: string): Promise<string> {
  const rows = await ctx.db.query<{ name: string }>(
    `SELECT p.name FROM members m JOIN people p ON p.id = m.person_id WHERE m.project_id = $1 AND m.role = 'owner'`,
    [projectId],
  );
  return rows.rows[0]?.name ?? 'the owner';
}

export async function reviewBody(ctx: AppCtx, link: { project_id: string; cut_id: string }): Promise<Record<string, unknown>> {
  const project = await ctx.db.query('SELECT id, title, frame_rate, aspect_ratio FROM projects WHERE id = $1', [link.project_id]);
  const p = project.rows[0]!;
  const cut = await ctx.db.query('SELECT * FROM cuts WHERE id = $1', [link.cut_id]);
  const c = cut.rows[0]!;
  const snap = c.snapshot as { rows: Row[]; clips: Clip[]; captions: Caption[] };
  const comments = await ctx.db.query(
    `SELECT * FROM comments WHERE project_id = $1 AND cut_id = $2 AND visibility = 'review' ORDER BY created_at`,
    [link.project_id, link.cut_id],
  );
  const items = await Promise.all(comments.rows.map((row: Record<string, unknown>) => commentJson(ctx, row, link.project_id)));
  const size = (await import('../shared/frames')).aspectSize(p.aspect_ratio);
  return {
    project: {
      title: p.title,
      frame_rate: p.frame_rate,
      aspect_ratio: p.aspect_ratio,
      width: size.width,
      height: size.height,
    },
    owner_name: await ownerNameOf(ctx, link.project_id),
    cut: {
      id: c.id,
      name: c.name,
      total_frames: Number(c.total_frames),
      rows: snap.rows,
      clips: snap.clips,
      captions: snap.captions,
    },
    comments: items,
    approvals: await approvalsOf(ctx, link.cut_id),
  };
}

export async function approvalsOf(ctx: AppCtx, cutId: string): Promise<Approval[]> {
  const rows = await ctx.db.query('SELECT name, at FROM cut_approvals WHERE cut_id = $1 ORDER BY at', [cutId]);
  return rows.rows.map((row: { name: string; at: Date }) => ({ name: row.name, at: new Date(row.at).toISOString() }));
}

export async function cutJson(ctx: AppCtx, row: Record<string, unknown>): Promise<Cut> {
  return {
    id: String(row.id),
    name: String(row.name),
    version: Number(row.version),
    total_frames: Number(row.total_frames),
    shared: row.shared === true,
    approvals: await approvalsOf(ctx, String(row.id)),
    created_at: new Date(row.created_at as string).toISOString(),
  };
}

/** Restoring a cut: one op that replaces rows, clips and captions. */
async function restoreCut(
  ctx: AppCtx,
  projectId: string,
  cut: Record<string, unknown>,
  person: { id: string; name: string },
  base: { op_id: string; base_version: number },
): Promise<Record<string, unknown>> {
  const snap = cut.snapshot as { rows: Row[]; clips: Clip[]; captions: Caption[] };
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT version FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
    const meta = await client.query<{ version: number }>('SELECT version FROM projects WHERE id = $1', [projectId]);
    const oldRows = await client.query('SELECT * FROM rows WHERE project_id = $1', [projectId]);
    const oldClips = await client.query('SELECT * FROM clips WHERE project_id = $1', [projectId]);
    const oldCaptions = await client.query('SELECT * FROM captions WHERE project_id = $1', [projectId]);

    // Row locked flags and positions are not part of the restore: an item on
    // a locked row refuses the whole restore only when it would add, remove
    // or change it. An item that is identical in the cut and the timeline
    // does not touch the row.
    const currentRows = oldRows.rows as unknown as { id: string; name: string; locked: boolean; position: number }[];
    const lockedIds = new Set(currentRows.filter((rw) => rw.locked).map((rw) => rw.id));
    const sameClip = (snapClip: { id: string; row_id: string; start_frame: number; end_frame: number; source_in: number; source_out: number; speed_percent: number; hidden: boolean; group_id: string | null }, now: { id: string; row_id: string; start_frame: number; end_frame: number; source_in: number; source_out: number; speed_percent: number; hidden: boolean; group_id: string | null }): boolean =>
      snapClip.row_id === now.row_id &&
      Number(snapClip.start_frame) === Number(now.start_frame) &&
      Number(snapClip.end_frame) === Number(now.end_frame) &&
      Number(snapClip.source_in) === Number(now.source_in) &&
      Number(snapClip.source_out) === Number(now.source_out) &&
      Number(snapClip.speed_percent) === Number(now.speed_percent) &&
      snapClip.hidden === now.hidden &&
      (snapClip.group_id ?? null) === (now.group_id ?? null);
    const currentClipById = new Map((oldClips.rows as unknown as { id: string; row_id: string; start_frame: number; end_frame: number; source_in: number; source_out: number; speed_percent: number; hidden: boolean; group_id: string | null }[]).map((c) => [c.id, c]));
    const wouldTouchLocked =
      snap.clips.some((c) => {
        if (!lockedIds.has(c.row_id)) return false;
        const now = currentClipById.get(c.id);
        return now === undefined || !sameClip(c, now);
      }) ||
      snap.captions.some((c) => lockedIds.has(c.row_id)) ||
      (oldClips.rows as unknown as { id: string; row_id: string }[]).some((c) => lockedIds.has(c.row_id) && !snap.clips.some((s) => s.id === c.id));
    if (wouldTouchLocked) {
      await client.query('ROLLBACK');
      const lockedRow = currentRows.find((rw) => lockedIds.has(rw.id));
      throw new ApiError('row_locked', { row: lockedRow?.name ?? 'row' });
    }

    // Remove clips and captions the cut does not hold.
    const snapClipIds = new Set(snap.clips.map((c) => c.id));
    const snapCaptionIds = new Set(snap.captions.map((c) => c.id));
    const removed: string[] = [];
    for (const c of oldClips.rows as { id: string }[]) {
      if (!snapClipIds.has(c.id)) {
        await client.query('DELETE FROM clips WHERE id = $1', [c.id]);
        removed.push(c.id);
      }
    }
    for (const c of oldCaptions.rows as { id: string }[]) {
      if (!snapCaptionIds.has(c.id)) {
        await client.query('DELETE FROM captions WHERE id = $1', [c.id]);
        removed.push(c.id);
      }
    }
    // Add back or update the cut's items with their own ids.
    const changedClips: Clip[] = [];
    for (const clip of snap.clips) {
      await client.query(
        `INSERT INTO clips (id, project_id, row_id, name, kind, media_id, start_frame, end_frame, source_in, source_out,
           speed_percent, hidden, group_id, text, text_colour, box_colour, font_weight, keyframes, add_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
           COALESCE((SELECT add_order FROM clips WHERE id = $1), (SELECT COALESCE(MAX(add_order),0)+1 FROM clips WHERE project_id = $2)))
         ON CONFLICT (id) DO UPDATE SET row_id=$3, name=$4, kind=$5, media_id=$6, start_frame=$7,
           end_frame=$8, source_in=$9, source_out=$10, speed_percent=$11, hidden=$12, group_id=$13, text=$14,
           text_colour=$15, box_colour=$16, font_weight=$17, keyframes=$18`,
        [clip.id, projectId, clip.row_id, clip.name, clip.kind, clip.media_id, clip.start_frame,
          clip.end_frame, clip.source_in, clip.source_out, clip.speed_percent, clip.hidden, clip.group_id,
          clip.text, clip.text_colour, clip.box_colour, clip.font_weight, JSON.stringify(clip.keyframes)],
      );
      changedClips.push(clip);
    }
    const changedCaptions: Caption[] = [];
    for (const cap of snap.captions) {
      await client.query(
        `INSERT INTO captions (id, project_id, row_id, start_frame, end_frame, text) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET row_id=$3, start_frame=$4, end_frame=$5, text=$6`,
        [cap.id, projectId, cap.row_id, cap.start_frame, cap.end_frame, cap.text],
      );
      changedCaptions.push(cap);
    }
    const version = meta.rows[0]!.version + 1;
    await client.query(
      `INSERT INTO ops (project_id, version, person_id, person_name, op_type, op, undo_data)
       VALUES ($1,$2,$3,$4,'restore_cut',$5,$6)`,
      [projectId, version, person.id, person.name,
        JSON.stringify({ type: 'restore_cut', cut_id: cut.id, op_id: base.op_id, base_version: base.base_version }),
        JSON.stringify({ kind: 'restore_cut', oldRows: oldRows.rows, oldClips: oldClips.rows, oldCaptions: oldCaptions.rows })],
    );
    await client.query('UPDATE projects SET version = $2 WHERE id = $1', [projectId, version]);
    await client.query('DELETE FROM redo_stack WHERE person_id = $1 AND project_id = $2', [person.id, projectId]);
    await client.query('INSERT INTO undo_stack (person_id, project_id, version) VALUES ($1,$2,$3)', [person.id, projectId, version]);
    await client.query('COMMIT');
    return {
      version,
      changes: { clips: changedClips, captions: changedCaptions, comments: [], rows: [] },
      removed,
      stopped: null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function respond404(res: Response): void {
  respond(res, new ApiError('not_found'));
}
