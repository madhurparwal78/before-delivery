import type { PoolClient } from 'pg';
import { instant, now } from './clock';
import { config } from './config';
import { one, transaction } from './db';
import { publishOperation, touch } from './hub';
import { loadCounts, type SpriteRow } from './model';
import { require, spriteAccess, type Right } from './access';
import type { Role } from '../shared/rules';
import type { Counts, Patch, SpriteEvent } from '../shared/types';

/** [buffer, cell index, before, after] cel changes, or a swatch or map-cell change, as undo records them. */
export type Change =
  | ['cel', number, number, number, number]
  | ['swatch', number, number, string, string]
  | ['map', number, number, number, number, boolean, boolean, number, boolean, boolean];

export interface Operation {
  tx: PoolClient;
  sprite: SpriteRow;
  role: Role;
  userId: number;
  userName: string;
  /** Gives the next sequence number to an operation and stores its event. */
  emit: (type: string, patch: Patch, changes?: Change[]) => Promise<number>;
  /** Records an undoable action for the person and clears their redo stack. */
  recordUndo: (seq: number, changes: Change[]) => Promise<void>;
  counts: () => Promise<Counts>;
}

/**
 * Runs one sprite operation: locks the sprite, checks the person's right at this moment, lets the
 * operation emit sequenced events, and publishes them after the commit.
 */
export async function runOperation<T>(userId: number, spriteId: number, right: Right, work: (op: Operation) => Promise<T>): Promise<T> {
  const published: SpriteEvent[] = [];
  const result = await transaction(async (tx) => {
    const { sprite, role } = await spriteAccess(userId, spriteId, tx, true);
    require(role, right);
    const userName = (await one<{ name: string }>(tx, 'SELECT name FROM users WHERE id = $1', [userId]))?.name ?? '';
    const operation: Operation = {
      tx,
      sprite,
      role,
      userId,
      userName,
      emit: async (type, patch, changes) => {
        sprite.seq += 1;
        const at = now();
        const data: Patch = { ...patch, actor: userId };
        await tx.query('INSERT INTO events (sprite_id, seq, type, by_user, at, data, changes) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
          sprite.id,
          sprite.seq,
          type,
          userId,
          at,
          JSON.stringify(data),
          changes ? JSON.stringify(changes) : null,
        ]);
        published.push({ seq: sprite.seq, type, by: userName, at: instant(at), data });
        return sprite.seq;
      },
      recordUndo: async (seq, changes) => {
        await tx.query("DELETE FROM undo_entries WHERE sprite_id = $1 AND user_id = $2 AND side = 'redo'", [sprite.id, userId]);
        await tx.query("INSERT INTO undo_entries (sprite_id, user_id, side, seq, changes) VALUES ($1, $2, 'undo', $3, $4)", [sprite.id, userId, seq, JSON.stringify(changes)]);
        await tx.query(
          `DELETE FROM undo_entries WHERE sprite_id = $1 AND user_id = $2 AND side = 'undo' AND id NOT IN
           (SELECT id FROM undo_entries WHERE sprite_id = $1 AND user_id = $2 AND side = 'undo' ORDER BY id DESC LIMIT $3)`,
          [sprite.id, userId, config.limits.undoDepth],
        );
      },
      counts: () => loadCounts(tx, sprite.id),
    };
    const value = await work(operation);
    await tx.query('UPDATE sprites SET seq = $2 WHERE id = $1', [sprite.id, sprite.seq]);
    return value;
  });
  for (const event of published) {
    publishOperation(spriteId, event);
    touch(spriteId, userId);
  }
  return result;
}

/** Clears every undo and redo stack of a sprite (merge down and restore). */
export const clearUndo = (tx: PoolClient, spriteId: number): Promise<unknown> => tx.query('DELETE FROM undo_entries WHERE sprite_id = $1', [spriteId]);

export interface ActivityRecord {
  kind: 'paint' | 'swatch' | 'restore' | 'comment' | 'invite' | 'export';
  data: Record<string, unknown>;
}

/** Appends an activity entry; consecutive strokes by one person on one sprite within 60 seconds of the group's first event merge. */
export async function recordActivity(tx: PoolClient, projectId: number, userId: number, spriteId: number | null, record: ActivityRecord): Promise<void> {
  const at = now();
  if (record.kind === 'paint') {
    const last = await one<{ id: number; user_id: number; sprite_id: number | null; kind: string; data: { pixels: number; strokes: number; frame: number }; first_at: number }>(
      tx,
      'SELECT id, user_id, sprite_id, kind, data, first_at FROM activity WHERE project_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [projectId],
    );
    if (last && last.kind === 'paint' && last.user_id === userId && last.sprite_id === spriteId && at - last.first_at <= 60_000) {
      const merged = { ...last.data, pixels: last.data.pixels + Number(record.data.pixels), strokes: last.data.strokes + 1 };
      await tx.query('UPDATE activity SET data = $2 WHERE id = $1', [last.id, JSON.stringify(merged)]);
      return;
    }
    record = { kind: 'paint', data: { ...record.data, strokes: 1 } };
  }
  await tx.query('INSERT INTO activity (project_id, user_id, sprite_id, kind, data, first_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    projectId,
    userId,
    spriteId,
    record.kind,
    JSON.stringify(record.data),
    at,
  ]);
}

