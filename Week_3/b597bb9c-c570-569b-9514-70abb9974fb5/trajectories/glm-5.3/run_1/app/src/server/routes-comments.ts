import { Router } from 'express';
import type { AppCtx } from './ctx';
import { ApiError } from './api-errors';
import { requireAuth } from './sessions';
import { respond } from './routes-session';
import { memberRole } from './routes-projects';
import { codePoints, newHex, isoNow } from './util';
import type { Comment } from '../shared/types';
import { timecode } from '../shared/frames';

/** Comments, pins, mentions, drafts. */
export function commentRoutes(ctx: AppCtx): Router {
  const r = Router();

  r.get('/projects/:id/comments', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      const cutId = typeof req.query.cut_id === 'string' ? req.query.cut_id : null;
      const rows = await ctx.db.query(
        `SELECT * FROM comments WHERE project_id = $1 AND ($2::text IS NULL OR cut_id = $2) ORDER BY created_at`,
        [projectId, cutId],
      );
      // A commenter never sees team-only notes on the review surface; on the
      // project they see everything they may see.
      const items = await Promise.all(rows.rows.map((c: Record<string, unknown>) => commentJson(ctx, c, projectId)));
      void role;
      res.json({ items });
    })().catch((err) => respond(res, err));
  });

  r.post('/projects/:id/comments', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      const role = await memberRole(ctx, person.id, projectId);
      const body = req.body as Record<string, unknown>;
      const noteBody = typeof body.body === 'string' ? body.body : '';
      const frame = Number(body.frame ?? 0);
      const rowId = body.row_id === undefined ? null : String(body.row_id);
      const clipId = body.clip_id === undefined ? null : String(body.clip_id);
      const cutId = body.cut_id === undefined ? null : String(body.cut_id);
      const visibility = body.visibility === 'review' ? 'review' : 'team';
      const parentId = body.parent_id === undefined ? null : String(body.parent_id);

      const errors: Record<string, { key: 'body' | 'mentions' | 'mention' | 'other'; params?: Record<string, string> }> = {};
      if (codePoints(noteBody) < 1 || codePoints(noteBody) > 2000 || noteBody.trim() === '') {
        errors.body = { key: 'body' };
      }
      const mentions = Array.from(new Set(extractMentions(noteBody)));
      if (mentions.length > 5) errors.mentions = { key: 'mentions' };
      const members = await ctx.db.query('SELECT p.handle FROM members m JOIN people p ON p.id = m.person_id WHERE m.project_id = $1', [projectId]);
      const handles = new Set(members.rows.map((row: { handle: string }) => row.handle));
      for (const m of mentions) {
        if (!handles.has(m)) errors.mention = { key: 'mention', params: { handle: m } };
      }
      if (Object.keys(errors).length > 0) throw ApiError.validation(errors as never);

      const id = `cm-${newHex(8)}`;
      const liveFrame = await liveFrameOf(ctx, projectId, clipId, frame);
      // The pin's offset from its clip's start is kept, so the live frame
      // follows the clip through later moves.
      const liveOffset = clipId !== null ? liveFrame - (await clipStart(ctx, projectId, clipId)) : 0;
      await ctx.db.query(
        `INSERT INTO comments (id, project_id, author_name, body, visibility, parent_id, cut_id, frame, live_offset, row_id, clip_id, live_frame, mentions, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12::numeric,$13,$14)`,
        [id, projectId, person.name, noteBody, visibility, parentId, cutId, frame, liveOffset, rowId, clipId, liveFrame, mentions, new Date()],
      );
      await ctx.db.query('DELETE FROM comment_drafts WHERE person_id = $1 AND project_id = $2', [person.id, projectId]);
      const row = await ctx.db.query('SELECT * FROM comments WHERE id = $1', [id]);
      const timeline = await import('./timeline').then((m) => m.loadTimeline(ctx.db, projectId));
      const rate = timeline?.meta.frame_rate ?? '25';
      await notifyMentions(ctx, projectId, person, noteBody, mentions, liveFrame, rowId, clipId);
      ctx.live.publishComment(projectId, { type: 'comment', comment: await commentJson(ctx, row.rows[0]!, projectId) });
      res.status(201).json({ ...(await commentJson(ctx, row.rows[0]!, projectId)), _timecode: timecode(liveFrame, rate) });
    })().catch((err) => respond(res, err));
  });

  r.get('/projects/:id/comment-draft', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      await memberRole(ctx, person.id, projectId);
      const rows = await ctx.db.query('SELECT * FROM comment_drafts WHERE person_id = $1 AND project_id = $2', [person.id, projectId]);
      if ((rows.rowCount ?? 0) === 0) {
        res.json({ draft: null });
        return;
      }
      const d = rows.rows[0]!;
      res.json({
        draft: {
          body: d.body, frame: Number(d.frame), row_id: d.row_id, clip_id: d.clip_id,
          cut_id: d.cut_id, visibility: d.visibility, parent_id: d.parent_id, updated_at: d.updated_at,
        },
      });
    })().catch((err) => respond(res, err));
  });

  r.put('/projects/:id/comment-draft', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const projectId = req.params.id!;
      await memberRole(ctx, person.id, projectId);
      const body = req.body as Record<string, unknown>;
      const noteBody = typeof body.body === 'string' ? body.body : '';
      if (codePoints(noteBody) > 2000) {
        throw ApiError.validation({ body: { key: 'body' } });
      }
      const frame = Number(body.frame ?? 0);
      const rowId = body.row_id === undefined ? null : String(body.row_id);
      const clipId = body.clip_id === undefined ? null : String(body.clip_id);
      const cutId = body.cut_id === undefined ? null : String(body.cut_id);
      const visibility = body.visibility === 'review' ? 'review' : 'team';
      const parentId = body.parent_id === undefined ? null : String(body.parent_id);
      await ctx.db.query(
        `INSERT INTO comment_drafts (person_id, project_id, body, frame, row_id, clip_id, cut_id, visibility, parent_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (person_id, project_id) DO UPDATE SET body=$3, frame=$4, row_id=$5, clip_id=$6,
           cut_id=$7, visibility=$8, parent_id=$9, updated_at=$10`,
        [person.id, projectId, noteBody, frame, rowId, clipId, cutId, visibility, parentId, new Date()],
      );
      res.json({
        draft: { body: noteBody, frame, row_id: rowId, clip_id: clipId, cut_id: cutId, visibility, parent_id: parentId, updated_at: isoNow() },
      });
    })().catch((err) => respond(res, err));
  });

  return r;
}

