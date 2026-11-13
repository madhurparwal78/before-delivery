import type { OperationGroup } from '../../shared/types.ts';
import type { OpInput } from './types.ts';

/** One operation group of `command` on `baseRevision`: the group and every operation get a fresh id. */
export function operationGroup(command: string, ops: readonly OpInput[], baseRevision: number, newId: () => string): OperationGroup {
  return { base_revision: baseRevision, group_id: newId(), command, ops: ops.map((op) => ({ ...op, op_id: newId() })) };
}
