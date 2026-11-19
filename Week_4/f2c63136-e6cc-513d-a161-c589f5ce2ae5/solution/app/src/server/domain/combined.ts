import { createHash } from 'node:crypto';
import { byteOrder } from './validate.ts';
import type { Snap } from './revisions.ts';

export interface ChangedPath {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  baseSha: string | null;
  headSha: string | null;
}

/** The combined diff: every path whose content differs between the base and the head revision. */
export function combinedDiff(base: Snap, head: Snap): ChangedPath[] {
  const paths = [...new Set([...base.keys(), ...head.keys()])].sort(byteOrder);
  const changed: ChangedPath[] = [];
  for (const path of paths) {
    const baseSha = base.get(path)?.sha ?? null;
    const headSha = head.get(path)?.sha ?? null;
    if (baseSha === headSha) continue;
    changed.push({ path, status: baseSha === null ? 'added' : headSha === null ? 'deleted' : 'modified', baseSha, headSha });
  }
  return changed;
}

/** Two combined diffs are identical when paths, statuses and both texts agree. */
export function diffHash(changed: ChangedPath[]): string {
  return createHash('sha256').update(JSON.stringify(changed.map((c) => [c.path, c.status, c.baseSha, c.headSha]))).digest('hex');
}

type Applied = { ok: true; snap: Snap } | { ok: false; conflicts: string[] };

/**
 * The file-level apply rule (merging, restacking and the merge queue): the change applies onto a
 * newer revision when none of its paths changed there, or changed to exactly the change's content.
 */
export function applyChange(base: Snap, head: Snap, onto: Snap): Applied {
  const conflicts: string[] = [];
  const result: Snap = new Map(onto);
  for (const file of combinedDiff(base, head)) {
    const current = onto.get(file.path)?.sha ?? null;
    if (current !== file.baseSha && current !== file.headSha) conflicts.push(file.path);
    const next = head.get(file.path);
    if (next) result.set(file.path, next);
    else result.delete(file.path);
  }
  return conflicts.length ? { ok: false, conflicts } : { ok: true, snap: result };
}
