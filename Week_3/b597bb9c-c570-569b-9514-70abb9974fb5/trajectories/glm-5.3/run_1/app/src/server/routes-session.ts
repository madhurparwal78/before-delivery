import { Router, type Request, type Response } from 'express';
import type { AppCtx } from './ctx';
import { ApiError } from './api-errors';
import { requireAuth, findPersonByEmail, createSession, deleteSession, findSession, setSessionCookie, clearSessionCookie, type PersonRecord } from './sessions';
import { verifyPassword, newToken, allowanceText, utcMonth, nextMonthStart, codePoints, gb } from './util';
import { loadTimeline, totalFramesOf } from './timeline';
import type { Project, Role } from '../shared/types';
import { aspectSize, timecode } from '../shared/frames';

/** Session, person, profile, allowance, status, outbox. */
export function sessionRoutes(ctx: AppCtx): Router {
  const r = Router();

  r.post('/session', (req, res) => {
    void (async () => {
      const body = req.body as { email?: unknown; password?: unknown };
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (email === '' || password === '') {
        throw new ApiError('bad_credentials');
      }
      const person = await findPersonByEmail(ctx.db, email);
      if (person === null || !verifyPassword(password, person.password_hash)) {
        throw new ApiError('bad_credentials');
      }
      const token = newToken();
      await createSession(ctx.db, person.id, token);
      setSessionCookie(res, token);
      res.json({ person: { id: person.id, name: person.name, email: person.email, handle: person.handle } });
    })().catch((err) => respond(res, err));
  });

  r.get('/session', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const isOwner = person.id === ctx.ownerId;
      res.json({ person: { id: person.id, name: person.name, email: person.email, handle: person.handle }, is_owner: isOwner });
    })().catch((err) => respond(res, err));
  });

  r.delete('/session', (req, res) => {
    void (async () => {
      const token = readCookie(req);
      if (token !== null) {
        await deleteSession(ctx.db, token);
        ctx.live.closeSessionsOf((req as Request & { person: PersonRecord | null }).person?.id ?? '');
      }
      clearSessionCookie(res);
      res.status(204).end();
    })().catch((err) => respond(res, err));
  });

  r.get('/status', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('not_found');
      res.json({
        storage: ctx.storage.isUp() ? 'up' : 'down',
        queue: ctx.queue.isUp() ? 'up' : 'down',
        mail: ctx.mail.isUp() ? 'up' : 'down',
      });
    })().catch((err) => respond(res, err));
  });

  r.get('/allowance', (req, res) => {
    void (async () => {
      requireAuth(req);
      const allowance = await currentAllowance(ctx);
      res.json(allowance);
    })().catch((err) => respond(res, err));
  });

  r.get('/profile', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      const ws = await ctx.db.query<{ availability: string }>('SELECT availability FROM workspace LIMIT 1');
      res.json({ name: person.name, availability: ws.rows[0]?.availability ?? '' });
    })().catch((err) => respond(res, err));
  });

  r.put('/profile', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('forbidden');
      const body = req.body as { availability?: unknown };
      const availability = typeof body.availability === 'string' ? body.availability : '';
      if (codePoints(availability) > 140) {
        throw ApiError.validation({ availability: { key: 'other' } });
      }
      await ctx.db.query('UPDATE workspace SET availability = $1', [availability]);
      res.json({ name: person.name, availability });
    })().catch((err) => respond(res, err));
  });

  r.get('/outbox', (req, res) => {
    void (async () => {
      const person = requireAuth(req);
      if (person.id !== ctx.ownerId) throw new ApiError('not_found');
      const rows = await ctx.db.query(
        `SELECT id, to_address, subject, state, attempts, created_at, sent_at FROM outbox ORDER BY created_at DESC`,
      );
      res.json({
        items: rows.rows.map((row: Record<string, unknown>) => ({
          id: row.id,
          to: row.to_address,
          subject: row.subject,
          state: row.state,
          attempts: row.attempts,
          created_at: row.created_at,
          sent_at: row.sent_at,
        })),
      });
    })().catch((err) => respond(res, err));
  });

  return r;
}

