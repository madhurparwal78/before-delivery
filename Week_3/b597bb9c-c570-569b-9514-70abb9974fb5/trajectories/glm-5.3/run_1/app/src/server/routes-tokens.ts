import { Router, type Request, type Response, type RequestHandler } from 'express';
import type { AppCtx } from './ctx';
import { ApiError } from './api-errors';
import { requireAuth } from './sessions';
import { respond } from './routes-session';
import { newHex, codePoints, rateWindow } from './util';

/** Read tokens and the agency read API under /api/v1. */
export function tokenRoutes(ctx: AppCtx): Router {
  const r = Router();

  r.post('/tokens', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('forbidden');
      const body = req.body as Record<string, unknown>;
      const name = String(body.name ?? '').trim();
      if (codePoints(name) < 1 || codePoints(name) > 60) {
        throw ApiError.validation({ name: { key: 'other' } });
      }
      const id = `tk-${newHex(6)}`;
      const token = `gct_${newHex(20)}`;
      await ctx.db.query(
        'INSERT INTO read_tokens (id, workspace_id, name, token) VALUES ($1,$2,$3,$4)',
        [id, ctx.workspaceId, name, token],
      );
      res.status(201).json({ id, name, token, created_at: new Date().toISOString() });
    })().catch((err) => respond(res, err));
  });

  r.get('/tokens', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('not_found');
      const rows = await ctx.db.query(
        'SELECT id, name, created_at, last_used_at FROM read_tokens WHERE workspace_id = $1 ORDER BY created_at',
        [ctx.workspaceId],
      );
      res.json({
        items: rows.rows.map((row: Record<string, unknown>) => ({
          id: row.id,
          name: row.name,
          created_at: new Date(row.created_at as string).toISOString(),
          last_used_at: row.last_used_at === null ? null : new Date(row.last_used_at as string).toISOString(),
        })),
      });
    })().catch((err) => respond(res, err));
  });

  r.delete('/tokens/:id', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('forbidden');
      await ctx.db.query('DELETE FROM read_tokens WHERE id = $1', [req.params.id!]);
      res.status(204).end();
    })().catch((err) => respond(res, err));
  });

  return r;
}

export interface ReadAuth {
  tokenId: string;
}

/** The /api/v1 read API: bearer tokens only, GET only, stable cursors. */
export function v1Routes(ctx: AppCtx): Router {
  const r = Router();

  const auth: RequestHandler = (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer (gct_[0-9a-f]+)$/.exec(header);
    if (match === null) {
      respond(res, new ApiError('unauthenticated'));
      return;
    }
    void (async () => {
      const row = await ctx.db.query<{ id: string }>('SELECT id FROM read_tokens WHERE token = $1', [match[1]!]);
      if ((row.rowCount ?? 0) === 0) {
        respond(res, new ApiError('unauthenticated'));
        return;
      }
      const window = rateWindow();
      const count = await ctx.counters.countTokenRequest(row.rows[0]!.id, window);
      await ctx.db.query('UPDATE read_tokens SET last_used_at = now() WHERE id = $1', [row.rows[0]!.id]);
      if (count > 30) {
        const secondsLeft = Math.max(1, (window + 1) * 10 - Math.floor(Date.now() / 1000));
        res.set('Retry-After', String(secondsLeft));
        respond(res, new ApiError('rate_limited', { n: secondsLeft }));
        return;
      }
      (req as Request & { readToken: string }).readToken = row.rows[0]!.id;
      next();
    })().catch(() => respond(res, new ApiError('unauthenticated')));
  };

  r.use(auth);

  const wrongVerb: RequestHandler = (req, res) => {
    res.set('Allow', 'GET');
    respond(res, new ApiError('method_not_allowed'));
  };

  r.get('/projects', paged(listProjects));
  r.get('/projects/:id', oneProject);
  r.get('/projects/:id/clips', paged(listClips));
  r.get('/projects/:id/cuts', paged(listCuts));
  r.get('/projects/:id/exports', paged(listExports));
  r.get('/projects/:id/comments', paged(listComments));

  r.use(wrongVerb);
  return r;
}

