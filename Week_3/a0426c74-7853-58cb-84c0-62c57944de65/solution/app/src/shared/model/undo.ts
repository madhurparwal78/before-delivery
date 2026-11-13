// Per-person undo and redo: restoring recorded changes, and finding out whether someone else has changed what a group touched.
import type { DrawingState } from '../types.ts';
import { Context } from './context.ts';
import { deriveDependants } from './derive.ts';
import { conclude } from './engine.ts';
import type { Change, ConflictProbe, EngineEnv, GroupOutcome, TargetChange, TargetKind, TargetValue } from './index.ts';
import type { Table } from './workspace.ts';

export type RestoreDirection = 'undo' | 'redo';

/** The command a restore group is logged under. */
export const restoreCommand = (direction: RestoreDirection): string => direction.toUpperCase();

function restoreTarget<K extends TargetKind>(table: Table<TargetValue[K]>, change: TargetChange<K>, direction: RestoreDirection): void {
  const value = direction === 'undo' ? change.before : change.after;
  if (value === null) table.delete(change.key);
  else table.set(change.key, value);
}

/** Restores every `before` (undo) or `after` (redo) as one synthetic op, then lets associative dimensions and hatches follow the geometry. */
export function applyRestore(state: DrawingState, changes: readonly Change[], direction: RestoreDirection, env: EngineEnv): GroupOutcome {
  const ctx = new Context(state, env, state.revision, restoreCommand(direction));
  const { ws } = ctx;
  for (const change of changes) {
    switch (change.kind) {
      case 'entity': restoreTarget(ws.entities, change, direction); break;
      case 'layer': restoreTarget(ws.layers, change, direction); break;
      case 'block': restoreTarget(ws.blocks, change, direction); break;
      case 'dim_style': restoreTarget(ws.dimStyles, change, direction); break;
      case 'parameter': restoreTarget(ws.parameters, change, direction); break;
      case 'constraint': restoreTarget(ws.constraints, change, direction); break;
      case 'xref': restoreTarget(ws.xrefs, change, direction); break;
      case 'layer_state': restoreTarget(ws.layerStates, change, direction); break;
      case 'underlay': restoreTarget(ws.underlays, change, direction); break;
    }
  }
  deriveDependants(ctx);
  return conclude(ctx, [], state.revision + 1);
}

export function findSuperseded(changes: readonly Change[], user: string, sinceRevision: number, probe: ConflictProbe): { user: string; target: string } | null {
  for (const change of changes) {
    if (change.derived) continue;
    const other = probe.otherChangeSince(change.kind, change.key, user, sinceRevision);
    if (other) return { user: other.user, target: change.key };
  }
  return null;
}
