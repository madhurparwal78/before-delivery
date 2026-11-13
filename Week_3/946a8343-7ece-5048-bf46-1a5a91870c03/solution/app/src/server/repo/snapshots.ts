// Whole-commit reads: every file's text, one file, or the sorted paths.
import type { Queryable } from "../db.ts";
import { entriesOfCommit, entryAt, readTexts, requireCommit } from "./store.ts";
import { sortedPaths } from "./trees.ts";
import type { FileMap } from "./types.ts";

/** Every file of a commit, path to text. Large blobs are read back from file storage (a 503 `storage_unavailable` when file storage is down). */
export async function snapshot(q: Queryable, projectId: number, commitId: string): Promise<FileMap> {
  const entries = await entriesOfCommit(q, projectId, commitId);
  const texts = await readTexts(q, projectId, entries.values());
  const files: FileMap = new Map();
  for (const path of sortedPaths(entries)) files.set(path, texts.get(entries.get(path) ?? "") ?? "");
  return files;
}

export async function readFile(q: Queryable, projectId: number, commitId: string, path: string): Promise<string | null> {
  const commit = await requireCommit(q, projectId, commitId);
  const entry = await entryAt(q, projectId, commit.tree, path);
  if (entry === undefined || entry.mode !== "100644") return null;
  return (await readTexts(q, projectId, [entry.id])).get(entry.id) ?? null;
}

/** Sorted file paths of a commit's tree (no content reads). */
export async function listPaths(q: Queryable, projectId: number, commitId: string): Promise<string[]> {
  return sortedPaths(await entriesOfCommit(q, projectId, commitId));
}
