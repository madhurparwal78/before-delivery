import type { FieldChange, FieldState, FieldValue, RecordKind } from "../shared/sync.ts";

const isBothKeptField = (kind: RecordKind, name: string): boolean =>
  (kind === "block" && name === "text") ||
  (kind === "note" && name === "text") ||
  (kind === "document" && name === "title") ||
  (kind === "row" && name.startsWith("cell:"));

const asText = (value: FieldValue): string => (value === null ? "" : String(value));

/** Keep order: alphabetical ignoring case, then by exact text, so every device shows the same order. */
function keepOrder(values: FieldValue[]): FieldValue[] {
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const distinct = [...new Map(values.map((value) => [asText(value), value])).entries()];
  return distinct
    .sort(([a], [b]) => compare(a.toLowerCase(), b.toLowerCase()) || compare(a, b))
    .map(([, value]) => value);
}

/** Decides what one offered field becomes on the account. Answers the current state when nothing changes. */
function mergeField(kind: RecordKind, name: string, current: FieldState | undefined, change: FieldChange, device: string): FieldState {
  if (!current) return { value: change.value, version: Math.max(change.base, 0) + 1, device };
  const next = (value: FieldValue): FieldState => ({ value, version: current.version + 1, device });
  if (change.mode === "create") return current;
  if (change.mode === "slot") return current.value === null ? next(change.value) : current;
  if (change.mode === "pick") return current.bothKept ? next(change.value) : current;
  if (!isBothKeptField(kind, name)) return next(change.value);
  if (current.bothKept) {
    return current.bothKept.includes(change.value) ? current : holdBoth(current, [...current.bothKept, change.value], device);
  }
  if (change.base >= current.version || current.device === device) return next(change.value);
  return current.value === change.value ? current : holdBoth(current, [current.value, change.value], device);
}

function holdBoth(current: FieldState, values: FieldValue[], device: string): FieldState {
  const bothKept = keepOrder(values) as [FieldValue, ...FieldValue[]];
  return { value: bothKept[0], version: current.version + 1, device, bothKept };
}

const TEXT_FIELD = "text";
const DELETED_FIELD = "deleted";

/** Merges offered fields into a stored record; a block deleted elsewhere comes back with an edit made without seeing the delete. */
export function mergeRecord(
  kind: RecordKind,
  stored: Record<string, FieldState>,
  fields: Record<string, FieldChange>,
  device: string,
): { fields: Record<string, FieldState>; changed: boolean } {
  const merged = { ...stored };
  let changed = false;
  for (const [name, change] of Object.entries(fields)) {
    const current = merged[name];
    if (name === DELETED_FIELD && change.value === true && (merged[TEXT_FIELD]?.version ?? 0) > change.base) continue;
    const next = mergeField(kind, name, current, change, device);
    if (next !== current) {
      merged[name] = next;
      changed = true;
    }
  }
  const text = fields[TEXT_FIELD];
  const deleted = merged[DELETED_FIELD];
  if (kind === "block" && text?.mode === "edit" && deleted?.value === true && !fields[DELETED_FIELD]) {
    merged[DELETED_FIELD] = { value: false, version: deleted.version + 1, device };
    changed = true;
  }
  return { fields: merged, changed };
}
