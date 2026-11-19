import { combinedFiles } from './combined.js';
import { byteOrder, type Snapshot } from './revisions.js';

export type ApplyResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; conflicts: string[] };

/**
 * The file-level apply rule: a change applies onto a newer revision when none of the paths of its
 * combined diff was changed there, or was changed there to exactly the change's head content.
 */
export function applyChangeOnto(base: Snapshot, head: Snapshot, target: Snapshot): ApplyResult {
  const changed = combinedFiles(base, head);
  const conflicts: string[] = [];
  for (const file of changed) {
    const targetKey = target.get(file.path)?.contentKey ?? null;
    if (targetKey === file.baseKey) continue;
    if (targetKey === file.headKey) continue;
    conflicts.push(file.path);
  }
  if (conflicts.length > 0) return { ok: false, conflicts: conflicts.sort(byteOrder) };

  const snapshot: Snapshot = new Map(target);
  for (const file of changed) {
    if (file.headKey === null) {
      snapshot.delete(file.path);
    } else {
      snapshot.set(file.path, head.get(file.path)!);
    }
  }
  return { ok: true, snapshot };
}
