import type pg from 'pg';
import { normalise, sameState } from '../shared/grid.js';
import { NOTHING_TO_REDO_MESSAGE, NOTHING_TO_UNDO_MESSAGE, REDONE, UNDONE, UNKNOWN_BASE_MESSAGE, conflictNotice, noVersion, restoredFrom } from '../shared/messages.js';
import type { Change, LayoutContent, LayoutState } from '../shared/types.js';
import { inTransaction } from './db.js';
import { meets, targetOf, type Target } from './domain/conflicts.js';
import { applyChange, restoreVersion, type Edit } from './domain/edits.js';
import { applyPatch, type Patch } from './domain/patch.js';
import type { PreparedChange } from './domain/prepare.js';
import { Refusal } from './domain/refusal.js';
import { limits } from './config.js';
import { contentOf, insertVersion, type LayoutRow } from './store.js';

type Outcome =
  | { kind: 'applied'; content: LayoutContent; announcement: string; restored: number | null; author: string }
  | { kind: 'unchanged'; revision: number }
  | { kind: 'conflict'; content: LayoutContent; message: string };

interface HistoryRow {
  revision: number;
  kind: string;
  target: Target;
  label: string;
  inverse: Patch;
}

/** The designer's own rows replayed: a change pushes, an undo moves the top to redo, a redo moves it back. */
async function historyOf(client: pg.PoolClient, layoutId: string, author: string): Promise<{ undo: HistoryRow[]; redo: HistoryRow[] }> {
  const { rows } = await client.query<HistoryRow>('SELECT revision, kind, target, label, inverse FROM changes WHERE layout_id = $1 AND author = $2 ORDER BY revision', [layoutId, author]);
  const undo: HistoryRow[] = [];
  const redo: HistoryRow[] = [];
  for (const row of rows) {
    if (row.kind === 'undo') {
      undo.pop();
      redo.push(row);
    } else if (row.kind === 'redo') {
      redo.pop();
      undo.push(row);
    } else {
      undo.push(row);
      redo.length = 0;
    }
  }
  return { undo, redo };
}

async function firstConflict(client: pg.PoolClient, layoutId: string, author: string, since: number, candidate: Target): Promise<{ author: string; label: string } | undefined> {
  const { rows } = await client.query<{ author: string; target: Target; label: string }>(
    'SELECT author, target, label FROM changes WHERE layout_id = $1 AND revision > $2 AND author <> $3 ORDER BY revision',
    [layoutId, since, author],
  );
  return rows.find((row) => meets(candidate, row.target));
}

type Decision = (Edit & { target: Target }) | { conflict: { author: string; label: string } };

/** The saved version's state; a missing version is the published refusal. */
async function savedVersion(client: pg.PoolClient, layoutId: string, number: number): Promise<LayoutState> {
  const { rows } = await client.query<{ state: LayoutState }>('SELECT state FROM versions WHERE layout_id = $1 AND number = $2', [layoutId, number]);
  if (!rows[0]) throw new Refusal(noVersion(number));
  return rows[0].state;
}

/** Decide a change against the layout as it stands: the edit it makes, or the conflict that refuses it. */
async function decide(client: pg.PoolClient, row: LayoutRow, author: string, baseRevision: number, change: PreparedChange): Promise<Decision> {
  if (change.kind === 'undo' || change.kind === 'redo') {
    const { undo, redo } = await historyOf(client, row.id, author);
    const top = (change.kind === 'undo' ? undo : redo).at(-1);
    if (!top) throw new Refusal(change.kind === 'undo' ? NOTHING_TO_UNDO_MESSAGE : NOTHING_TO_REDO_MESSAGE);
    const conflict = await firstConflict(client, row.id, author, top.revision, top.target);
    if (conflict) return { conflict };
    const applied = applyPatch(row.state, top.inverse);
    return { state: applied.state, announcement: change.kind === 'undo' ? UNDONE : REDONE, inverse: applied.inverse, target: top.target, label: top.label, restored: null };
  }
  const target = targetOf(change, row.state);
  const conflict = await firstConflict(client, row.id, author, baseRevision, target);
  if (conflict) return { conflict };
  if (change.kind === 'restore_version') return { ...restoreVersion(row.state, change.number, await savedVersion(client, row.id, change.number)), target };
  return { ...applyChange(row.state, change, limits), target };
}

/** What the change log keeps of a change: the CSS text, not the state it was read into. */
const logged = (change: PreparedChange): Change => (change.kind === 'apply_css' ? { kind: change.kind, css: change.css } : change);

/**
 * Apply one change to a layout under its row lock, in server arrival order. A change with no effect is
 * not written; a stale change that meets another designer's later change is refused as a conflict.
 */
export function submitChange(layoutId: string, author: string, baseRevision: number, change: PreparedChange): Promise<Outcome> {
  return inTransaction(async (client) => {
    const { rows } = await client.query<LayoutRow>('SELECT id, name, revision, state FROM layouts WHERE id = $1 FOR UPDATE', [layoutId]);
    const row = rows[0];
    if (baseRevision > row.revision) throw new Refusal(UNKNOWN_BASE_MESSAGE);
    const decision = await decide(client, row, author, baseRevision, change);
    if ('conflict' in decision) {
      return { kind: 'conflict', content: contentOf(row.revision, row.state), message: conflictNotice(decision.conflict.author, decision.conflict.label) };
    }
    if (sameState(decision.state, row.state)) return { kind: 'unchanged', revision: row.revision };
    const revision = row.revision + 1;
    const state = contentOf(revision, decision.state);
    await client.query('INSERT INTO changes (layout_id, revision, author, kind, change, target, label, inverse) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
      row.id, revision, author, change.kind, logged(change), decision.target, decision.label, decision.inverse,
    ]);
    await client.query('UPDATE layouts SET revision = $2, state = $3 WHERE id = $1', [row.id, revision, normalise(decision.state)]);
    if (decision.restored !== null) await insertVersion(client, row.id, restoredFrom(decision.restored), revision, decision.state);
    return { kind: 'applied', content: state, announcement: decision.announcement, restored: decision.restored, author };
  });
}
