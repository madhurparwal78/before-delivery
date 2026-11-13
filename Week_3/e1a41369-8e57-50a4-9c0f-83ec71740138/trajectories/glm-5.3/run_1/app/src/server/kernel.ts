export { config } from './config.js';
export { loadConfig } from './config.js';
export { ApiError, notEnoughGold, VALIDATION } from './errors.js';
export { q, q1, pool, tenths, fromTenths, isoDate, playerFromRow, taskFromRow } from './db.js';
export type { UserRow, TaskRow } from './db.js';
export { applyGains, loadTask } from './actions.js';
export { serializeTaskFor, toPlayer, toParty, toQuest, allTasksBody, partyIdOf } from './serialize.js';
export { live } from './live.js';
export { ObjectStore, detectImageType, IMPORT_MAX_BYTES, BANNER_MAX_BYTES } from './objectstore.js';
export { isZoneValid, localDateOf, allZones, weekdayOf, closeInstantFor, dayStartInstant, nextDayStartText } from './time.js';
export { parseDeedlist } from './deedlist.js';
export { runClose, runDueCloses } from './close.js';
export { seed } from './seed.js';
export { applySchema } from './schema.js';

import type { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UserRow } from './db.js';


declare module 'express-serve-static-core' {
  interface Request {
    user?: UserRow;
  }
}


export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  next();
}

export const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public'
);

/** The singleton object store used by the file routes. */
import { loadConfig } from './config.js';
import { ObjectStore as Store } from './objectstore.js';
import { live } from './live.js';
import { allTasksBody, toPlayer } from './serialize.js';
import { q1 } from './db.js';
export const store = new Store(loadConfig().s3);

export async function createTask(client: import('pg').PoolClient, userId: string, spec: {
  type: 'habit' | 'daily' | 'todo' | 'reward';
  title: string;
  difficulty: 'trivial' | 'easy' | 'medium' | 'hard';
  weekdays?: string[] | undefined;
  checklist?: string[] | undefined;
  price?: number | undefined;
}): Promise<import('./db.js').TaskRow> {
  const pos = (
    await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE owner_id=$1 AND type=$2`, [
      userId,
      spec.type,
    ])
  ).rows[0].n;
  const r = await client.query<import('./db.js').TaskRow>(
    `INSERT INTO tasks (owner_id, type, title, difficulty, weekdays, price_cents, position, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now()) RETURNING *`,
    [
      userId,
      spec.type,
      spec.title,
      spec.difficulty,
      spec.weekdays ?? null,
      spec.price !== undefined ? Math.round(spec.price * 100) : null,
      pos + 1,
    ]
  );
  if (spec.type === 'todo' && spec.checklist) {
    let i = 0;
    for (const text of spec.checklist) {
      i += 1;
      await client.query(`INSERT INTO checklist_items (task_id, position, text, checked) VALUES ($1,$2,$3,false)`, [
        r.rows[0].id,
        i,
        text,
      ]);
    }
  }
  return r.rows[0];
}

export function emitTasksLive(userId: string): void {
  void (async () => {
    live.toUser(userId, 'tasks', await allTasksBody(userId));
  })();
}

export function emitPlayerLive(userId: string): void {
  void (async () => {
    const u = await q1<UserRow>(`SELECT * FROM users WHERE id=$1`, [userId]);
    if (u) live.toUser(userId, 'player', await toPlayer(u));
  })();
}

