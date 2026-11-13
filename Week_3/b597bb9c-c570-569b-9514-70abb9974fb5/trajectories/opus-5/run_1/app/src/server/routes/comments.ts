import { ApiError } from '../../domain/api-error.js';
import { exactRate } from '../../domain/rate.js';
import { codePoints, invalid, isBlank, MENTION_LIMIT, NOTE_BODY_LIMIT, parseMentions } from '../../domain/validate.js';
import { config } from '../config.js';
import { pool, query } from '../db.js';
import { jsonBody, sendJson, type Route } from '../http.js';
import { broadcastComment } from '../live.js';
import { randomId } from '../ids.js';
import { peopleOnProject } from '../repo/people.js';
import { commentRecord, loadSnapshots } from '../repo/projects.js';
import { ANY_ROLE, loadedProjectAccess, projectAccess } from './guards.js';
import type { CommentRecord, Visibility } from '../../shared/types.js';

interface CommentRow {
  id: string;
  author_person_id: string | null;
  author_name: string;
  body: string;
  visibility: Visibility;
  parent_id: string | null;
  cut_id: string | null;
  pin_frame: number;
  pin_row_id: string | null;
  pin_clip_id: string | null;
  mentions: string[];
  pin_seconds: number | null;
  created_at: Date;
}

const COMMENT_COLUMNS = `id, author_person_id, author_name, body, visibility, parent_id, cut_id, pin_frame,
  pin_row_id, pin_clip_id, mentions, pin_seconds, created_at`;

