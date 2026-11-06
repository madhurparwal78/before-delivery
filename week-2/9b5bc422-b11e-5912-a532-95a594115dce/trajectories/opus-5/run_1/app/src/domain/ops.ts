import type { EntityKind, Op } from './types.ts';

export function uuid(): string {
  return crypto.randomUUID();
}

/** Seeded and journal records carry the same op id on every device, so none is doubled. */
export function fixedOpId(entity: EntityKind, entityId: string, field: string): string {
  return `s/${entity}/${entityId}/${field}`;
}

export type OpDraft = {
  entity: EntityKind;
  entityId: string;
  field: string;
  value: unknown;
  documentId?: string;
  parents?: string[];
  seed?: boolean;
  slot?: boolean;
  content?: boolean;
  id?: string;
  at?: string;
};

export function buildOp(draft: OpDraft, deviceId: string): Op {
  const op: Op = {
    id: draft.id ?? uuid(),
    deviceId,
    entity: draft.entity,
    entityId: draft.entityId,
    field: draft.field,
    value: draft.value,
    at: draft.at ?? new Date().toISOString(),
  };
  if (draft.documentId) op.documentId = draft.documentId;
  if (draft.parents) op.parents = draft.parents;
  if (draft.seed) op.seed = true;
  if (draft.slot) op.slot = true;
  if (draft.content) op.content = true;
  return op;
}
