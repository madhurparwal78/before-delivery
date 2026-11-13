import { ApiError } from '../../domain/api-error.js';
import { codePoints, invalid, readString } from '../../domain/validate.js';
import { config } from '../config.js';
import { pool, query } from '../db.js';
import { jsonBody, notFound, requireOwner, sendEmpty, sendJson, type Route } from '../http.js';
import { broadcastCutShared, broadcastOp, closeReviewLink } from '../live.js';
import { randomId, randomToken } from '../ids.js';
import { loadMediaInfo } from '../repo/media.js';
import { performOp } from '../repo/ops.js';
import { loadCuts, loadProject, projectTotalFrames, publicCaption, publicClip } from '../repo/projects.js';
import { ANY_ROLE, APPROVERS, loadedProjectAccess, OWNER_ONLY, projectAccess } from './guards.js';
import type { TimelineSnapshot } from '../../domain/timeline-state.js';

interface CutRow {
  id: string;
  project_id: string;
  name: string;
  version: number;
  total_frames: number;
  shared: boolean;
  snapshot: TimelineSnapshot;
  created_at: Date;
}

async function cutById(projectId: string, cutId: string): Promise<CutRow | null> {
  const rows = await query<CutRow>(
    `select id, project_id, name, version, total_frames, shared, snapshot, created_at from cuts
     where project_id = $1 and id = $2`,
    [projectId, cutId],
  );
  return rows.length > 0 ? rows[0] : null;
}

function linkState(row: { revoked_at: Date | null; expires_at: Date }): 'active' | 'expired' | 'revoked' {
  if (row.revoked_at !== null) return 'revoked';
  return row.expires_at.getTime() <= Date.now() ? 'expired' : 'active';
}

async function markShared(cutId: string, projectId: string): Promise<void> {
  await query(`update cuts set shared = true where id = $1`, [cutId]);
  const cuts = await loadCuts(pool, projectId);
  const cut = cuts.find((candidate) => candidate.id === cutId);
  if (cut !== undefined) broadcastCutShared(projectId, cut, null);
}

