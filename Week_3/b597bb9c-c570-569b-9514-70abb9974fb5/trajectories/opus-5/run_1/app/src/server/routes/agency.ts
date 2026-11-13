/**
 * The agency read API under /api/v1: GET only, read tokens only, opaque cursors,
 * and exactly the published fields.
 */
import { invalid } from '../../domain/validate.js';
import { query } from '../db.js';
import { notFound, sendJson, type RequestContext, type Route } from '../http.js';

interface Page {
  limit: number;
  cursor: [string, string] | null;
}

function readPage(context: RequestContext): Page {
  const limitText = context.url.searchParams.get('limit');
  const limit = limitText === null ? 25 : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('limit');
  const cursorText = context.url.searchParams.get('cursor');
  if (cursorText === null) return { limit, cursor: null };
  try {
    const parsed = JSON.parse(Buffer.from(cursorText, 'base64url').toString('utf8')) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error('bad cursor');
    return { limit, cursor: [String(parsed[0]), String(parsed[1])] };
  } catch {
    throw invalid('cursor');
  }
}

function encodeCursor(first: string | number, second: string): string {
  return Buffer.from(JSON.stringify([String(first), second]), 'utf8').toString('base64url');
}

interface Entry<T> {
  item: T;
  cursor: string;
}

function answerPage<T>(context: RequestContext, entries: Entry<T>[], page: Page): void {
  const window = entries.slice(0, page.limit);
  const nextCursor = entries.length > page.limit && window.length > 0 ? window[window.length - 1].cursor : null;
  sendJson(context.response, 200, { items: window.map((entry) => entry.item), next_cursor: nextCursor });
}

async function projectExists(projectId: string): Promise<{ id: string } | null> {
  const rows = await query<{ id: string }>(`select id from projects where id = $1`, [projectId]);
  return rows.length > 0 ? rows[0] : null;
}

