import { randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { ApiError } from '../shared/errors.ts';
import { applyRestore, findSuperseded, restoreCommand, type Change, type RestoreDirection } from '../shared/model/index.ts';
import { config } from './config.ts';
import { db, type Queryable } from './db.ts';
import type { DrawingRuntime } from './drawings.ts';

/** One group a person can undo (or, once undone, redo): what it changed, net per target. `revision` is the drawing revision after it. */
export interface UndoEntry { id: number; revision: number; command: string; changes: Change[] }
export interface Stacks { undo: UndoEntry[]; redo: UndoEntry[] }

const opposite = (direction: RestoreDirection): RestoreDirection => (direction === 'undo' ? 'redo' : 'undo');

interface StoredEntry { id: number; direction: RestoreDirection; revision: number; command: string; changes: Change[] }

/**
 * Each person's undo and redo stacks on one drawing. They live in PostgreSQL and are read once per person; the `persist…` methods
 * write inside the transaction of the group being committed and return the stacks to install once it has committed.
 */
export class UndoStacks {
  private readonly loaded = new Map<string, Stacks>();

  constructor(private readonly drawingId: string) {}

  async of(username: string): Promise<Stacks> {
    const known = this.loaded.get(username);
    if (known) return known;
    const rows = await db.query<StoredEntry>(
      'SELECT id, direction, revision, command, changes FROM undo_entries WHERE drawing_id = $1 AND username = $2 ORDER BY id',
      [this.drawingId, username],
    );
    const stacks: Stacks = { undo: rows.filter((row) => row.direction === 'undo'), redo: rows.filter((row) => row.direction === 'redo') };
    this.loaded.set(username, stacks);
    return stacks;
  }

  install(username: string, stacks: Stacks): void {
    this.loaded.set(username, stacks);
  }

  /** A new group by the person: it goes on the undo stack (the oldest beyond PLOT_UNDO_DEPTH falls off) and their redo stack clears. */
  async persistNewGroup(q: Queryable, username: string, group: Omit<UndoEntry, 'id'>): Promise<Stacks> {
    const stacks = await this.of(username);
    const entry = await this.insert(q, username, 'undo', group);
    await q.query("DELETE FROM undo_entries WHERE drawing_id = $1 AND username = $2 AND direction = 'redo'", [this.drawingId, username]);
    const undo = [...stacks.undo, entry];
    const fallen = undo.splice(0, Math.max(0, undo.length - config.undoDepth));
    if (fallen.length > 0) await q.query('DELETE FROM undo_entries WHERE id = ANY($1::bigint[])', [fallen.map((old) => old.id)]);
    return { undo, redo: [] };
  }

  /** The person reversed `entry` in `direction`; at `revision` it becomes the newest entry of the opposite stack. */
  async persistReversal(q: Queryable, username: string, direction: RestoreDirection, entry: UndoEntry, revision: number): Promise<Stacks> {
    const stacks = await this.of(username);
    await q.query('DELETE FROM undo_entries WHERE id = $1', [entry.id]);
    const moved = await this.insert(q, username, opposite(direction), { revision, command: entry.command, changes: entry.changes });
    const remaining = stacks[direction].filter((other) => other.id !== entry.id);
    return direction === 'undo'
      ? { undo: remaining, redo: [...stacks.redo, moved] }
      : { undo: [...stacks.undo, moved], redo: remaining };
  }

  /** Throws away an entry that can no longer be applied. */
  async drop(username: string, direction: RestoreDirection, entry: UndoEntry): Promise<void> {
    await db.query('DELETE FROM undo_entries WHERE id = $1', [entry.id]);
    const stacks = await this.of(username);
    this.install(username, { ...stacks, [direction]: stacks[direction].filter((other) => other.id !== entry.id) });
  }

  private async insert(q: Queryable, username: string, direction: RestoreDirection, group: Omit<UndoEntry, 'id'>): Promise<UndoEntry> {
    const rows = await q.query<{ id: string }>(
      `INSERT INTO undo_entries (drawing_id, username, direction, revision, command, changes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [this.drawingId, username, direction, group.revision, group.command, JSON.stringify(group.changes)],
    );
    return { id: Number(rows[0].id), ...group };
  }
}

/**
 * Undo or redo the person's newest entry as a new group. When someone else changed a target of the group since, the entry is dropped
 * and `undo_superseded` names who and what. Must run inside the drawing's queue.
 */
export async function reverseGroup(runtime: DrawingRuntime, username: string, direction: RestoreDirection): Promise<{ revision: number; command: string }> {
  const stacks = await runtime.undoStacks.of(username);
  const entry = stacks[direction].at(-1);
  if (!entry) {
    throw direction === 'undo'
      ? new ApiError('nothing_to_undo', copy.NOTHING_TO_UNDO)
      : new ApiError('nothing_to_redo', copy.NOTHING_TO_REDO);
  }
  const superseded = findSuperseded(entry.changes, username, entry.revision, runtime.conflicts);
  if (superseded) {
    await runtime.undoStacks.drop(username, direction, entry);
    throw new ApiError('undo_superseded', copy.undoSuperseded(superseded.user, superseded.target));
  }
  const outcome = applyRestore(runtime.state, entry.changes, direction, { username, conflicts: runtime.conflicts });
  const revision = await runtime.commit({
    username, outcome, stack: { reverse: direction, entry }, undone: entry.command,
    group: { group_id: randomUUID(), base_revision: runtime.state.revision, command: restoreCommand(direction), ops: [] },
  });
  return { revision: revision.revision, command: entry.command };
}
