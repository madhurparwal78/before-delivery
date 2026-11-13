import express, { type Request, type Response, type NextFunction } from 'express';
import type { PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import {
  bandOf,
  damageTenthsFor,
  goldCentsFor,
  habitDownHealthTenths,
  missedDailyHealthTenths,
  strikeBackTenths,
  fixtureByName,
  QUEST_FIXTURES,
  WEEKDAYS,
  experienceToLevel,
} from '../shared/rules.js';
import type { TaskType, Difficulty, Weekday, QuestState, LedgerKind } from '../shared/rules.js';
import type { ActionResult, Party, Quest, StrikeEvent, Task, Player, ChatMessage, ImportRecord } from '../shared/types.js';
import {
  config, ApiError, q, q1, pool, requireAuth, live, toPlayer, toParty, toQuest, allTasksBody,
  partyIdOf, applyGains, loadTask, serializeTaskFor, applySchema, seed, isZoneValid, localDateOf,
  allZones, weekdayOf, closeInstantFor, dayStartInstant, nextDayStartText, runDueCloses, PUBLIC_DIR,
  type UserRow, type TaskRow,
} from './kernel.js';
import {
  runActionInTransaction, scoreHabit, completeTask, uncompleteTask, buyReward,
  type ActionOutcome,
} from './taskactions.js';
import { registerPartyRoutes } from './partyroutes.js';
import { registerFileRoutes } from './fileroutes.js';
import { registerLiveRoute, registerStatic } from './liveroutes.js';
import { registerGradingRoutes } from './gradingroutes.js';
import { runClose } from './close.js';

const JSON_LIMIT = 64000;

function newToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function sessionCookie(token: string, expire = false): string {
  const base = `deed_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
  return expire ? `${base}; Max-Age=0` : `${base}; Max-Age=${60 * 60 * 24 * 30}`;
}

export function buildApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(cookieParser());
  if (process.env.DBG_REQUEST) {
    app.use((req, res, next) => {
      const t0 = Date.now();
      res.on('finish', () => console.log('DBG-REQUEST', req.method, req.path, res.statusCode, Date.now() - t0 + 'ms'));
      next();
    });
  }

  // One origin: state-changing requests naming another origin are refused.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      let host: string | null = null;
      try {
        host = new URL(origin as string).host;
      } catch {
        host = null;
      }
      if (!host || host !== (req.headers.host ?? null)) {
        res.status(403).json({ error: 'cross_origin' });
        return;
      }
    }
    next();
  });

  // JSON body limit and media type enforcement for API routes.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const ct = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const isMultipart = ct === 'multipart/form-data';
    const isUpload =
      req.path === '/imports' || (/^\/parties\/[^/]+\/banner$/.test(req.path) && req.method === 'PUT');
    if (isUpload) {
      if (!isMultipart) {
        res.status(415).json({ error: 'unsupported_media_type' });
        return;
      }
      next();
      return;
    }
    // An empty body carries nothing to parse; treat it as an empty JSON object.
    const len = Number(req.headers['content-length'] ?? '0');
    if (len === 0) {
      (req as Request & { body?: unknown }).body = {};
      next();
      return;
    }
    if (ct !== 'application/json') {
      res.status(415).json({ error: 'unsupported_media_type' });
      return;
    }
    if (len > JSON_LIMIT) {
      res.status(413).json({ error: 'body_too_large' });
      return;
    }
    express.json({ limit: JSON_LIMIT })(req, res, (err?: unknown) => {
      if (err) {
        const e = err as { type?: string };
        if (e?.type === 'entity.too.large') {
          res.status(413).json({ error: 'body_too_large' });
          return;
        }
        res.status(415).json({ error: 'unsupported_media_type' });
        return;
      }
      next();
    });
  });

  // Multipart parsing for the two upload endpoints.
  app.use('/api/imports', (req, res, next) => {
    if (req.method !== 'POST') return next();
    multipartSingle(req, res, next, 100001);
  });
  app.use('/api/parties/:id/banner', (req, res, next) => {
    if (req.method !== 'PUT') return next();
    multipartSingle(req, res, next, 2000001);
  });

  // Session loading.
  app.use('/api', async (req, _res, next) => {
    try {
      const token = req.cookies?.['deed_session'];
      if (token) {
        const row = await q1<UserRow & { token: string }>(
          `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1`,
          [token]
        );
        if (row) req.user = row;
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  registerRoutes(app);

  // API 404 and error shapes.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json(err.body());
      return;
    }
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505') {
      res.status(409).json({ error: 'already_done' });
      return;
    }
    res.status(500).json({ error: 'not_found' });
  });

  registerStatic(app);
  return app;
}

/** Minimal multipart/form-data reader: one part named `file`. */
function multipartSingle(req: Request, res: Response, next: NextFunction, maxBytes: number): void {
  const contentType = req.headers['content-type'] ?? '';
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) {
    res.status(415).json({ error: 'unsupported_media_type' });
    return;
  }
  const boundary = `--${m[1] ?? m[2]}`;
  const chunks: Buffer[] = [];
  let received = 0;
  let aborted = false;
  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    received += chunk.length;
    if (received > maxBytes + 8192) {
      aborted = true;
      res.status(413).json({ error: 'file_too_large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    const body = Buffer.concat(chunks);
    const start = body.indexOf(boundary);
    if (start === -1) {
      res.status(415).json({ error: 'unsupported_media_type' });
      return;
    }
    const parts = [];
    let idx = start;
    while (true) {
      const next = body.indexOf(boundary, idx + boundary.length);
      const part = body.subarray(idx, next === -1 ? body.length : next);
      parts.push(part);
      if (next === -1) break;
      idx = next;
    }
    for (const part of parts) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const nameMatch = /name="([^"]*)"/.exec(headers);
      const fileMatch = /filename="([^"]*)"/.exec(headers);
      const content = part.subarray(headerEnd + 4, part.length - 2);
      if (nameMatch && nameMatch[1] === 'file') {
        (req as Request & { files?: Record<string, { originalname: string; buffer: Buffer; size: number }> }).files = {
          file: { originalname: fileMatch?.[1] ?? 'upload', buffer: content, size: content.length },
        };
        break;
      }
    }
    next();
  });
  req.on('error', () => {
    if (!aborted) {
      aborted = true;
      res.status(500).json({ error: 'not_found' });
    }
  });
}

function registerRoutes(app: express.Express): void {
  // -- health ---------------------------------------------------------------
  app.get('/api/health', async (_req, res) => {
    try {
      await q(`SELECT 1`);
    } catch {
      res.status(503).json({ status: 'starting' });
      return;
    }
    try {
      const { ObjectStore } = await import('./objectstore.js');
      void ObjectStore;
      const s = new (await import('./objectstore.js')).ObjectStore(config.s3);
      await s.ensureBucket();
      res.json({ status: 'ok' });
    } catch {
      res.json({ status: 'unavailable' });
    }
  });

  // -- auth -----------------------------------------------------------------
  app.post('/api/auth/signup', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const errors: Record<string, string> = {};
      const username = String(body.username ?? '');
      const password = String(body.password ?? '');
      if (!/^[a-z0-9_]{3,20}$/.test(username)) errors.username = 'Use 3 to 20 lowercase letters, digits or _.';
      if (password.length < 8) errors.password = 'Use at least 8 characters.';
      if (Object.keys(errors).length > 0) {
        res.status(422).json({ errors });
        return;
      }
      const taken = await q1(`SELECT id FROM users WHERE username=$1`, [username]);
      if (taken) {
        res.status(409).json({ error: 'username_taken' });
        return;
      }
      const today = localDateOf(new Date(), 'UTC', 0);
      const hash = await bcrypt.hash(password, 10);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const u = await client.query<UserRow>(
          `INSERT INTO users (username, password_hash, open_date) VALUES ($1,$2,$3) RETURNING *`,
          [username, hash, today]
        );
        const token = newToken();
        await client.query(`INSERT INTO sessions (token, user_id) VALUES ($1,$2)`, [token, u.rows[0].id]);
        await client.query('COMMIT');
        res.setHeader('Set-Cookie', sessionCookie(token));
        res.status(201).json(await toPlayer(u.rows[0]));
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const { username, password } = req.body as Record<string, unknown>;
      const u = await q1<UserRow>(`SELECT * FROM users WHERE username=$1`, [String(username ?? '')]);
      if (!u || !(await bcrypt.compare(String(password ?? ''), u.password_hash))) {
        res.status(401).json({ error: 'invalid_credentials' });
        return;
      }
      const token = newToken();
      await q(`INSERT INTO sessions (token, user_id) VALUES ($1,$2)`, [token, u.id]);
      res.setHeader('Set-Cookie', sessionCookie(token));
      res.json(await toPlayer(u));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', requireAuth, async (req, res) => {
    const token = req.cookies?.['deed_session'];
    if (token) await q(`DELETE FROM sessions WHERE token=$1`, [token]);
    res.setHeader('Set-Cookie', sessionCookie('', true));
    res.status(204).end();
  });

  app.get('/api/me', requireAuth, async (req, res) => {
    res.json(await toPlayer(req.user!));
  });

  app.patch('/api/settings', requireAuth, async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const errors: Record<string, string> = {};
      if ('timeZone' in body && !isZoneValid(String(body.timeZone))) errors.timeZone = 'Unknown time zone.';
      if ('dayStartHour' in body) {
        const h = body.dayStartHour;
        if (!Number.isInteger(h) || (h as number) < 0 || (h as number) > 23) {
          errors.dayStartHour = 'Day start hour must be a whole number from 0 to 23.';
        }
      }
      if ('resting' in body && typeof body.resting !== 'boolean') {
        errors.resting = 'Rest mode must be on or off.';
      }
      if (Object.keys(errors).length > 0) {
        res.status(422).json({ errors });
        return;
      }
      const client = await pool.connect();
      let after: UserRow;
      try {
        await client.query('BEGIN');
        const sets: string[] = [];
        const params: unknown[] = [req.user!.id];
        if ('timeZone' in body) {
          params.push(String(body.timeZone));
          sets.push(`time_zone=$${params.length}`);
        }
        if ('dayStartHour' in body) {
          params.push(body.dayStartHour as number);
          sets.push(`day_start_hour=$${params.length}`);
        }
        if ('resting' in body) {
          params.push(body.resting);
          sets.push(`resting=$${params.length}`);
        }
        if (sets.length > 0) {
          await client.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$1`, params);
        }
        // A changed zone or hour applies from the next close; if the
        // recomputed close instant has already passed, close at this moment.
        const before = req.user!;
        const beforeClose = closeInstantFor(
          before.open_date.toISOString().slice(0, 10),
          before.time_zone,
          before.day_start_hour
        );
        const mid = (await client.query<UserRow>(`SELECT * FROM users WHERE id=$1`, [req.user!.id])).rows[0];
        const today = mid.open_date.toISOString().slice(0, 10);
        const closeAt = closeInstantFor(today, mid.time_zone, mid.day_start_hour);
        const zoneChanged = 'timeZone' in body && String(body.timeZone) !== before.time_zone;
        const hourChanged = 'dayStartHour' in body && body.dayStartHour !== before.day_start_hour;
        if (
          (zoneChanged || hourChanged) &&
          closeAt.getTime() <= Date.now() &&
          closeAt.getTime() !== beforeClose.getTime()
        ) {
          await runClose(client, mid.id, today, new Date());
        }
        after = (await client.query<UserRow>(`SELECT * FROM users WHERE id=$1`, [req.user!.id])).rows[0];
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      res.json(await toPlayer(after));
      void emitPlayerLiveQuiet(after.id);
      void emitTasksLiveQuiet(after.id);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/notices/:id/ack', requireAuth, async (req, res) => {
    const r = await q(`DELETE FROM notices WHERE id=$1 AND user_id=$2 RETURNING id`, [
      req.params.id,
      req.user!.id,
    ]);
    if (r.rows.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  });

  // -- tasks ----------------------------------------------------------------
  app.get('/api/tasks', requireAuth, async (req, res) => {
    res.json(await allTasksBody(req.user!.id));
  });

  app.post('/api/tasks', requireAuth, async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const errors = validateTaskBody(body);
      if (errors) {
        res.status(422).json({ errors });
        return;
      }
      const type = body.type as TaskType;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { createTask } = await import('./kernel.js');
        const task = await createTask(client, req.user!.id, {
          type,
          title: String(body.title),
          difficulty: (body.difficulty ?? 'easy') as Difficulty,
          weekdays: type === 'daily' ? (body.weekdays as Weekday[]) : undefined,
          checklist: type === 'todo' ? (body.checklist as string[]) : undefined,
          price: type === 'reward' ? Number(body.price) : undefined,
        });
        await client.query('COMMIT');
        const u = await q1<UserRow>(`SELECT * FROM users WHERE id=$1`, [req.user!.id]);
        res.status(201).json(await serializeTaskFor(task, u!));
        void emitTasksLiveQuiet(req.user!.id);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/tasks/:id', requireAuth, async (req, res, next) => {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const t = await loadTask(client, req.user!.id, String(req.params.id));
        if (!t) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        const body = req.body as Record<string, unknown>;
        const updatedAt = String(body.updatedAt ?? '');
        if (updatedAt !== t.updated_at.toISOString()) {
          res.status(409).json({ error: 'stale_task' });
          return;
        }
        const errors = validateTaskEdit(body, t);
        if (errors) {
          res.status(422).json({ errors });
          return;
        }
        const updated = await writeTaskEdit(client, t, body);
        await client.query('COMMIT');
        const u = await q1<UserRow>(`SELECT * FROM users WHERE id=$1`, [req.user!.id]);
        res.json(await serializeTaskFor(updated, u!));
        void emitTasksLiveQuiet(req.user!.id);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/tasks/:id', requireAuth, async (req, res, next) => {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const t = await loadTask(client, req.user!.id, String(req.params.id));
        if (!t) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        await client.query(`DELETE FROM tasks WHERE id=$1`, [t.id]);
        await client.query(
          `UPDATE tasks SET position = position - 1 WHERE owner_id=$1 AND type=$2 AND position > $3`,
          [req.user!.id, t.type, t.position]
        );
        await client.query('COMMIT');
        res.status(204).end();
        void emitTasksLiveQuiet(req.user!.id);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/tasks/:id/move', requireAuth, async (req, res, next) => {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const t = await loadTask(client, req.user!.id, String(req.params.id));
        if (!t) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        const total = (
          await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE owner_id=$1 AND type=$2`, [
            req.user!.id,
            t.type,
          ])
        ).rows[0].n;
        const pos = (req.body as Record<string, unknown>).position;
        if (!Number.isInteger(pos) || (pos as number) < 1 || (pos as number) > total) {
          res.status(422).json({ errors: { position: `Position must be from 1 to ${total}.` } });
          return;
        }
        await applyMove(client, req.user!.id, t.type, t.id, t.position, pos as number);
        await client.query('COMMIT');
        const u = await q1<UserRow>(`SELECT * FROM users WHERE id=$1`, [req.user!.id]);
        const rows = await client.query<TaskRow>(
          `SELECT * FROM tasks WHERE owner_id=$1 AND type=$2 ORDER BY position`,
          [req.user!.id, t.type]
        );
        const tasks: Task[] = [];
        for (const row of rows.rows) tasks.push(await serializeTaskFor(row, u!));
        res.json({ tasks });
        void emitTasksLiveQuiet(req.user!.id);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/tasks/:id/score', requireAuth, idempotent(async (req, res) => {
    const outcome = await runActionInTransaction(req, async (client, user, task) => {
      const direction = (req.body as Record<string, unknown>).direction;
      if (direction !== 'up' && direction !== 'down') {
        res.status(422).json({ errors: { direction: 'Direction must be up or down.' } });
        return null;
      }
      if (task.type !== 'habit') {
        res.status(422).json({ errors: { type: 'This action does not fit this task type.' } });
        return null;
      }
      return scoreHabit(client, user, task, direction);
    });
    if (outcome) {
      res.json(outcome.result);
      void emitActionLive(req.user!.id, outcome);
    }
  }));

  app.post('/api/tasks/:id/complete', requireAuth, idempotent(async (req, res) => {
    const outcome = await runActionInTransaction(req, async (client, user, task) => {
      if (task.type !== 'daily' && task.type !== 'todo') {
        res.status(422).json({ errors: { type: 'This action does not fit this task type.' } });
        return null;
      }
      if (task.done) {
        res.status(409).json({ error: 'already_done' });
        return null;
      }
      return completeTask(client, user, task);
    });
    if (outcome) {
      res.json(outcome.result);
      void emitActionLive(req.user!.id, outcome);
    }
  }));

  app.post('/api/tasks/:id/uncomplete', requireAuth, idempotent(async (req, res) => {
    const outcome = await runActionInTransaction(req, async (client, user, task) => {
      if (!task.done) {
        res.status(409).json({ error: 'not_done' });
        return null;
      }
      return uncompleteTask(client, user, task, config.undoWindowSeconds);
    });
    if (outcome) {
      res.json(outcome.result);
      void emitActionLive(req.user!.id, outcome);
    }
  }));

  app.patch('/api/tasks/:id/checklist/:itemId', requireAuth, async (req, res, next) => {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const t = await loadTask(client, req.user!.id, String(req.params.id));
        if (!t) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        const item = (
          await client.query<{ id: string }>(`SELECT id FROM checklist_items WHERE id=$1 AND task_id=$2`, [
            req.params.itemId,
            t.id,
          ])
        ).rows[0];
        if (!item) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        const checked = (req.body as Record<string, unknown>).checked;
        if (typeof checked !== 'boolean') {
          res.status(422).json({ errors: { checked: 'Checked must be true or false.' } });
          return;
        }
        await client.query(`UPDATE checklist_items SET checked=$2 WHERE id=$1`, [item.id, checked]);
        await client.query(`UPDATE tasks SET updated_at=now() WHERE id=$1`, [t.id]);
        await client.query('COMMIT');
        const fresh = (await client.query<TaskRow>(`SELECT * FROM tasks WHERE id=$1`, [t.id])).rows[0];
        const u = await q1<UserRow>(`SELECT * FROM users WHERE id=$1`, [req.user!.id]);
        res.json(await serializeTaskFor(fresh, u!));
        void emitTasksLiveQuiet(req.user!.id);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/rewards/:id/buy', requireAuth, idempotent(async (req, res) => {
    const outcome = await runActionInTransaction(req, async (client, user, task) => {
      if (task.type !== 'reward') {
        res.status(422).json({ errors: { type: 'This action does not fit this task type.' } });
        return null;
      }
      const priceCents = task.price_cents ?? 0;
      if (priceCents > user.gold_cents) {
        res.status(422).json({ errors: { gold: 'Not enough gold.' } });
        return null;
      }
      return buyReward(client, user, task);
    });
    if (outcome) {
      res.json(outcome.result);
      void emitPlayerLiveQuiet(req.user!.id);
      void emitTasksLiveQuiet(req.user!.id);
    }
  }));

  app.get('/api/gold/ledger', requireAuth, async (req, res) => {
    const entries = await q<{
      id: string;
      kind: string;
      amount_cents: number;
      task_id: string | null;
      created_at: Date;
    }>(`SELECT * FROM ledger WHERE user_id=$1 ORDER BY created_at, id`, [req.user!.id]);
    const balance = entries.rows.reduce((s, e) => s + e.amount_cents, 0);
    res.json({
      balance: balance / 100,
      entries: entries.rows.map((e) => ({
        id: e.id,
        kind: e.kind,
        amount: e.amount_cents / 100,
        taskId: e.task_id,
        createdAt: e.created_at.toISOString(),
      })),
    });
  });

  registerPartyRoutes(app);
  registerFileRoutes(app);
  registerLiveRoute(app);
  registerGradingRoutes(app);
}

// ---------------------------------------------------------------------------
// task edit helpers

function validateTaskBody(body: Record<string, unknown>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  const type = body.type as TaskType | undefined;
  if (!type || !['habit', 'daily', 'todo', 'reward'].includes(type)) {
    return { type: 'This action does not fit this task type.' };
  }
  const title = String(body.title ?? '');
  if (title.length < 1 || title.length > 80) errors.title = 'Title must be 1 to 80 characters.';
  const difficulty = String(body.difficulty ?? 'easy');
  if (!['trivial', 'easy', 'medium', 'hard'].includes(difficulty)) {
    errors.difficulty = 'Choose trivial, easy, medium or hard.';
  }
  if (type === 'daily') {
    const wd = Array.isArray(body.weekdays) ? (body.weekdays as string[]) : [];
    const valid =
      wd.length > 0 &&
      wd.every((w) => (WEEKDAYS as readonly string[]).includes(w)) &&
      new Set(wd).size === wd.length;
    if (!valid) errors.weekdays = 'Choose at least one weekday.';
  }
  if (type === 'reward') {
    const p = Number(body.price);
    if (!Number.isFinite(p) || p < 0.01 || p > 9999.99) errors.price = 'Price must be from 0.01 to 9999.99.';
  }
  if (Object.keys(errors).length === 0) return null;
  return errors;
}

function validateTaskEdit(body: Record<string, unknown>, t: TaskRow): Record<string, string> | null {
  const errors: Record<string, string> = {};
  const title = String(body.title ?? t.title);
  if (title.length < 1 || title.length > 80) errors.title = 'Title must be 1 to 80 characters.';
  const difficulty = String(body.difficulty ?? t.difficulty);
  if (!['trivial', 'easy', 'medium', 'hard'].includes(difficulty)) {
    errors.difficulty = 'Choose trivial, easy, medium or hard.';
  }
  if (t.type === 'daily' && 'weekdays' in body) {
    const wd = Array.isArray(body.weekdays) ? (body.weekdays as string[]) : [];
    const valid =
      wd.length > 0 &&
      wd.every((w) => (WEEKDAYS as readonly string[]).includes(w)) &&
      new Set(wd).size === wd.length;
    if (!valid) errors.weekdays = 'Choose at least one weekday.';
  }
  if (t.type === 'reward' && 'price' in body) {
    const p = Number(body.price);
    if (!Number.isFinite(p) || p < 0.01 || p > 9999.99) errors.price = 'Price must be from 0.01 to 9999.99.';
  }
  if (Object.keys(errors).length === 0) return null;
  return errors;
}

async function writeTaskEdit(
  client: PoolClient,
  t: TaskRow,
  body: Record<string, unknown>
): Promise<TaskRow> {
  const sets = [`title=$2`, `difficulty=$3`, `updated_at=now()`];
  const params: unknown[] = [
    t.id,
    'title' in body ? String(body.title) : t.title,
    'difficulty' in body ? String(body.difficulty) : t.difficulty,
  ];
  if (t.type === 'daily' && 'weekdays' in body) {
    params.push(body.weekdays as string[]);
    sets.push(`weekdays=$${params.length}`);
  }
  if (t.type === 'reward' && 'price' in body) {
    params.push(Math.round(Number(body.price) * 100));
    sets.push(`price_cents=$${params.length}`);
  }
  if (t.type === 'todo' && 'checklist' in body) {
    await rewriteChecklist(client, t.id, (body.checklist as { id?: string; text: string }[]) ?? []);
  }
  const r = await client.query<TaskRow>(`UPDATE tasks SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, params);
  return r.rows[0];
}

