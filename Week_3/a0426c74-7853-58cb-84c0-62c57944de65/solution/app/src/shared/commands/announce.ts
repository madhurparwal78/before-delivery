// Drawing announcements (Feedback states) for this person's own groups and for other people's groups.
import * as copy from '../copy.ts';
import type { DrawingState, Op, OperationGroup, OpResult } from '../types.ts';

type OpOf<T extends Op['type']> = Extract<Op, { type: T }>;

const ofType = <T extends Op['type']>(ops: readonly Op[], type: T): OpOf<T>[] =>
  ops.filter((op): op is OpOf<T> => op.type === type);

const handleCount = (ops: readonly Op[], type: 'move' | 'delete'): number =>
  ofType(ops, type).reduce((sum, op) => sum + op.handles.length, 0);

/** `<Kind> <handle> added` for one new entity, `<n> entities added` for several. */
function addedSentence(group: OperationGroup, results: readonly OpResult[]): string | null {
  const added = group.ops.flatMap((op, i) => (op.type === 'add' && results[i].handles.length > 0 ? [{ type: op.entity.type, handle: results[i].handles[0] }] : []));
  if (added.length === 0) return null;
  return added.length === 1 ? copy.kindAdded(added[0].type, added[0].handle) : copy.entitiesAdded(added.length);
}

function explodeSentence(group: OperationGroup, results: readonly OpResult[]): string | null {
  const exploded = group.ops.flatMap((op, i) => (op.type === 'explode' ? [{ handle: op.handle, made: results[i].handles.length }] : []));
  if (exploded.length === 0) return null;
  return exploded.length === 1 ? copy.exploded(exploded[0].handle, exploded[0].made) : copy.entitiesAdded(exploded.reduce((sum, e) => sum + e.made, 0));
}

/**
 * What the person who ran `group` hears once it was applied. `before` is the state the group was made against (BLOCK says
 * redefined when the name already had a definition). Null when the brief prints no announcement for the command.
 * The counts follow the brief: Trim, Fillet and Chamfer count each entity the run modified once plus each entity it added (a circle
 * replaced by its arc is one delete and one add, so it counts once).
 */
export function ownAnnouncement(group: OperationGroup, results: readonly OpResult[], before: DrawingState): string | null {
  const { ops } = group;
  const adds = ofType(ops, 'add').length;
  const modifies = ofType(ops, 'modify').length;
  switch (group.command) {
    case 'LINE': case 'PLINE': case 'RECT': case 'CIRCLE': case 'ARC': case 'HATCH': case 'INSERT':
    case 'DIMLINEAR': case 'DIMALIGNED': case 'DIMANGLE': case 'DIMRADIUS':
      return addedSentence(group, results);
    case 'MOVE': case 'NUDGE': return copy.modifyDone(copy.MODIFY_VERB.MOVE, handleCount(ops, 'move'));
    case 'COPY': return copy.modifyDone(copy.MODIFY_VERB.COPY, adds);
    case 'ROTATE': return copy.modifyDone(copy.MODIFY_VERB.ROTATE, modifies);
    case 'SCALE': return copy.modifyDone(copy.MODIFY_VERB.SCALE, modifies);
    case 'MIRROR': return copy.modifyDone(copy.MODIFY_VERB.MIRROR, adds);
    case 'ERASE': return copy.modifyDone(copy.MODIFY_VERB.ERASE, handleCount(ops, 'delete'));
    case 'ARRAY': return copy.arrayed(adds);
    case 'TRIM': return copy.trimmed(modifies + adds);
    case 'EXTEND': return copy.extended(modifies);
    case 'FILLET': return copy.filleted(modifies + adds);
    case 'CHAMFER': return copy.chamfered(modifies + adds);
    case 'OFFSET': return copy.offsetAdded(adds);
    case 'EXPLODE': return explodeSentence(group, results);
    case 'BLOCK': {
      const [define] = ofType(ops, 'block_define');
      if (!define) return null;
      return before.blocks[define.name] ? copy.blockRedefined(define.name) : copy.blockDefined(define.name);
    }
    default: return null;
  }
}

/**
 * What everyone else hears when `username` applied `ops`: `<user> moved <handle>` for a move of one entity, otherwise
 * `<user> changed <n> entities` where n counts the entities the explicit ops touched (adds, modifies, deletes, moves),
 * not the dimensions and hatches that were recomputed. Null when the ops touched no entity (a layer or parameter edit).
 */
export function remoteAnnouncement(username: string, ops: readonly Op[]): string | null {
  const touched = new Set<string>();
  for (const op of ops) {
    if (op.type === 'modify') touched.add(op.handle);
    if (op.type === 'move' || op.type === 'delete') op.handles.forEach((handle) => touched.add(handle));
  }
  const count = touched.size + ofType(ops, 'add').length;
  if (count === 0) return null;
  const [only] = ops;
  if (ops.length === 1 && only.type === 'move' && only.handles.length === 1) return copy.otherMoved(username, only.handles[0]);
  return copy.otherChanged(username, count);
}
