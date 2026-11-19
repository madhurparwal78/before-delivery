import type { PoolClient } from 'pg';
import { applyChange, checkChangeValues, invertChange } from '../shared/changes.js';
import { targetsIntersect, targetsOf, type TargetSet } from '../shared/conflict.js';
import { generateCss, generateHtml } from '../shared/generate.js';
import { statesEqual } from '../shared/grid.js';
import {
  NOTHING_TO_REDO_MESSAGE,
  NOTHING_TO_UNDO_MESSAGE,
  UNKNOWN_BASE_REVISION_MESSAGE,
} from '../shared/messages.js';
import type { Change, LayoutObject, LayoutState, Role } from '../shared/types.js';
import { limits } from './config.js';
import { transaction } from './db.js';
import {
  insertVersion,
  lockLayout,
  nextVersionNumber,
  type LayoutRecord,
} from './store.js';

export function layoutObject(
  record: Pick<LayoutRecord, 'id' | 'name' | 'revision' | 'state'>,
  role: Role,
  live: boolean,
): LayoutObject {
  const state = record.state;
  return {
    id: record.id,
    name: record.name,
    role,
    revision: record.revision,
    columns: state.columns,
    rows: state.rows,
    gap: state.gap,
    areas: state.areas,
    breakpoints: state.breakpoints,
    live,
    css: generateCss(state),
    html: generateHtml(state),
  };
}

interface HistoryEntry {
  change: Change;
  before: LayoutState;
  revision: number;
  target: TargetSet;
}

interface History {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

/** Each designer has their own undo and redo history per layout, for as long as the server runs. */
const histories = new Map<string, History>();

function historyFor(layoutId: string, designerId: string): History {
  const key = `${layoutId}:${designerId}`;
  const found = histories.get(key);
  if (found) return found;
  const fresh: History = { undo: [], redo: [] };
  histories.set(key, fresh);
  return fresh;
}

export type ChangeResult =
  | { kind: 'applied'; revision: number; state: LayoutState; change: Change }
  | { kind: 'unchanged'; revision: number }
  | { kind: 'conflict'; revision: number; state: LayoutState; username: string; target: string }
  | { kind: 'invalid'; message: string };

interface LoggedChange {
  revision: number;
  username: string;
  target: TargetSet;
}

async function changesSince(
  client: PoolClient,
  layoutId: string,
  revision: number,
  designerId: string,
): Promise<LoggedChange[]> {
  const result = await client.query(
    `select c.revision, d.username, c.target
       from layout_changes c join designers d on d.id = c.author_id
      where c.layout_id = $1 and c.revision > $2 and c.author_id <> $3
      order by c.revision asc`,
    [layoutId, revision, designerId],
  );
  return result.rows as LoggedChange[];
}

/** Applies a change in server arrival order, refusing a stale change that touches a changed target. */
export async function applyLayoutChange(
  layoutId: string,
  designerId: string,
  baseRevision: number,
  change: Change,
): Promise<ChangeResult> {
  const valueProblem = checkChangeValues(change, limits);
  if (valueProblem) return { kind: 'invalid', message: valueProblem };

  return transaction(async (client) => {
    const layout = await lockLayout(client, layoutId);
    if (baseRevision > layout.revision) {
      return { kind: 'invalid', message: UNKNOWN_BASE_REVISION_MESSAGE };
    }

    const history = historyFor(layoutId, designerId);
    const stack = change.kind === 'undo' ? history.undo : history.redo;
    const entry = change.kind === 'undo' || change.kind === 'redo' ? stack[stack.length - 1] : undefined;
    if ((change.kind === 'undo' || change.kind === 'redo') && !entry) {
      return {
        kind: 'invalid',
        message: change.kind === 'undo' ? NOTHING_TO_UNDO_MESSAGE : NOTHING_TO_REDO_MESSAGE,
      };
    }

    const target = entry ? entry.target : targetsOf(change, layout.state);
    const measuredFrom = entry ? entry.revision - 1 : baseRevision;
    for (const logged of await changesSince(client, layoutId, measuredFrom, designerId)) {
      if (targetsIntersect(target, logged.target)) {
        return {
          kind: 'conflict',
          revision: layout.revision,
          state: layout.state,
          username: logged.username,
          target: target.name,
        };
      }
    }

    const versions = new Map<number, LayoutState>();
    if (change.kind === 'restore_version') {
      const result = await client.query('select number, state from versions where layout_id = $1', [layoutId]);
      for (const row of result.rows as { number: number; state: LayoutState }[]) {
        versions.set(row.number, row.state);
      }
    }

    let nextState: LayoutState;
    if (change.kind === 'undo' && entry) {
      nextState = invertChange(entry.change, entry.before, layout.state);
    } else if (change.kind === 'redo' && entry) {
      const applied = applyChange(entry.change, layout.state, {
        limits,
        version: (number) => versions.get(number) ?? null,
      });
      if (!applied.ok) return { kind: 'invalid', message: applied.message };
      nextState = applied.state;
    } else {
      const applied = applyChange(change, layout.state, {
        limits,
        version: (number) => versions.get(number) ?? null,
      });
      if (!applied.ok) return { kind: 'invalid', message: applied.message };
      nextState = applied.state;
    }

    if (statesEqual(nextState, layout.state)) {
      return { kind: 'unchanged', revision: layout.revision };
    }

    const revision = layout.revision + 1;
    await client.query('update layouts set state = $1, revision = $2 where id = $3', [
      JSON.stringify(nextState),
      revision,
      layoutId,
    ]);
    await client.query(
      'insert into layout_changes (layout_id, revision, author_id, change, target) values ($1, $2, $3, $4, $5)',
      [layoutId, revision, designerId, JSON.stringify(change), JSON.stringify(target)],
    );

    if (change.kind === 'restore_version') {
      const number = await nextVersionNumber(client, layoutId);
      await insertVersion(
        client,
        layoutId,
        number,
        `Restored from version ${change.number}`,
        revision,
        nextState,
      );
    }

    if (change.kind === 'undo' && entry) {
      history.undo.pop();
      history.redo.push({ ...entry, revision });
    } else if (change.kind === 'redo' && entry) {
      history.redo.pop();
      history.undo.push({ change: entry.change, before: layout.state, revision, target });
    } else {
      history.undo.push({ change, before: layout.state, revision, target });
      history.redo.length = 0;
    }

    return { kind: 'applied', revision, state: nextState, change };
  });
}