async function rewriteChecklist(
  client: PoolClient,
  taskId: string,
  items: { id?: string; text: string }[]
): Promise<void> {
  const existing = (
    await client.query<{ id: string }>(`SELECT id FROM checklist_items WHERE task_id=$1`, [taskId])
  ).rows;
  const byId = new Set(existing.map((e) => e.id));
  let position = 0;
  for (const item of items) {
    position += 1;
    if (item.id && byId.has(item.id)) {
      await client.query(`UPDATE checklist_items SET text=$2, position=$3 WHERE id=$1`, [
        item.id,
        item.text,
        position,
      ]);
      byId.delete(item.id);
    } else {
      await client.query(
        `INSERT INTO checklist_items (task_id, position, text, checked) VALUES ($1,$2,$3,false)`,
        [taskId, position, item.text]
      );
    }
  }
  for (const id of byId) {
    await client.query(`DELETE FROM checklist_items WHERE id=$1`, [id]);
  }
}

async function applyMove(
  client: PoolClient,
  userId: string,
  type: string,
  taskId: string,
  from: number,
  to: number
): Promise<void> {
  // Clear the unique position first so the shift never collides.
  await client.query(`UPDATE tasks SET position = NULL WHERE id=$1 AND owner_id=$2`, [
    taskId,
    userId,
  ]);
  if (from < to) {
    await client.query(
      `UPDATE tasks SET position = position - 1 WHERE owner_id=$1 AND type=$2 AND position IS NOT NULL AND position > $3 AND position <= $4`,
      [userId, type, from, to]
    );
  } else if (from > to) {
    await client.query(
      `UPDATE tasks SET position = position + 1 WHERE owner_id=$1 AND type=$2 AND position IS NOT NULL AND position >= $3 AND position < $4`,
      [userId, type, to, from]
    );
  }
  await client.query(`UPDATE tasks SET position=$3, updated_at=now() WHERE id=$1 AND owner_id=$2`, [
    taskId,
    userId,
    to,
  ]);
}