export function readCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'gatecut_session') return v.join('=');
  }
  return null;
}

export function respond(res: Response, err: unknown): void {
  if (res.headersSent) return;
  if (err instanceof ApiError) {
    res.status(err.status).json(err.body);
    return;
  }
  const api = toApiError(err);
  if (api !== null) {
    res.status(api.status).json(api.body);
    return;
  }
  if (err instanceof Error) {
    console.error('request failed:', err.message, err.stack);
  }
  res.status(500).json({ error: 'not_found', message: 'Nothing here. It may have been removed or you may not have access.' });
}

/** Service errors become the one API error shape with the published copy. */
export function toApiError(err: unknown): ApiError | null {
  const service = err as {
    message?: string;
    winner?: string; items?: unknown[];
    code?: 'blocked' | 'row_locked' | 'group_blocked';
    reason?: string; clipName?: string; memberName?: string;
    field?: string;
  };
  if (typeof service.message === 'string' && service.message === 'conflict' && service.winner !== undefined) {
    return new ApiError('conflict', { winner: service.winner, clip: '' }, { winner: service.winner, items: service.items ?? [] });
  }
  if (service.code === 'blocked') {
    return new ApiError('blocked', { clip: service.clipName ?? '', reason: service.reason ?? '' });
  }
  if (service.code === 'row_locked') {
    return new ApiError('row_locked', { row: service.clipName ?? '' });
  }
  if (service.code === 'group_blocked') {
    return new ApiError('group_blocked', { member: service.memberName ?? '', reason: service.reason ?? '' });
  }
  if (service.field === 'nothing_to_undo' || service.message === 'nothing_to_undo') {
    return new ApiError('nothing_to_undo');
  }
  if (service.field === 'nothing_to_redo' || service.message === 'nothing_to_redo') {
    return new ApiError('nothing_to_redo');
  }
  if (service.field === 'undo_missing' || service.message === 'undo_missing') {
    return new ApiError('undo_missing', { clip: '' });
  }
  if (service.field === 'undo_blocked' || service.message === 'undo_blocked') {
    return new ApiError('undo_blocked', { clip: '' });
  }
  if (typeof service.field === 'string' && service.field !== '') {
    return ApiError.validation({ [service.field]: { key: 'other' } });
  }
  return null;
}

/** The shared allowance, computed from the shared counters. */
export async function currentAllowance(ctx: AppCtx): Promise<{
  workspace_id: string;
  month: string;
  export_minutes_used: number;
  export_minutes_allowance: number;
  storage_bytes_used: number;
  storage_bytes_allowance: number;
  resets_at: string;
  text: string;
}> {
  const month = utcMonth();
  let minutes = await ctx.counters.getExportMinutes(month);
  if (minutes === null) {
    const { rebuildOpeningMinutes } = await import('./allowance');
    minutes = await rebuildOpeningMinutes(ctx);
    await ctx.counters.setExportMinutes(month, minutes);
  }
  let storage = await ctx.counters.getStorageBytes();
  if (storage === null) {
    const ws = await ctx.db.query<{ carried: string }>('SELECT carried_storage_bytes AS carried FROM workspace LIMIT 1');
    const media = await ctx.db.query<{ total: string }>('SELECT COALESCE(SUM(bytes),0) AS total FROM media');
    storage = Number(ws.rows[0]!.carried) + Number(media.rows[0]!.total);
    await ctx.counters.setStorageBytes(storage);
  }
  return {
    workspace_id: ctx.workspaceId,
    month,
    export_minutes_used: minutes,
    export_minutes_allowance: ctx.config.exportMinuteAllowance,
    storage_bytes_used: storage,
    storage_bytes_allowance: ctx.config.storageAllowanceBytes,
    resets_at: nextMonthStart().toISOString(),
    text: allowanceText(
      { used: minutes, allowance: ctx.config.exportMinuteAllowance },
      { used: storage, allowance: ctx.config.storageAllowanceBytes },
    ),
  };
}

export async function announceAllowance(ctx: AppCtx): Promise<void> {
  const allowance = await currentAllowance(ctx);
  ctx.live.publishAllowance({ type: 'allowance', allowance });
}