export const agencyRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/v1/projects',
    auth: 'token',
    handle: async (context) => {
      const page = readPage(context);
      const rows = await query<{
        id: string;
        title: string;
        agency: string;
        frame_rate: string;
        aspect_ratio: string;
        total_frames: number;
        updated_at: Date;
        seed_order: number;
      }>(
        `select p.id, p.title, p.agency, p.frame_rate, p.aspect_ratio, p.updated_at, p.seed_order,
                greatest(coalesce((select max(c.end_frame) from clips c where c.project_id = p.id), 0),
                         coalesce((select max(t.end_frame) from captions t where t.project_id = p.id), 0)) as total_frames
         from projects p order by p.seed_order, p.id`,
      );
      const after = page.cursor;
      const filtered = rows.filter(
        (row) =>
          after === null ||
          Number(row.seed_order) > Number(after[0]) ||
          (Number(row.seed_order) === Number(after[0]) && row.id > after[1]),
      );
      answerPage(
        context,
        filtered.map((row) => ({
          item: {
            id: row.id,
            title: row.title,
            agency: row.agency,
            frame_rate: row.frame_rate,
            aspect_ratio: row.aspect_ratio,
            total_frames: Number(row.total_frames),
            updated_at: row.updated_at.toISOString(),
          },
          cursor: encodeCursor(row.seed_order, row.id),
        })),
        page,
      );
    },
  },
  {
    method: 'GET',
    path: '/api/v1/projects/{id}',
    auth: 'token',
    handle: async (context) => {
      const rows = await query<{
        id: string;
        title: string;
        agency: string;
        frame_rate: string;
        aspect_ratio: string;
        total_frames: number;
        updated_at: Date;
      }>(
        `select p.id, p.title, p.agency, p.frame_rate, p.aspect_ratio, p.updated_at,
                greatest(coalesce((select max(c.end_frame) from clips c where c.project_id = p.id), 0),
                         coalesce((select max(t.end_frame) from captions t where t.project_id = p.id), 0)) as total_frames
         from projects p where p.id = $1`,
        [context.params.id],
      );
      if (rows.length === 0) throw notFound();
      const row = rows[0];
      sendJson(context.response, 200, {
        id: row.id,
        title: row.title,
        agency: row.agency,
        frame_rate: row.frame_rate,
        aspect_ratio: row.aspect_ratio,
        total_frames: Number(row.total_frames),
        updated_at: row.updated_at.toISOString(),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/v1/projects/{id}/clips',
    auth: 'token',
    handle: async (context) => {
      if ((await projectExists(context.params.id)) === null) throw notFound();
      const page = readPage(context);
      const rows = await query<{
        id: string;
        row_id: string;
        name: string;
        kind: string;
        start_frame: number;
        end_frame: number;
        hidden: boolean;
        added_seq: number;
      }>(
        `select id, row_id, name, kind, start_frame, end_frame, hidden, added_seq from clips
         where project_id = $1 order by added_seq, id`,
        [context.params.id],
      );
      const after = page.cursor;
      const filtered = rows.filter(
        (row) =>
          after === null ||
          Number(row.added_seq) > Number(after[0]) ||
          (Number(row.added_seq) === Number(after[0]) && row.id > after[1]),
      );
      answerPage(
        context,
        filtered.map((row) => ({
          item: {
            id: row.id,
            row_id: row.row_id,
            name: row.name,
            kind: row.kind,
            start_frame: row.start_frame,
            end_frame: row.end_frame,
            hidden: row.hidden,
          },
          cursor: encodeCursor(row.added_seq, row.id),
        })),
        page,
      );
    },
  },
  {
    method: 'GET',
    path: '/api/v1/projects/{id}/cuts',
    auth: 'token',
    handle: async (context) => {
      if ((await projectExists(context.params.id)) === null) throw notFound();
      const page = readPage(context);
      const rows = await query<{ id: string; name: string; total_frames: number; created_at: Date }>(
        `select id, name, total_frames, created_at from cuts where project_id = $1 and shared = true
         order by created_at, id`,
        [context.params.id],
      );
      const after = page.cursor;
      const filtered = rows.filter(
        (row) =>
          after === null ||
          row.created_at.toISOString() > after[0] ||
          (row.created_at.toISOString() === after[0] && row.id > after[1]),
      );
      answerPage(
        context,
        filtered.map((row) => ({
          item: {
            id: row.id,
            name: row.name,
            total_frames: row.total_frames,
            created_at: row.created_at.toISOString(),
          },
          cursor: encodeCursor(row.created_at.toISOString(), row.id),
        })),
        page,
      );
    },
  },
  {
    method: 'GET',
    path: '/api/v1/projects/{id}/exports',
    auth: 'token',
    handle: async (context) => {
      if ((await projectExists(context.params.id)) === null) throw notFound();
      const page = readPage(context);
      const rows = await query<{
        id: string;
        cut_id: string;
        size: number;
        state: string;
        minutes: number;
        finished_at: Date | null;
        created_at: Date;
      }>(
        `select id, cut_id, size, state, minutes, finished_at, created_at from exports where project_id = $1
         order by created_at, id`,
        [context.params.id],
      );
      const after = page.cursor;
      const filtered = rows.filter(
        (row) =>
          after === null ||
          row.created_at.toISOString() > after[0] ||
          (row.created_at.toISOString() === after[0] && row.id > after[1]),
      );
      answerPage(
        context,
        filtered.map((row) => ({
          item: {
            id: row.id,
            cut_id: row.cut_id,
            size: row.size,
            state: row.state,
            minutes: row.minutes,
            finished_at: row.finished_at === null ? null : row.finished_at.toISOString(),
          },
          cursor: encodeCursor(row.created_at.toISOString(), row.id),
        })),
        page,
      );
    },
  },
  {
    method: 'GET',
    path: '/api/v1/projects/{id}/comments',
    auth: 'token',
    handle: async (context) => {
      if ((await projectExists(context.params.id)) === null) throw notFound();
      const page = readPage(context);
      const rows = await query<{
        id: string;
        cut_id: string | null;
        pin_frame: number;
        body: string;
        author_name: string;
        created_at: Date;
      }>(
        `select id, cut_id, pin_frame, body, author_name, created_at from comments
         where project_id = $1 and visibility = 'review' order by created_at, id`,
        [context.params.id],
      );
      const after = page.cursor;
      const filtered = rows.filter(
        (row) =>
          after === null ||
          row.created_at.toISOString() > after[0] ||
          (row.created_at.toISOString() === after[0] && row.id > after[1]),
      );
      answerPage(
        context,
        filtered.map((row) => ({
          item: {
            id: row.id,
            cut_id: row.cut_id,
            frame: row.pin_frame,
            body: row.body,
            author_name: row.author_name,
            created_at: row.created_at.toISOString(),
          },
          cursor: encodeCursor(row.created_at.toISOString(), row.id),
        })),
        page,
      );
    },
  },
];
