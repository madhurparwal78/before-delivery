// File versions the diff screen reads to reveal more context and to show what a suggestion replaces.
//   fileLines(project, ref, path)   the lines of `path` at commit `ref` (commits never change, so answers are kept)
//   wholeFileOps(project, file, oldRef, newRef)   the whole-file diff of one changed file between two commits
import { diffLines, splitLines, type DiffOp } from "../../../shared/diff.ts";
import { api } from "../../api.ts";
import type { DiffFile } from "./diff-types.ts";

const kept = new Map<string, Promise<string[]>>();

interface FileBody {
  content: string;
}

export function fileLines(project: string, ref: string, path: string): Promise<string[]> {
  const key = `${project}\u0000${ref}\u0000${path}`;
  const known = kept.get(key);
  if (known) return known;
  const query = `ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`;
  const loading = api.get<FileBody>(`/api/projects/${encodeURIComponent(project)}/files?${query}`).then((body) => splitLines(body.content));
  kept.set(key, loading);
  loading.catch(() => {
    kept.delete(key);
  });
  return loading;
}

export async function wholeFileOps(project: string, file: DiffFile, oldRef: string | null, newRef: string): Promise<DiffOp[]> {
  const before = file.status === "added" || oldRef === null ? Promise.resolve<string[]>([]) : fileLines(project, oldRef, file.old_path ?? file.path);
  const after = file.status === "deleted" ? Promise.resolve<string[]>([]) : fileLines(project, newRef, file.path);
  return diffLines(await before, await after);
}
