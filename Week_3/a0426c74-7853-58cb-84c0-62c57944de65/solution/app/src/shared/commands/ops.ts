// Turning geometry results into the specs of one operation group.
import type { ModifyResult } from '../geometry/index.ts';
import type { Entity, EntityDraft, Op, OperationGroup } from '../types.ts';
import type { CommandEnv } from './env.ts';
import type { OpSpec } from './stages.ts';

/** One command run as one operation group: every op gets its own id. */
export function groupOf(command: string, specs: readonly OpSpec[], env: CommandEnv): OperationGroup {
  const ops: Op[] = specs.map((spec) => ({ ...spec, op_id: env.newOpId() }));
  return { base_revision: env.state.revision, group_id: env.newOpId(), command, ops };
}

/** An entity as a new one: without its handle or author. Dimensions and hatches are recomputed when they are added. */
export function draftOf(entity: Entity): EntityDraft {
  const { handle, author, ...draft } = entity;
  return draft;
}

export const addOps = (drafts: readonly EntityDraft[]): OpSpec[] => drafts.map((entity) => ({ type: 'add', entity }));

/** What a modify command changed, without the announcement's count. */
export type Edits = Pick<ModifyResult, 'modified' | 'added' | 'removed'>;

/** A modify command's result as ops: the changed fields, then the new entities in creation order, then the deletions. */
export function opsOfResult(result: Edits): OpSpec[] {
  return [
    ...result.modified.map((edit): OpSpec => ({ type: 'modify', handle: edit.handle, set: edit.set })),
    ...addOps(result.added),
    ...(result.removed.length > 0 ? [{ type: 'delete', handles: result.removed } satisfies OpSpec] : []),
  ];
}

/** The model entity behind a picked handle. */
export const modelEntity = (env: CommandEnv, handle: string): Entity => env.state.entities[handle];

/** A record entry by exact name; `undefined` for a name the record does not hold (never an inherited property). */
export const named = <T>(record: Readonly<Record<string, T>>, name: string): T | undefined => (Object.hasOwn(record, name) ? record[name] : undefined);