interface Page {
  limit: number;
  cursor: string | null;
  /** The raw position value of the last item served, decoded from the cursor. */
  after: string | null;
}

function readPage(req: Request, cursorKey: string): Page | ApiError {
  const q = req.query;
  let limit = 25;
  if (q.limit !== undefined) {
    const n = Number(q.limit);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      return ApiError.validation({ limit: { key: 'limit' } });
    }
    limit = n;
  }
  let after: string | null = null;
  if (typeof q.cursor === 'string' && q.cursor !== '') {
    try {
      const decoded = JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf-8')) as Record<string, unknown>;
      if (typeof decoded !== 'object' || decoded === null || typeof decoded.position === 'undefined') {
        return ApiError.validation({ cursor: { key: 'cursor' } });
      }
      after = String(decoded.position);
    } catch {
      return ApiError.validation({ cursor: { key: 'cursor' } });
    }
  }
  return { limit, cursor: typeof q.cursor === 'string' ? q.cursor : null, after };
}

function encodeCursor(key: string, value: string | number): string {
  return Buffer.from(JSON.stringify({ [key]: value }), 'utf-8').toString('base64url');
}

/** Position after the cursor's, for each list's stated order. */
function afterPosition(a: string, b: string): boolean {
  return a > b;
}

type ListHandler = (req: Request, page: Page, res: Response) => Promise<{ position: string; [key: string]: unknown }[]>;

function paged(handler: ListHandler): RequestHandler {
  return (req, res) => {
    void (async () => {
      const page = readPage(req, 'position');
      if (page instanceof ApiError) {
        respond(res, page);
        return;
      }
      const items = await handler(req, page, res);
      if (res.headersSent) return;
      // The position is the cursor's business alone: each item carries
      // exactly the published fields.
      const nextCursor = items.length === page.limit ? lastCursor(items) : null;
      const clean = items.map((item) => {
        const { position: _position, ...fields } = item as { position?: string };
        void _position;
        return fields;
      });
      res.json({ items: clean, next_cursor: nextCursor });
    })().catch((err) => respond(res, err));
  };
}

function lastCursor(items: { position: string }[]): string | null {
  const last = items[items.length - 1];
  if (last === undefined) return null;
  return encodeCursor('position', last.position);
}

async function listProjects(req: Request, page: Page, res: Response): Promise<{ position: string; [key: string]: unknown }[]> {
  const ctx = res.locals.ctx as AppCtx;
  const rows = await ctx.db.query(
    `SELECT id, title, agency, frame_rate, aspect_ratio, created_at,
       (SELECT MAX(version) FROM ops WHERE ops.project_id = projects.id) AS last_op
     FROM projects ORDER BY created_at, id`,
  );
  void req;
  const all = rows.rows.map((row: Record<string, unknown>) => ({
    position: new Date(row.created_at as string).toISOString() + '/' + String(row.id),
    id: row.id,
    title: row.title,
    agency: row.agency,
    frame_rate: row.frame_rate,
    aspect_ratio: row.aspect_ratio,
    total_frames: 0,
    updated_at: row.last_op === null ? new Date(row.created_at as string).toISOString() : new Date(row.last_op as string).toISOString(),
  }));
  const filtered = page.after === null ? all : all.filter((item) => afterPosition(item.position, page.after!));
  return filtered.slice(0, page.limit);
}

async function oneProject(req: Request, res: Response): Promise<void> {
  const ctx = res.locals.ctx as AppCtx;
  const row = await ctx.db.query('SELECT id, title, agency, frame_rate, aspect_ratio, created_at FROM projects WHERE id = $1', [req.params.id!]);
  if ((row.rowCount ?? 0) === 0) {
    respond(res, new ApiError('not_found'));
    return;
  }
  const r0 = row.rows[0]!;
  res.json({
    id: r0.id,
    title: r0.title,
    agency: r0.agency,
    frame_rate: r0.frame_rate,
    aspect_ratio: r0.aspect_ratio,
    total_frames: 0,
    updated_at: new Date(r0.created_at as string).toISOString(),
  });
}

