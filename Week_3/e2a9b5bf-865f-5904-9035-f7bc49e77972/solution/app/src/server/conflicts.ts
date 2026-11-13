import type { Conflict, ConflictField } from "../shared/types";
import { isoSeconds } from "../shared/time";
import type { FieldMeta } from "./views";

export interface Incoming {
  field: ConflictField;
  value: unknown;
}

interface Edit {
  at: Date;
  device: string;
  baseVersion: number;
}

/**
 * Field-level conflict resolution: each field keeps the value with the latest edit time.
 * An equal or later edit applies; an older one from another device is reported `kept`;
 * applying over another device's value set after the change's base version is `replaced`.
 */
export function resolveFieldEdits(
  meta: FieldMeta,
  incoming: Incoming[],
  edit: Edit,
  newVersion: number,
): { applied: Incoming[]; meta: FieldMeta; conflicts: Conflict[] } {
  const applied: Incoming[] = [];
  const conflicts: Conflict[] = [];
  const next: FieldMeta = { ...meta };
  for (const item of incoming) {
    const current = meta[item.field];
    const currentAt = current ? new Date(current.at) : null;
    const foreign = current !== undefined && current.device !== edit.device;
    if (current && currentAt && edit.at.getTime() < currentAt.getTime()) {
      if (foreign) {
        conflicts.push({ field: item.field, outcome: "kept", other_device: current.device, other_edited_at: isoSeconds(currentAt) });
      }
      continue;
    }
    if (current && currentAt && foreign && current.version > edit.baseVersion) {
      conflicts.push({ field: item.field, outcome: "replaced", other_device: current.device, other_edited_at: isoSeconds(currentAt) });
    }
    applied.push(item);
    next[item.field] = { at: edit.at.toISOString(), device: edit.device, version: newVersion };
  }
  return { applied, meta: applied.length > 0 ? next : meta, conflicts };
}

/** True when another device set a field's current value after the version the deleter saw. */
export function editedSince(meta: FieldMeta, device: string, baseVersion: number): boolean {
  return Object.values(meta).some((m) => m !== undefined && m.device !== device && m.version > baseVersion);
}