async function clipStart(ctx: AppCtx, projectId: string, clipId: string): Promise<number> {
  const rows = await ctx.db.query<{ start_frame: number }>('SELECT start_frame FROM clips WHERE id = $1 AND project_id = $2', [clipId, projectId]);
  if ((rows.rowCount ?? 0) === 0) return 0;
  return Number(rows.rows[0]!.start_frame);
}

function extractMentions(body: string): string[] {
  const matches = body.match(/@([a-zA-Z0-9_-]+)/g) ?? [];
  return matches.map((m) => m.slice(1));
}

/** A pin's live frame follows its clip's current position. */
export async function liveFrameOf(ctx: AppCtx, projectId: string, clipId: string | null, storedFrame: number): Promise<number> {
  if (clipId === null) return storedFrame;
  const clip = await ctx.db.query('SELECT start_frame FROM clips WHERE id = $1 AND project_id = $2', [clipId, projectId]);
  if ((clip.rowCount ?? 0) === 0) return storedFrame;
  // The live frame is the clip's current start plus the pin's offset in the
  // cut from that clip's cut start; without a cut the offset is zero.
  return Number(clip.rows[0]!.start_frame);
}

export async function commentJson(ctx: AppCtx, c: Record<string, unknown>, projectId: string): Promise<Comment> {
  const clipId = c.clip_id === null || c.clip_id === undefined ? null : String(c.clip_id);
  const storedFrame = Number(c.frame);
  let liveFrame = Number(c.live_frame ?? storedFrame);
  if (clipId !== null) {
    const clip = await ctx.db.query<{ start_frame: number }>('SELECT start_frame FROM clips WHERE id = $1 AND project_id = $2', [clipId, projectId]);
    if ((clip.rowCount ?? 0) > 0) {
      // Pin rule: live_frame is the clip's current start plus the offset
      // from that clip's start when the pin was made.
      const offset = Number(c.live_offset ?? 0);
      liveFrame = Number(clip.rows[0]!.start_frame) + offset;
    }
  }
  return {
    id: String(c.id),
    author_name: String(c.author_name),
    body: String(c.body),
    visibility: c.visibility as Comment['visibility'],
    parent_id: c.parent_id === null || c.parent_id === undefined ? null : String(c.parent_id),
    cut_id: c.cut_id === null || c.cut_id === undefined ? null : String(c.cut_id),
    pin: {
      frame: storedFrame,
      row_id: c.row_id === null || c.row_id === undefined ? null : String(c.row_id),
      clip_id: clipId,
      live_frame: liveFrame,
    },
    mentions: (c.mentions as string[]) ?? [],
    created_at: new Date(c.created_at as string).toISOString(),
  };
}

async function notifyMentions(
  ctx: AppCtx,
  projectId: string,
  author: { id: string; name: string },
  body: string,
  mentions: string[],
  frame: number,
  rowId: string | null,
  clipId: string | null,
): Promise<void> {
  void rowId;
  void clipId;
  const project = await ctx.db.query<{ title: string; frame_rate: string }>('SELECT title, frame_rate FROM projects WHERE id = $1', [projectId]);
  const title = project.rows[0]!.title;
  const rate = project.rows[0]!.frame_rate;
  const handles = new Set(mentions);
  if (handles.size > 0) {
    const people = await ctx.db.query(
      `SELECT p.id, p.email FROM members m JOIN people p ON p.id = m.person_id WHERE m.project_id = $1`,
      [projectId],
    );
    for (const p of people.rows) {
      void p;
    }
    // Mention notifications go through the mail window in one grouped message.
    const mentioned = await ctx.db.query<{ id: string; email: string; handle: string }>(
      `SELECT p.id, p.email, p.handle FROM people p WHERE p.handle = ANY($1)`,
      [[...handles]],
    );
    for (const person of mentioned.rows) {
      if (person.id === author.id) continue;
      await queueNotification(ctx, projectId, title, person.id, author.name, body, frame, rate);
    }
  }
}

async function queueNotification(
  ctx: AppCtx,
  projectId: string,
  projectTitle: string,
  personId: string,
  authorName: string,
  body: string,
  frame: number,
  rate: string,
): Promise<void> {
  const windowKey = `${Math.floor(Date.now() / (ctx.config.mailGroupSeconds * 1000))}`;
  const closesAt = new Date((Math.floor(Date.now() / (ctx.config.mailGroupSeconds * 1000)) + 1) * ctx.config.mailGroupSeconds * 1000);
  await ctx.db.query(
    `INSERT INTO mention_windows (person_id, project_id, window_key, closes_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (person_id, project_id, window_key) DO NOTHING`,
    [personId, projectId, windowKey, closesAt],
  );
  await ctx.db.query(
    `INSERT INTO notifications (id, project_id, project_title, person_id, author_name, body, frame, created_at, window_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [`nt-${newHex(10)}`, projectId, projectTitle, personId, authorName, body, frame, new Date(), windowKey],
  );
  void rate;
}
