// applyGroup: the one place where a group of operations is decided. All ops apply in order on a copy-on-write workspace, then constraints
// are solved and dimensions and hatches follow the geometry; any refusal throws and nothing of the group is kept.
import * as copy from '../copy.ts';
import { invalid } from '../errors.ts';
import type { DrawingState, Entity, Op, OpResult, OperationGroup } from '../types.ts';
import { constraintAddOp, constraintDeleteOp, parameterDeleteOp, parameterSetOp, settleConstraints } from './constraintops.ts';
import { Context } from './context.ts';
import type { OpOutcome } from './context.ts';
import { deriveDependants, inheritFollowers } from './derive.ts';
import { dimStyleSetOp } from './dimstyle.ts';
import { addOp, deleteOp, modifyOp, moveOp } from './entityops.ts';
import { blockDefineOp, explodeOp, purgeOp } from './blockops.ts';
import { layerAddOp, layerDeleteOp, layerSetOp, layerStateRestoreOp, layerStateSaveOp } from './layerops.ts';
import { importMergeOp, versionRestoreOp } from './restoreops.ts';
import { makePatch } from './patch.ts';
import { xrefAttachOp, xrefBindOp, xrefClipOp, xrefReloadOp } from './xrefops.ts';
import type { EngineEnv, GroupOutcome } from './index.ts';

function runOp(ctx: Context, op: Op): OpOutcome {
  switch (op.type) {
    case 'add': return addOp(ctx, op);
    case 'modify': return modifyOp(ctx, op);
    case 'move': return moveOp(ctx, op);
    case 'delete': return deleteOp(ctx, op);
    case 'layer_add': return layerAddOp(ctx, op);
    case 'layer_set': return layerSetOp(ctx, op);
    case 'layer_delete': return layerDeleteOp(ctx, op);
    case 'layer_state_save': return layerStateSaveOp(ctx, op);
    case 'layer_state_restore': return layerStateRestoreOp(ctx, op);
    case 'block_define': return blockDefineOp(ctx, op);
    case 'explode': return explodeOp(ctx, op);
    case 'purge': return purgeOp(ctx);
    case 'dim_style_set': return dimStyleSetOp(ctx, op);
    case 'constraint_add': return constraintAddOp(ctx, op);
    case 'constraint_delete': return constraintDeleteOp(ctx, op);
    case 'parameter_set': return parameterSetOp(ctx, op);
    case 'parameter_delete': return parameterDeleteOp(ctx, op);
    case 'xref_attach': return xrefAttachOp(ctx, op);
    case 'xref_clip': return xrefClipOp(ctx, op);
    case 'xref_reload': return xrefReloadOp(ctx, op);
    case 'xref_bind': return xrefBindOp(ctx, op);
    case 'version_restore': return versionRestoreOp(ctx, op);
    case 'import_merge': return importMergeOp(ctx, op);
  }
}

/** Ops that need data only the server holds: an xref's source model, a version's model, a stored import. */
export function isServerOnlyOp(op: Op): boolean {
  return op.type === 'xref_attach' || op.type === 'xref_reload' || op.type === 'version_restore' || op.type === 'import_merge';
}

/** Ends an application: the new state at `revision`, the net changes and the patch that carries them. */
export function conclude(ctx: Context, results: OpResult[], revision: number): GroupOutcome {
  const state: DrawingState = ctx.ws.state(revision);
  inheritFollowers(ctx.ws.origin.entities, state.entities, [...ctx.ws.entities.touched.keys()].map((key): [string, Entity | null] => [key, ctx.ws.entities.get(key) ?? null]));
  const changes = ctx.ws.changes(ctx.derived);
  return { state, results, changes, notices: ctx.notices, patch: makePatch(state, changes), purged: ctx.purged };
}

/** True when a number anywhere inside the value is infinite or not a number, as when a coordinate is so large that rounding or adding overflows. */
function holdsNonFinite(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).some(holdsNonFinite);
}

export function applyGroup(state: DrawingState, group: OperationGroup, env: EngineEnv): GroupOutcome {
  const ctx = new Context(state, env, group.base_revision, group.command);
  const results = group.ops.map((op): OpResult => {
    const { status, handles, message } = runOp(ctx, op);
    return { op_id: op.op_id, status, handles, message: message ?? null };
  });
  settleConstraints(ctx, group.ops);
  deriveDependants(ctx);
  const outcome = conclude(ctx, results, state.revision + group.ops.length);
  // JSON and PostgreSQL cannot hold such a number: the whole group is refused rather than stored as null
  if (outcome.changes.some((change) => holdsNonFinite(change.after))) throw invalid(copy.NUMBER_TOO_LARGE);
  return outcome;
}
