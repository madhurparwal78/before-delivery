// Walking the commit graph: ancestry, merge base, history, blame.
import type { Queryable } from "../db.ts";
import { diffLines, splitLines } from "../../shared/diff.ts";
import { entryAt, getCommit, isObjectId, loadCommits, readTexts, requireCommit } from "./store.ts";
import type { CommitRow } from "./types.ts";

/** Head commit of a branch, or null when the branch does not exist. */
export async function branchHead(q: Queryable, projectId: number, branch: string): Promise<string | null> {
  const row = await q.maybe<{ commit_id: string }>("SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2", [projectId, branch]);
  return row?.commit_id ?? null;
}

/** Resolves a branch name, tag name or full commit id to a commit id (null if unknown). */
export async function resolveRef(q: Queryable, projectId: number, ref: string): Promise<string | null> {
  const row = await q.maybe<{ commit_id: string }>(
    "SELECT commit_id FROM refs WHERE project_id = $1 AND name = $2 ORDER BY (kind = 'branch') DESC LIMIT 1",
    [projectId, ref],
  );
  if (row !== undefined) return row.commit_id;
  if (!isObjectId(ref)) return null;
  return (await getCommit(q, projectId, ref)) === undefined ? null : ref;
}

// Every commit reachable from `head`, itself included.
async function reachableFrom(q: Queryable, projectId: number, head: string): Promise<Set<string>> {
  const rows = await q.q<{ id: string }>(
    `WITH RECURSIVE walk(id) AS (
       SELECT $2::text
       UNION
       SELECT parent FROM walk w
         JOIN commits c ON c.project_id = $1 AND c.id = w.id
         CROSS JOIN LATERAL unnest(c.parents) AS parent
     ) SELECT id FROM walk`,
    [projectId, head],
  );
  return new Set(rows.map((row) => row.id));
}

export async function isAncestor(q: Queryable, projectId: number, ancestor: string, descendant: string): Promise<boolean> {
  if (ancestor === descendant) return true;
  return (await reachableFrom(q, projectId, descendant)).has(ancestor);
}

/** The published merge-base walk (breadth-first from `to`, parents in order; first commit also reachable from `from`). */
export async function mergeBase(q: Queryable, projectId: number, from: string, to: string): Promise<string | null> {
  const known = await reachableFrom(q, projectId, from);
  const seen = new Set<string>([to]);
  let level = [to];
  while (level.length > 0) {
    const commits = await loadCommits(q, projectId, level);
    const next: string[] = [];
    for (const id of level) {
      if (known.has(id)) return id;
      for (const parent of commits.get(id)?.parents ?? []) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        next.push(parent);
      }
    }
    level = next;
  }
  return null;
}

// Commits reachable from `head` and not from `base`, in breadth-first walk order from `head`.
async function walkExcluding(q: Queryable, projectId: number, base: string | null, head: string): Promise<CommitRow[]> {
  const excluded = base === null ? new Set<string>() : await reachableFrom(q, projectId, base);
  const ordered: CommitRow[] = [];
  const seen = new Set<string>([head]);
  let level = excluded.has(head) ? [] : [head];
  while (level.length > 0) {
    const commits = await loadCommits(q, projectId, level);
    const next: string[] = [];
    for (const id of level) {
      const commit = commits.get(id);
      if (commit === undefined) continue;
      ordered.push(commit);
      for (const parent of commit.parents) {
        if (seen.has(parent) || excluded.has(parent)) continue;
        seen.add(parent);
        next.push(parent);
      }
    }
    level = next;
  }
  return ordered;
}

