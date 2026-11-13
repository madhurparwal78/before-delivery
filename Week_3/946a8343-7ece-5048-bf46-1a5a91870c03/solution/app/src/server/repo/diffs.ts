// Changed files and line diffs between two snapshots.
import type { Queryable } from "../db.ts";
import { diffHunks, splitLines } from "../../shared/diff.ts";
import { compareUtf8 } from "../lib/objects.ts";
import { entriesOfCommit, readTexts } from "./store.ts";
import { sortedPaths, type Entries } from "./trees.ts";
import type { FileChange, FileDiff } from "./types.ts";

interface BlobChange extends FileChange {
  readonly oldBlob: string | null;
  readonly newBlob: string | null;
}

// Changed files, sorted by path, with a move recognised when a removed and an added path hold the identical blob.
function compareEntries(from: Entries, to: Entries): BlobChange[] {
  const added = sortedPaths(to).filter((path) => !from.has(path));
  const removed = sortedPaths(from).filter((path) => !to.has(path));
  const changes: BlobChange[] = [];
  const movedFrom = new Set<string>();
  for (const path of added) {
    const blob = to.get(path) ?? null;
    const source = removed.find((candidate) => !movedFrom.has(candidate) && from.get(candidate) === blob);
    if (source === undefined) {
      changes.push({ path, oldPath: null, status: "added", oldBlob: null, newBlob: blob });
    } else {
      movedFrom.add(source);
      changes.push({ path, oldPath: source, status: "moved", oldBlob: blob, newBlob: blob });
    }
  }
  for (const path of removed) {
    if (!movedFrom.has(path)) changes.push({ path, oldPath: null, status: "deleted", oldBlob: from.get(path) ?? null, newBlob: null });
  }
  for (const [path, blob] of to) {
    const before = from.get(path);
    if (before !== undefined && before !== blob) changes.push({ path, oldPath: null, status: "modified", oldBlob: before, newBlob: blob });
  }
  return changes.sort((a, b) => compareUtf8(a.path, b.path));
}

/** Changed files between two commits (`from` null = empty tree), sorted by path, with moves detected by identical blob. */
export async function changedFiles(q: Queryable, projectId: number, from: string | null, to: string): Promise<FileChange[]> {
  const changes = compareEntries(await entriesOfCommit(q, projectId, from), await entriesOfCommit(q, projectId, to));
  return changes.map(({ path, oldPath, status }) => ({ path, oldPath, status }));
}

async function diffEntries(q: Queryable, projectId: number, from: Entries, to: Entries): Promise<FileDiff[]> {
  const changes = compareEntries(from, to);
  const wanted: string[] = [];
  for (const change of changes) {
    if (change.status === "moved") continue;
    if (change.oldBlob !== null) wanted.push(change.oldBlob);
    if (change.newBlob !== null) wanted.push(change.newBlob);
  }
  const texts = await readTexts(q, projectId, wanted);
  const lines = (blob: string | null): string[] => (blob === null ? [] : splitLines(texts.get(blob) ?? ""));
  return changes.map((change) => ({
    path: change.path,
    old_path: change.oldPath,
    status: change.status,
    hunks: change.status === "moved" ? [] : diffHunks(lines(change.oldBlob), lines(change.newBlob)),
  }));
}

/** The compare body's `diffs` for two commits (`from` null = empty tree), files sorted by path, 3 context lines. */
export async function diffCommits(q: Queryable, projectId: number, from: string | null, to: string): Promise<FileDiff[]> {
  return diffEntries(q, projectId, await entriesOfCommit(q, projectId, from), await entriesOfCommit(q, projectId, to));
}