async function listClips(req: Request, page: Page, res: Response): Promise<{ position: string; [key: string]: unknown }[]> {
  const ctx = res.locals.ctx as AppCtx;
  const rows = await ctx.db.query(
    `SELECT id, row_id, name, kind, start_frame, source_in, source_out, speed_percent, hidden, add_order, project_id
     FROM clips WHERE project_id = $1 ORDER BY add_order, id`,
    [req.params.id!],
  );
  // Clips in the order they were added: the page holds the items strictly
  // after the cursor's add_order, so additions appear only after it and
  // nothing is repeated.
  const all = rows.rows.map((row: Record<string, unknown>) => ({
    position: String(row.add_order),
    id: row.id,
    row_id: row.row_id,
    name: row.name,
    kind: row.kind,
    start_frame: Number(row.start_frame),
    end_frame: Number(row.start_frame) + clipLen(row),
    hidden: row.hidden === true,
  }));
  const filtered = page.after === null ? all : all.filter((item) => afterPosition(item.position, page.after!));
  return filtered.slice(0, page.limit);
}

function clipLen(row: Record<string, unknown>): number {
  const { clipLength } = require('../shared/frames') as typeof import('../shared/frames');
  return clipLength(Number(row.source_in), Number(row.source_out), Number(row.speed_percent));
}

async function listCuts(req: Request, page: Page, res: Response): Promise<{ position: string; [key: string]: unknown }[]> {
  const ctx = res.locals.ctx as AppCtx;
  const rows = await ctx.db.query(
    'SELECT id, name, total_frames, shared, created_at FROM cuts WHERE project_id = $1 AND shared = true ORDER BY created_at, id',
    [req.params.id!],
  );
  const all = rows.rows.map((row: Record<string, unknown>) => ({
    position: new Date(row.created_at as string).toISOString() + '/' + String(row.id),
    id: row.id,
    name: row.name,
    total_frames: Number(row.total_frames),
    created_at: new Date(row.created_at as string).toISOString(),
  }));
  const filtered = page.after === null ? all : all.filter((item) => afterPosition(item.position, page.after!));
  return filtered.slice(0, page.limit);
}

async function listExports(req: Request, page: Page, res: Response): Promise<{ position: string; [key: string]: unknown }[]> {
  const ctx = res.locals.ctx as AppCtx;
  const rows = await ctx.db.query(
    'SELECT id, cut_id, size, state, minutes, finished_at, created_at FROM exports WHERE project_id = $1 ORDER BY created_at, id',
    [req.params.id!],
  );
  const all = rows.rows.map((row: Record<string, unknown>) => ({
    position: new Date(row.created_at as string).toISOString() + '/' + String(row.id),
    id: row.id,
    cut_id: row.cut_id,
    size: Number(row.size),
    state: row.state,
    minutes: Number(row.minutes),
    finished_at: row.finished_at === null ? null : new Date(row.finished_at as string).toISOString(),
  }));
  const filtered = page.after === null ? all : all.filter((item) => afterPosition(item.position, page.after!));
  return filtered.slice(0, page.limit);
}

async function listComments(req: Request, page: Page, res: Response): Promise<{ position: string; [key: string]: unknown }[]> {
  const ctx = res.locals.ctx as AppCtx;
  const rows = await ctx.db.query(
    `SELECT id, cut_id, frame, body, author_name, created_at FROM comments
     WHERE project_id = $1 AND visibility = 'review' ORDER BY created_at, id`,
    [req.params.id!],
  );
  const all = rows.rows.map((row: Record<string, unknown>) => ({
    position: new Date(row.created_at as string).toISOString() + '/' + String(row.id),
    id: row.id,
    cut_id: row.cut_id,
    frame: Number(row.frame),
    body: row.body,
    author_name: row.author_name,
    created_at: new Date(row.created_at as string).toISOString(),
  }));
  const filtered = page.after === null ? all : all.filter((item) => afterPosition(item.position, page.after!));
  return filtered.slice(0, page.limit);
}