/** The first notification opens a window; every later one in that window joins it. */
async function queueNotice(personId: string, projectId: string, authorName: string, frame: number, body: string): Promise<void> {
  const open = await query<{ window_ends_at: Date }>(
    `select window_ends_at from mention_notices
     where person_id = $1 and project_id = $2 and sent = false and window_ends_at > now()
     order by window_ends_at limit 1`,
    [personId, projectId],
  );
  const windowEnd =
    open.length > 0 ? open[0].window_ends_at : new Date(Date.now() + config.mailGroupSeconds * 1000);
  await query(
    `insert into mention_notices (person_id, project_id, author_name, frame, body, window_ends_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [personId, projectId, authorName, frame, body, windowEnd],
  );
}

export const commentRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/projects/{id}/comments',
    auth: 'session',
    handle: async (context) => {
      const access = await loadedProjectAccess(context, ANY_ROLE);
      const cutId = context.url.searchParams.get('cut_id');
      const rows = await query<CommentRow>(
        `select ${COMMENT_COLUMNS} from comments where project_id = $1 and ($2::text is null or cut_id = $2)
         order by created_at, id`,
        [access.projectId, cutId],
      );
      const snapshots = await loadSnapshots(pool, access.projectId);
      const rate = exactRate(access.loaded.row.frame_rate);
      sendJson(context.response, 200, {
        items: rows.map((row) => commentRecord(row, access.loaded.state.clips, snapshots, rate)),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/projects/{id}/comments',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const access = await loadedProjectAccess(context, ANY_ROLE);
      const body = jsonBody(context);
      const text = typeof body.body === 'string' ? body.body : '';
      if (codePoints(text) < 1 || codePoints(text) > NOTE_BODY_LIMIT || isBlank(text)) throw invalid('body');
      const visibility = body.visibility === 'review' ? 'review' : body.visibility === 'team' ? 'team' : null;
      if (visibility === null) throw invalid('visibility');
      const frame = body.frame;
      if (typeof frame !== 'number' || !Number.isInteger(frame) || frame < 0) throw invalid('frame');
      const rowId = typeof body.row_id === 'string' ? body.row_id : null;
      const clipId = typeof body.clip_id === 'string' ? body.clip_id : null;
      const cutId = typeof body.cut_id === 'string' ? body.cut_id : null;
      const parentId = typeof body.parent_id === 'string' ? body.parent_id : null;
      if (rowId !== null && !access.loaded.state.rows.some((row) => row.id === rowId)) throw invalid('row_id');
      if (clipId !== null && !access.loaded.state.clips.some((clip) => clip.id === clipId)) throw invalid('clip_id');

      const mentions = parseMentions(text);
      if (mentions.length > MENTION_LIMIT) throw ApiError.validation({ mentions: 'A note can mention at most 5 people.' });
      const members = await peopleOnProject(access.projectId);
      const handles = new Set(members.map((member) => member.person.handle.toLowerCase()));
      for (const mention of mentions) {
        if (!handles.has(mention)) throw ApiError.validation({ mention: `No one on this project is called @${mention}.` });
      }

      const id = randomId('note');
      await query(
        `insert into comments (id, project_id, author_person_id, author_name, body, visibility, parent_id, cut_id,
           pin_frame, pin_row_id, pin_clip_id, mentions)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          access.projectId,
          access.signed.person.id,
          access.signed.person.name,
          text,
          visibility,
          parentId,
          cutId,
          frame,
          rowId,
          clipId,
          JSON.stringify(mentions),
        ],
      );
      await query(`delete from comment_drafts where project_id = $1 and person_id = $2`, [
        access.projectId,
        access.signed.person.id,
      ]);
      const rate = exactRate(access.loaded.row.frame_rate);
      const snapshots = await loadSnapshots(pool, access.projectId);
      const rows = await query<CommentRow>(`select ${COMMENT_COLUMNS} from comments where id = $1`, [id]);
      const record: CommentRecord = commentRecord(rows[0], access.loaded.state.clips, snapshots, rate);

      for (const mention of mentions) {
        const member = members.find((candidate) => candidate.person.handle.toLowerCase() === mention);
        if (member === undefined || member.person.id === access.signed.person.id) continue;
        await queueNotice(member.person.id, access.projectId, access.signed.person.name, record.pin.frame, text);
      }
      if (parentId !== null) {
        const parent = await query<{ author_person_id: string | null }>(
          `select author_person_id from comments where id = $1`,
          [parentId],
        );
        const parentAuthor = parent[0]?.author_person_id ?? null;
        if (parentAuthor !== null && parentAuthor !== access.signed.person.id && !mentions.some((mention) =>
          members.some((member) => member.person.id === parentAuthor && member.person.handle.toLowerCase() === mention))) {
          await queueNotice(parentAuthor, access.projectId, access.signed.person.name, record.pin.frame, text);
        }
      }
      broadcastComment(access.projectId, record);
      sendJson(context.response, 201, record);
    },
  },
  {
    method: 'GET',
    path: '/api/projects/{id}/comment-draft',
    auth: 'session',
    handle: async (context) => {
      const access = await projectAccess(context, ANY_ROLE);
      const rows = await query<{ draft: Record<string, unknown>; updated_at: Date }>(
        `select draft, updated_at from comment_drafts where project_id = $1 and person_id = $2`,
        [access.projectId, access.signed.person.id],
      );
      if (rows.length === 0) {
        sendJson(context.response, 200, { draft: null });
        return;
      }
      sendJson(context.response, 200, { draft: { ...rows[0].draft, updated_at: rows[0].updated_at.toISOString() } });
    },
  },
  {
    method: 'PUT',
    path: '/api/projects/{id}/comment-draft',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      const access = await projectAccess(context, ANY_ROLE);
      const body = jsonBody(context);
      const text = typeof body.body === 'string' ? body.body : '';
      if (codePoints(text) > NOTE_BODY_LIMIT) throw invalid('body');
      const draft = {
        body: text,
        frame: typeof body.frame === 'number' ? body.frame : 0,
        row_id: typeof body.row_id === 'string' ? body.row_id : null,
        clip_id: typeof body.clip_id === 'string' ? body.clip_id : null,
        cut_id: typeof body.cut_id === 'string' ? body.cut_id : null,
        visibility: body.visibility === 'review' ? 'review' : 'team',
        parent_id: typeof body.parent_id === 'string' ? body.parent_id : null,
      };
      const rows = await query<{ updated_at: Date }>(
        `insert into comment_drafts (project_id, person_id, draft, updated_at) values ($1,$2,$3, now())
         on conflict (project_id, person_id) do update set draft = excluded.draft, updated_at = now()
         returning updated_at`,
        [access.projectId, access.signed.person.id, JSON.stringify(draft)],
      );
      sendJson(context.response, 200, { draft: { ...draft, updated_at: rows[0].updated_at.toISOString() } });
    },
  },
];