export const cutRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/projects/{id}/cuts',
    auth: 'session',
    handle: async (context) => {
      const access = await projectAccess(context, ANY_ROLE);
      sendJson(context.response, 200, { items: await loadCuts(pool, access.projectId) });
    },
  },
  {
    method: 'POST',
    path: '/api/projects/{id}/cuts',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const access = await loadedProjectAccess(context, OWNER_ONLY);
      const body = jsonBody(context);
      const name = typeof body.name === 'string' ? body.name : '';
      if (codePoints(name) < 1 || codePoints(name) > 60) {
        throw ApiError.validation({ name: 'Name the cut in 1 to 60 characters.' });
      }
      const existing = await query<{ id: string }>(`select id from cuts where project_id = $1 and name = $2`, [
        access.projectId,
        name,
      ]);
      if (existing.length > 0) throw ApiError.of('cut_name_taken', { cut_name: name });
      const snapshot: TimelineSnapshot = {
        rows: access.loaded.state.rows,
        clips: access.loaded.state.clips,
        captions: access.loaded.state.captions,
      };
      const id = randomId('cut');
      await query(
        `insert into cuts (id, project_id, name, version, total_frames, shared, snapshot) values ($1,$2,$3,$4,$5,false,$6)`,
        [id, access.projectId, name, access.loaded.row.version, projectTotalFrames(access.loaded.state), JSON.stringify(snapshot)],
      );
      const cuts = await loadCuts(pool, access.projectId);
      sendJson(context.response, 201, cuts.find((cut) => cut.id === id));
    },
  },
  {
    method: 'GET',
    path: '/api/projects/{id}/cuts/{cut_id}',
    auth: 'session',
    handle: async (context) => {
      const access = await projectAccess(context, ANY_ROLE);
      const cut = await cutById(access.projectId, context.params.cut_id);
      if (cut === null) throw notFound();
      const cuts = await loadCuts(pool, access.projectId);
      sendJson(context.response, 200, {
        cut: cuts.find((candidate) => candidate.id === cut.id),
        rows: cut.snapshot.rows,
        clips: cut.snapshot.clips.map(publicClip),
        captions: cut.snapshot.captions.map(publicCaption),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/projects/{id}/cuts/{a}/compare/{b}',
    auth: 'session',
    handle: async (context) => {
      const access = await projectAccess(context, ANY_ROLE);
      const from = await cutById(access.projectId, context.params.a);
      const to = await cutById(access.projectId, context.params.b);
      if (from === null || to === null) throw notFound();
      const added = to.snapshot.clips
        .filter((clip) => !from.snapshot.clips.some((candidate) => candidate.id === clip.id))
        .map((clip) => clip.id);
      const removed = from.snapshot.clips
        .filter((clip) => !to.snapshot.clips.some((candidate) => candidate.id === clip.id))
        .map((clip) => clip.id);
      const changed = [];
      for (const clip of to.snapshot.clips) {
        const before = from.snapshot.clips.find((candidate) => candidate.id === clip.id);
        if (before === undefined) continue;
        if (
          before.row_id === clip.row_id &&
          before.start_frame === clip.start_frame &&
          before.end_frame === clip.end_frame
        ) {
          continue;
        }
        changed.push({
          clip_id: clip.id,
          from: { row_id: before.row_id, start_frame: before.start_frame, end_frame: before.end_frame },
          to: { row_id: clip.row_id, start_frame: clip.start_frame, end_frame: clip.end_frame },
        });
      }
      sendJson(context.response, 200, {
        added,
        removed,
        changed,
        frame_delta: to.total_frames - from.total_frames,
      });
    },
  },
  {
    method: 'POST',
    path: '/api/projects/{id}/cuts/{cut_id}/approval',
    auth: 'session',
    handle: async (context) => {
      const access = await projectAccess(context, APPROVERS);
      const cut = await cutById(access.projectId, context.params.cut_id);
      if (cut === null) throw notFound();
      await query(`insert into cut_approvals (cut_id, name) values ($1,$2) on conflict do nothing`, [
        cut.id,
        access.signed.person.name,
      ]);
      const cuts = await loadCuts(pool, access.projectId);
      const record = cuts.find((candidate) => candidate.id === cut.id);
      sendJson(context.response, 200, { cut_id: cut.id, approvals: record?.approvals ?? [] });
    },
  },
  {
    method: 'POST',
    path: '/api/projects/{id}/cuts/{cut_id}/restore',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const access = await projectAccess(context, OWNER_ONLY);
      const body = jsonBody(context);
      const opId = readString(body, 'op_id', { min: 1, max: 64 });
      const baseVersion = typeof body.base_version === 'number' ? body.base_version : 0;
      const cut = await cutById(access.projectId, context.params.cut_id);
      if (cut === null) throw notFound();
      const outcome = await performOp({
        projectId: access.projectId,
        author: { id: access.signed.person.id, name: access.signed.person.name },
        role: access.role,
        opId,
        baseVersion,
        type: 'restore_cut',
        body: { snapshot: cut.snapshot, cut_id: cut.id, cut_name: cut.name },
      });
      broadcastOp(access.projectId, {
        version: outcome.result.version,
        author: outcome.author,
        op: { type: 'restore_cut', cut_id: cut.id, cut_name: cut.name },
        changes: outcome.result.changes,
        removed: outcome.result.removed,
      });
      sendJson(context.response, outcome.status, outcome.result);
    },
  },
  {
    method: 'POST',
    path: '/api/projects/{id}/review-links',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const access = await projectAccess(context, OWNER_ONLY);
      const body = jsonBody(context);
      const cutId = typeof body.cut_id === 'string' ? body.cut_id : '';
      const seconds = body.expires_in_seconds;
      if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 10 || seconds > 2592000) {
        throw invalid('expires_in_seconds');
      }
      const cut = await cutById(access.projectId, cutId);
      if (cut === null) throw invalid('cut_id');
      const id = randomId('link');
      const token = randomToken('rv-', 24);
      const rows = await query<{ expires_at: Date }>(
        `insert into review_links (id, project_id, token, cut_id, expires_at)
         values ($1,$2,$3,$4, now() + ($5 || ' seconds')::interval) returning expires_at`,
        [id, access.projectId, token, cutId, String(seconds)],
      );
      await markShared(cutId, access.projectId);
      sendJson(context.response, 201, {
        id,
        token,
        url: `${config.publicUrl}/review/${token}`,
        cut_id: cutId,
        expires_at: rows[0].expires_at.toISOString(),
        state: 'active',
      });
    },
  },
  {
    method: 'GET',
    path: '/api/projects/{id}/review-links',
    auth: 'session',
    handle: async (context) => {
      const access = await projectAccess(context, OWNER_ONLY);
      const rows = await query<{ id: string; token: string; cut_id: string; expires_at: Date; revoked_at: Date | null }>(
        `select id, token, cut_id, expires_at, revoked_at from review_links where project_id = $1 order by created_at`,
        [access.projectId],
      );
      sendJson(context.response, 200, {
        items: rows.map((row) => ({
          id: row.id,
          cut_id: row.cut_id,
          url: row.revoked_at === null ? `${config.publicUrl}/review/${row.token}` : null,
          expires_at: row.expires_at.toISOString(),
          state: linkState(row),
        })),
      });
    },
  },
  {
    method: 'PUT',
    path: '/api/review-links/{id}',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      requireOwner(context);
      const body = jsonBody(context);
      const rows = await query<{ id: string; project_id: string; token: string; expires_at: Date; revoked_at: Date | null }>(
        `select id, project_id, token, expires_at, revoked_at from review_links where id = $1`,
        [context.params.id],
      );
      if (rows.length === 0) throw notFound();
      const link = rows[0];
      const cutId = typeof body.cut_id === 'string' ? body.cut_id : '';
      const cut = await cutById(link.project_id, cutId);
      if (cut === null) throw invalid('cut_id');
      await query(`update review_links set cut_id = $2 where id = $1`, [link.id, cutId]);
      await query(`update cuts set shared = true where id = $1`, [cutId]);
      const cuts = await loadCuts(pool, link.project_id);
      const record = cuts.find((candidate) => candidate.id === cutId);
      if (record !== undefined) broadcastCutShared(link.project_id, record, link.id);
      sendJson(context.response, 200, {
        id: link.id,
        cut_id: cutId,
        url: `${config.publicUrl}/review/${link.token}`,
        expires_at: link.expires_at.toISOString(),
        state: linkState(link),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/review-links/{id}/regenerate',
    auth: 'session',
    handle: async (context) => {
      requireOwner(context);
      const rows = await query<{ id: string; project_id: string; cut_id: string; expires_at: Date }>(
        `select id, project_id, cut_id, expires_at from review_links where id = $1`,
        [context.params.id],
      );
      if (rows.length === 0) throw notFound();
      const old = rows[0];
      await query(`update review_links set revoked_at = now() where id = $1`, [old.id]);
      closeReviewLink(old.id);
      const id = randomId('link');
      const token = randomToken('rv-', 24);
      await query(`insert into review_links (id, project_id, token, cut_id, expires_at) values ($1,$2,$3,$4,$5)`, [
        id,
        old.project_id,
        token,
        old.cut_id,
        old.expires_at,
      ]);
      sendJson(context.response, 201, {
        id,
        token,
        url: `${config.publicUrl}/review/${token}`,
        cut_id: old.cut_id,
        expires_at: old.expires_at.toISOString(),
        state: 'active',
      });
    },
  },
  {
    method: 'DELETE',
    path: '/api/review-links/{id}',
    auth: 'session',
    handle: async (context) => {
      requireOwner(context);
      const rows = await query<{ id: string }>(`select id from review_links where id = $1`, [context.params.id]);
      if (rows.length === 0) throw notFound();
      await query(`update review_links set revoked_at = now() where id = $1`, [rows[0].id]);
      closeReviewLink(rows[0].id);
      sendEmpty(context.response, 204);
    },
  },
];


export { loadMediaInfo, loadProject };
