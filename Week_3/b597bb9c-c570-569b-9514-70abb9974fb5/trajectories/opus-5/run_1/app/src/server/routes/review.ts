/** The client's review surface: read, comment and approve, and nothing else. */
import { ApiError } from '../../domain/api-error.js';
import { codePoints, invalid, isBlank, NOTE_BODY_LIMIT } from '../../domain/validate.js';
import { pool, query } from '../db.js';
import { jsonBody, sendJson, type Route } from '../http.js';
import { broadcastComment } from '../live.js';
import { randomId, strongEtag } from '../ids.js';
import { loadCuts, publicCaption, publicClip } from '../repo/projects.js';
import { FRAME_SIZES, type AspectRatio } from '../../shared/types.js';
import type { TimelineSnapshot } from '../../domain/timeline-state.js';
import type { FrameRateName } from '../../domain/rate.js';

interface LinkRow {
  id: string;
  project_id: string;
  cut_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  title: string;
  frame_rate: FrameRateName;
  aspect_ratio: AspectRatio;
  owner_name: string;
}

async function linkByToken(token: string): Promise<LinkRow | null> {
  const rows = await query<LinkRow>(
    `select l.id, l.project_id, l.cut_id, l.expires_at, l.revoked_at, p.title, p.frame_rate, p.aspect_ratio,
            (select name from people where is_owner = true limit 1) as owner_name
     from review_links l join projects p on p.id = l.project_id where l.token = $1`,
    [token],
  );
  return rows.length > 0 ? rows[0] : null;
}

/** Expiry is decided by the server clock at every request. */
async function openLink(token: string): Promise<LinkRow> {
  const link = await linkByToken(token);
  if (link === null) throw ApiError.of('not_found', undefined);
  if (link.revoked_at !== null) throw ApiError.of('link_revoked', { owner_name: link.owner_name });
  if (link.expires_at.getTime() <= Date.now()) throw ApiError.of('link_expired', { owner_name: link.owner_name });
  return link;
}

async function reviewBody(link: LinkRow): Promise<Record<string, unknown>> {
  const cuts = await query<{ id: string; name: string; total_frames: number; snapshot: TimelineSnapshot }>(
    `select id, name, total_frames, snapshot from cuts where id = $1`,
    [link.cut_id],
  );
  const cut = cuts[0];
  const comments = await query<{
    id: string;
    author_name: string;
    body: string;
    visibility: 'team' | 'review';
    parent_id: string | null;
    cut_id: string | null;
    pin_frame: number;
    pin_row_id: string | null;
    pin_clip_id: string | null;
    mentions: string[];
    created_at: Date;
  }>(
    `select id, author_name, body, visibility, parent_id, cut_id, pin_frame, pin_row_id, pin_clip_id, mentions, created_at
     from comments where project_id = $1 and cut_id = $2 and visibility = 'review' order by created_at, id`,
    [link.project_id, link.cut_id],
  );
  const approvals = await query<{ name: string; at: Date }>(
    `select name, at from cut_approvals where cut_id = $1 order by at`,
    [link.cut_id],
  );
  const size = FRAME_SIZES[link.aspect_ratio];
  return {
    project: {
      title: link.title,
      frame_rate: link.frame_rate,
      aspect_ratio: link.aspect_ratio,
      width: size.width,
      height: size.height,
    },
    owner_name: link.owner_name,
    cut: {
      id: cut.id,
      name: cut.name,
      total_frames: cut.total_frames,
      rows: cut.snapshot.rows,
      clips: cut.snapshot.clips.map(publicClip),
      captions: cut.snapshot.captions.map(publicCaption),
    },
    comments: comments.map((comment) => ({
      id: comment.id,
      author_name: comment.author_name,
      body: comment.body,
      visibility: comment.visibility,
      parent_id: comment.parent_id,
      cut_id: comment.cut_id,
      pin: {
        frame: comment.pin_frame,
        row_id: comment.pin_row_id,
        clip_id: comment.pin_clip_id,
        live_frame: comment.pin_frame,
      },
      mentions: comment.mentions,
      created_at: comment.created_at.toISOString(),
    })),
    approvals: approvals.map((approval) => ({ name: approval.name, at: approval.at.toISOString() })),
  };
}

function reviewerName(body: Record<string, unknown>): string {
  const name = typeof body.name === 'string' ? body.name : '';
  if (codePoints(name) < 1 || codePoints(name) > 60 || isBlank(name)) {
    throw ApiError.validation({ name: 'Add your name in 1 to 60 characters.' });
  }
  return name;
}

export const reviewRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/review/{token}',
    auth: 'public',
    handle: async (context) => {
      const link = await openLink(context.params.token);
      const payload = await reviewBody(link);
      const text = JSON.stringify(payload);
      const etag = strongEtag(text);
      if (context.request.headers['if-none-match'] === etag) {
        context.response.writeHead(304, { etag, 'cache-control': 'private, no-cache' });
        context.response.end();
        return;
      }
      context.response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        etag,
        'cache-control': 'private, no-cache',
      });
      context.response.end(text);
    },
  },
  {
    method: 'POST',
    path: '/api/review/{token}/comments',
    auth: 'public',
    body: 'json',
    handle: async (context) => {
      const link = await openLink(context.params.token);
      const body = jsonBody(context);
      const name = reviewerName(body);
      const text = typeof body.body === 'string' ? body.body : '';
      if (codePoints(text) < 1 || codePoints(text) > NOTE_BODY_LIMIT || isBlank(text)) throw invalid('body');
      const frame = body.frame;
      if (typeof frame !== 'number' || !Number.isInteger(frame) || frame < 0) throw invalid('frame');
      const id = randomId('note');
      const rows = await query<{ created_at: Date }>(
        `insert into comments (id, project_id, author_person_id, author_name, body, visibility, cut_id, pin_frame, mentions)
         values ($1,$2,null,$3,$4,'review',$5,$6,'[]'::jsonb) returning created_at`,
        [id, link.project_id, name, text, link.cut_id, frame],
      );
      const record = {
        id,
        author_name: name,
        body: text,
        visibility: 'review' as const,
        parent_id: null,
        cut_id: link.cut_id,
        pin: { frame, row_id: null, clip_id: null, live_frame: frame },
        mentions: [],
        created_at: rows[0].created_at.toISOString(),
      };
      broadcastComment(link.project_id, record);
      sendJson(context.response, 201, record);
    },
  },
  {
    method: 'POST',
    path: '/api/review/{token}/approve',
    auth: 'public',
    body: 'json',
    handle: async (context) => {
      const link = await openLink(context.params.token);
      const name = reviewerName(jsonBody(context));
      await query(`insert into cut_approvals (cut_id, name) values ($1,$2) on conflict do nothing`, [link.cut_id, name]);
      const cuts = await loadCuts(pool, link.project_id);
      const cut = cuts.find((candidate) => candidate.id === link.cut_id);
      sendJson(context.response, 200, { cut_id: link.cut_id, approvals: cut?.approvals ?? [] });
    },
  },
];