/** Commits reachable from `head` and not from `base` (null = all), newest first (committer time, then walk order). */
export async function commitsBetween(q: Queryable, projectId: number, base: string | null, head: string): Promise<CommitRow[]> {
  const walk = await walkExcluding(q, projectId, base, head);
  const position = new Map(walk.map((commit, index) => [commit.id, index]));
  return [...walk].sort((a, b) => b.committed_at - a.committed_at || (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
}

// The same commits oldest first with every parent before its children (first parents first).
export async function commitsOldestFirst(q: Queryable, projectId: number, base: string | null, head: string): Promise<CommitRow[]> {
  const walk = await walkExcluding(q, projectId, base, head);
  const inside = new Map(walk.map((commit) => [commit.id, commit]));
  const done = new Set<string>();
  const out: CommitRow[] = [];
  const stack: Array<{ commit: CommitRow; next: number }> = [];
  const root = inside.get(head);
  if (root === undefined) return out;
  stack.push({ commit: root, next: 0 });
  done.add(root.id);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const parent = frame.commit.parents[frame.next];
    if (parent === undefined) {
      out.push(frame.commit);
      stack.pop();
      continue;
    }
    frame.next++;
    const candidate = inside.get(parent);
    if (candidate === undefined || done.has(parent)) continue;
    done.add(parent);
    stack.push({ commit: candidate, next: 0 });
  }
  return out;
}

// The id of the file or folder at `path` in a commit, or null when there is none.
async function idAt(q: Queryable, projectId: number, commit: CommitRow, path: string): Promise<string | null> {
  return (await entryAt(q, projectId, commit.tree, path))?.id ?? null;
}

/** First-parent history from `head`, newest first. With `path`, only commits where that path differs from the first parent's. */
export async function firstParentHistory(q: Queryable, projectId: number, head: string, path?: string): Promise<CommitRow[]> {
  const out: CommitRow[] = [];
  let current: CommitRow | undefined = await getCommit(q, projectId, head);
  let currentId = current !== undefined && path !== undefined ? await idAt(q, projectId, current, path) : null;
  while (current !== undefined) {
    const parent: CommitRow | undefined = current.parents[0] === undefined ? undefined : await requireCommit(q, projectId, current.parents[0]);
    if (path === undefined) {
      out.push(current);
    } else {
      const parentId = parent === undefined ? null : await idAt(q, projectId, parent, path);
      if (parentId !== currentId) out.push(current);
      currentId = parentId;
    }
    current = parent;
  }
  return out;
}

interface BlameLine {
  readonly line: number;
  readonly commit: string;
  readonly author: string;
  readonly text: string;
}

/** Blame of a file at `head`; null when the file does not exist there. */
export async function blameFile(q: Queryable, projectId: number, head: string, path: string): Promise<BlameLine[] | null> {
  const headCommit = await requireCommit(q, projectId, head);
  const entry = await entryAt(q, projectId, headCommit.tree, path);
  if (entry === undefined || entry.mode !== "100644") return null;
  const chain = await firstParentHistory(q, projectId, head, path);
  const textAt = async (commit: CommitRow | undefined): Promise<string> => {
    if (commit === undefined) return "";
    const found = await entryAt(q, projectId, commit.tree, path);
    if (found === undefined || found.mode !== "100644") return "";
    return (await readTexts(q, projectId, [found.id])).get(found.id) ?? "";
  };

  let newLines = splitLines(await textAt(headCommit));
  const lines = newLines.map((text, index): BlameLine => ({ line: index + 1, commit: "", author: "", text }));
  // finalOf[i] is the output line that line i of the version being compared still stands for, or -1 once it is blamed.
  let finalOf = newLines.map((_, index) => index);
  for (const commit of chain) {
    if (finalOf.every((target) => target === -1)) break;
    const parent = commit.parents[0] === undefined ? undefined : await requireCommit(q, projectId, commit.parents[0]);
    const oldLines = splitLines(await textAt(parent));
    const carried = oldLines.map(() => -1);
    for (const op of diffLines(oldLines, newLines)) {
      if (op.new === null) continue;
      const target = finalOf[op.new - 1] ?? -1;
      if (target === -1) continue;
      const line = lines[target];
      if (op.type === "add" && line !== undefined) lines[target] = { ...line, commit: commit.id, author: commit.author };
      else if (op.type === "equal" && op.old !== null) carried[op.old - 1] = target;
    }
    finalOf = carried;
    newLines = oldLines;
  }
  return lines;
}