// ---------------------------------------------------------------------------
// idempotency

type Handler = (req: Request, res: Response) => Promise<void>;

/**
 * Idempotency: a repeated key returns the stored response; the same key with
 * a different request answers 409. Keys are scoped to the player.
 */
function idempotent(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = req.header('Idempotency-Key');
      if (!key || key.length > 100) {
        await handler(req, res);
        return;
      }
      const user = req.user!;
      const bodyText = JSON.stringify(req.body ?? null);
      const path = req.originalUrl.split('?')[0];
      const existing = await q1<{
        method: string;
        path: string;
        body: string | null;
        status: number;
        response: unknown;
      }>(`SELECT * FROM idempotency WHERE user_id=$1 AND key=$2`, [user.id, key]);
      if (existing) {
        if (
          existing.method === req.method &&
          existing.path === path &&
          (existing.body ?? null) === bodyText
        ) {
          res.status(existing.status).json(existing.response as Record<string, unknown>);
          return;
        }
        res.status(409).json({ error: 'idempotency_key_reused' });
        return;
      }
      let captured: { status: number; body: unknown } | null = null;
      const origJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        captured = { status: res.statusCode, body };
        return origJson(body);
      }) as typeof res.json;
      await handler(req, res);
      if (captured && res.statusCode < 500) {
        await q(
          `INSERT INTO idempotency (user_id, key, method, path, body, status, response)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id, key) DO NOTHING`,
          [user.id, key, req.method, path, bodyText, (captured as { status: number }).status, JSON.stringify((captured as { body: unknown }).body)]
        );
      }
    } catch (err) {
      next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// live emission helpers

function emitPlayerLiveQuiet(userId: string): void {
  void (async () => {
    const u = await q1<UserRow>(`SELECT * FROM users WHERE id=$1`, [userId]);
    if (u) live.toUser(userId, 'player', await toPlayer(u));
  })();
}

function emitTasksLiveQuiet(userId: string): void {
  void (async () => {
    live.toUser(userId, 'tasks', await allTasksBody(userId));
  })();
}

async function emitActionLive(userId: string, outcome: ActionOutcome): Promise<void> {
  const u = await q1<UserRow>(`SELECT * FROM users WHERE id=$1`, [userId]);
  if (u) live.toUser(userId, 'player', await toPlayer(u));
  live.toUser(userId, 'tasks', await allTasksBody(userId));
  if (outcome.result.strike) {
    const partyId = await partyIdOf(userId);
    if (partyId) {
      const questId = await questOfParty(partyId);
      if (questId) {
        live.toParty(partyId, 'strike', { ...outcome.result.strike, questId });
        const quest = await toQuest(questId, u?.username ?? null);
        if (quest) live.toParty(partyId, 'quest', quest);
      }
    }
  }
  if (outcome.questEnded) {
    const partyId = await partyIdOf(userId);
    if (partyId) {
      const party = await toParty(partyId);
      if (party) {
        live.toParty(partyId, 'party', { party });
        for (const m of party.members) {
          const mu = await q1<UserRow>(`SELECT * FROM users WHERE username=$1`, [m.username]);
          if (mu) live.toUser(mu.id, 'player', await toPlayer(mu));
        }
      }
    }
  }
}

async function questOfParty(partyId: string): Promise<string | null> {
  const r = await q1<{ id: string }>(
    `SELECT id FROM quests WHERE party_id=$1 AND state IN ('invited','active') ORDER BY invited_at DESC`,
    [partyId]
  );
  return r?.id ?? null;
}
