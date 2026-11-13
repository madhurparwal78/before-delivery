// The change log of a drawing: one row per version-raising write, the activity entries derived from it, and undo/redo.
import { objectsCount } from '../shared/copy.ts';
import type { ActivityEntry } from '../shared/types.ts';
import { clockTime } from './clock.ts';
import type { Patch } from './engine/types.ts';
import type { Queryable } from './db.ts';
import { sortHandles } from './drawing-store.ts';

/** Uploads and restores replace the whole drawing: they are logged for conflicts but are not activity and block undo across them. */
export const REPLACEMENTS = ['UPLOAD', 'RESTORE'] as const;
/** XREF changes have no object image to reverse. */
const NOT_UNDOABLE = ['XREF', ...REPLACEMENTS];
const ACTIVITY_LIMIT = 50;

interface ChangeRecord {
  version: number;
  actor_key: string;
  actor_name: string;
  command: string;
  created: string[];
  modified: string[];
  erased: string[];
  before: Patch;
  after: Patch;
  at: Date;
}

export async function recordChange(client: Queryable, drawingId: string, change: ChangeRecord): Promise<void> {
  await client.query(
    `INSERT INTO changes (drawing_id, version, actor_key, actor_name, command, created, modified, erased, before, after, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [drawingId, change.version, change.actor_key, change.actor_name, change.command, change.created, change.modified,
      change.erased, JSON.stringify(change.before), JSON.stringify(change.after), change.at]);
}

/** Every handle a change touched, in handle order. */
export function touchedHandles(change: Pick<ChangeRecord, 'created' | 'modified' | 'erased'>): string[] {
  return sortHandles(new Set([...change.created, ...change.modified, ...change.erased]));
}

export function activityEntry(change: Pick<ChangeRecord, 'actor_name' | 'command' | 'created' | 'modified' | 'erased' | 'at'>, zone: string): ActivityEntry {
  const count = touchedHandles(change).length;
  const onlyCreated = change.created.length > 0 && change.modified.length === 0 && change.erased.length === 0;
  const onlyErased = change.erased.length > 0 && change.created.length === 0 && change.modified.length === 0;
  const verb = onlyCreated ? 'created' : onlyErased ? 'erased' : 'modified';
  return {
    at: change.at.toISOString(),
    actor: change.actor_name,
    command: change.command,
    count,
    verb,
    text: `${clockTime(change.at, zone)} · ${change.actor_name} · ${change.command} · ${objectsCount(count)} ${verb}`,
  };
}

export async function listActivity(client: Queryable, drawingId: string, zone: string): Promise<ActivityEntry[]> {
  const { rows } = await client.query<ChangeRecord>(
    `SELECT actor_name, command, created, modified, erased, at FROM changes
     WHERE drawing_id = $1 AND command <> ALL($2::text[]) ORDER BY version DESC LIMIT $3`,
    [drawingId, REPLACEMENTS, ACTIVITY_LIMIT]);
  return rows.map((row) => activityEntry(row, zone));
}

interface UndoRedoPlan {
  /** The command being reversed or replayed. */
  command: string;
  /** What to record for the UNDO or REDO itself; `after` is the image to apply. */
  record: Pick<ChangeRecord, 'created' | 'modified' | 'erased' | 'before' | 'after'>;
}

/**
 * Walks the actor's commands since the last replacement as an undo stack: a command pushes and clears the redo stack,
 * UNDO moves the top across to the redo stack, REDO moves it back.
 */
async function undoRedoStacks(client: Queryable, drawingId: string, actorKey: string): Promise<{ done: number[]; undone: number[] }> {
  const { rows } = await client.query<{ version: number; command: string }>(
    `SELECT version, command FROM changes
     WHERE drawing_id = $1 AND actor_key = $2 AND command <> ALL($3::text[])
       AND version > COALESCE((SELECT MAX(version) FROM changes WHERE drawing_id = $1 AND command = ANY($4::text[])), 0)
     ORDER BY version`,
    [drawingId, actorKey, NOT_UNDOABLE, REPLACEMENTS]);
  const done: number[] = [];
  const undone: number[] = [];
  for (const row of rows) {
    if (row.command === 'UNDO') {
      const top = done.pop();
      if (top !== undefined) undone.push(top);
    } else if (row.command === 'REDO') {
      const top = undone.pop();
      if (top !== undefined) done.push(top);
    } else {
      done.push(row.version);
      undone.length = 0;
    }
  }
  return { done, undone };
}

/** What UNDO or REDO would do for this actor, or null when there is nothing to undo or redo. */
export async function planUndoRedo(client: Queryable, drawingId: string, actorKey: string, kind: 'UNDO' | 'REDO'): Promise<UndoRedoPlan | null> {
  const stacks = await undoRedoStacks(client, drawingId, actorKey);
  const version = (kind === 'UNDO' ? stacks.done : stacks.undone).at(-1);
  if (version === undefined) return null;
  const { rows } = await client.query<ChangeRecord>(
    'SELECT command, created, modified, erased, before, after FROM changes WHERE drawing_id = $1 AND version = $2', [drawingId, version]);
  const target = rows[0];
  if (!target) return null;
  if (kind === 'UNDO') {
    return {
      command: target.command,
      record: { created: target.erased, modified: target.modified, erased: target.created, before: target.after, after: target.before },
    };
  }
  return {
    command: target.command,
    record: { created: target.created, modified: target.modified, erased: target.erased, before: target.before, after: target.after },
  };
}
