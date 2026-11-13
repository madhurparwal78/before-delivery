import type { SceneObject, ObjectKind } from './scene';
import { KIND_SPECS } from './scene';

export type Op =
  | { op: 'add'; object: SceneObject }
  | { op: 'set'; objectId: string; fence: number; field: string; value: unknown }
  | { op: 'remove'; objectId: string; fence: number }
  | { op: 'scene'; field: 'name' | 'gravity'; value: unknown };

export type FieldKey = string;

export function objectFieldKeys(object: SceneObject): FieldKey[] {
  const keys: FieldKey[] = [`${object.id}.name`, `${object.id}.position`, `${object.id}.rotation`, `${object.id}.scale`];
  for (const param of Object.keys(object.params)) keys.push(`${object.id}.params.${param}`);
  return keys;
}

export function opFieldKeys(op: Op, object?: SceneObject): FieldKey[] {
  switch (op.op) {
    case 'set':
      if (op.field.startsWith('params.')) return [`${op.objectId}.params.${op.field.slice('params.'.length)}`];
      return [`${op.objectId}.${op.field}`];
    case 'scene':
      return [`scene.${op.field}`];
    case 'add':
      return object ? objectFieldKeys(object) : [];
    case 'remove':
      return object ? objectFieldKeys(object) : [];
  }
}

export type RevisionFootprint = { keys: Set<FieldKey>; removedObjectIds: Set<string>; revision: number };

export type ConflictResult = { conflict: true; conflicts: FieldKey[] } | { conflict: false };

export function checkRevisionConflict(
  baseRevision: number,
  currentRevision: number,
  myKeys: Set<FieldKey>,
  myRemovedObjectIds: Set<string>,
  footprints: RevisionFootprint[],
  restoreRevision: number | null,
): ConflictResult {
  // Restore barrier: any PATCH based before the latest restore loses.
  if (restoreRevision !== null && baseRevision < restoreRevision) {
    return { conflict: true, conflicts: [...myKeys] };
  }
  const conflicts = new Set<FieldKey>();
  for (const fp of footprints) {
    if (fp.revision <= baseRevision) continue;
    for (const key of myKeys) {
      if (fp.keys.has(key)) conflicts.add(key);
    }
    for (const removed of myRemovedObjectIds) {
      if (fp.removedObjectIds.has(removed)) {
        for (const k of objectKeyPrefixes(removed)) conflicts.add(k);
      }
    }
    // a revision that removed an object kills writes to its fields
    for (const key of myKeys) {
      const id = key.split('.')[0] ?? '';
      if (fp.removedObjectIds.has(id)) conflicts.add(key);
    }
    // an added object with the same id as my write target
  }
  if (conflicts.size > 0) return { conflict: true, conflicts: [...conflicts].sort() };
  return { conflict: false };
}

function objectKeyPrefixes(objectId: string): FieldKey[] {
  return [
    `${objectId}.name`,
    `${objectId}.position`,
    `${objectId}.rotation`,
    `${objectId}.scale`,
    `${objectId}.params`,
  ];
}

export function fieldKeysForObjectRemoval(objectId: string): FieldKey[] {
  return objectKeyPrefixes(objectId);
}

export function paramSpecFor(kind: ObjectKind, param: string) {
  return KIND_SPECS[kind].params.find((p) => p.key === param);
}
