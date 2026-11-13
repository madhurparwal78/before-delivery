// Three-way merges of commits, the four merge methods, rebasing and conflict lists.
import type { Queryable, Tx } from "../db.ts";
import { nowSeconds } from "../clock.ts";
import { ApiError, conflict } from "../errors.ts";
import { blobId, shortId } from "../lib/objects.ts";
import { mergeTrees, type TreeConflict } from "../../shared/merge.ts";
import { advanceBranch, staleBase } from "./commits.ts";
import { enforcePushRules } from "./enforce.ts";
import { branchHead, commitsOldestFirst, isAncestor, mergeBase } from "./history.ts";
import { assertMayUpdate } from "./protection.ts";
import { entriesOfCommit, readTexts, requireCommit, storeCommit } from "./store.ts";
import type { Entries } from "./trees.ts";
import type { BranchUpdate, ConflictFile, MergeInput, MergeOutcome, RebaseInput } from "./types.ts";

interface EntryMerge {
  readonly entries: Map<string, string>;
  // Bytes and text of blobs the merge produced.
  readonly blobs: Map<string, Buffer>;
  readonly texts: Map<string, string>;
  readonly conflicts: TreeConflict[];
}

// Three-way merge of snapshots held as blob ids. Only files that changed on both sides in different ways are read.
async function mergeEntries(
  q: Queryable, projectId: number, base: Entries, ours: Entries, theirs: Entries, labels: { ours: string; theirs: string },
): Promise<EntryMerge> {
  const entries = new Map<string, string>();
  const contested: string[] = [];
  for (const path of new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])) {
    const b = base.get(path);
    const o = ours.get(path);
    const t = theirs.get(path);
    if (o === t || t === b) {
      if (o !== undefined) entries.set(path, o);
    } else if (o === b) {
      if (t !== undefined) entries.set(path, t);
    } else {
      contested.push(path);
    }
  }
  const blobs = new Map<string, Buffer>();
  const texts = new Map<string, string>();
  let conflicts: TreeConflict[] = [];
  if (contested.length > 0) {
    const stored = await readTexts(q, projectId, contested.flatMap((path) => [base.get(path), ours.get(path), theirs.get(path)]).filter((id): id is string => id !== undefined));
    const pick = (side: Entries): Map<string, string> => {
      const picked = new Map<string, string>();
      for (const path of contested) {
        const id = side.get(path);
        if (id !== undefined) picked.set(path, stored.get(id) ?? "");
      }
      return picked;
    };
    const merged = mergeTrees(pick(base), pick(ours), pick(theirs), labels);
    conflicts = merged.conflicts;
    for (const [path, text] of merged.files) {
      const bytes = Buffer.from(text, "utf8");
      const id = blobId(bytes);
      entries.set(path, id);
      blobs.set(id, bytes);
      texts.set(id, text);
    }
  }
  return { entries: new Map([...entries].sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])))), blobs, texts, conflicts };
}

async function mergeOfCommits(q: Queryable, projectId: number, ours: string, theirs: string, labels: { ours: string; theirs: string }): Promise<EntryMerge & { base: string | null }> {
  const base = await mergeBase(q, projectId, ours, theirs);
  const merged = await mergeEntries(
    q, projectId, await entriesOfCommit(q, projectId, base), await entriesOfCommit(q, projectId, ours), await entriesOfCommit(q, projectId, theirs), labels,
  );
  return { ...merged, base };
}

/** Three-way merge of two commits against their merge base; ours = target side, theirs = source side. */
export async function mergeCommits(
  q: Queryable, projectId: number, oursCommit: string, theirsCommit: string, labels: { ours: string; theirs: string },
): Promise<MergeOutcome> {
  const merged = await mergeOfCommits(q, projectId, oursCommit, theirsCommit, labels);
  if (merged.conflicts.length > 0) return { clean: false, conflicts: merged.conflicts, base: merged.base };
  const wanted = [...merged.entries.values()].filter((id) => !merged.texts.has(id));
  const stored = await readTexts(q, projectId, wanted);
  const files = new Map<string, string>();
  for (const [path, id] of merged.entries) files.set(path, merged.texts.get(id) ?? stored.get(id) ?? "");
  return { clean: true, files, base: merged.base };
}

/** Conflicts of merging the target into the source (empty when it merges cleanly). Used by the checks and the conflicts page. */
export async function conflictsFor(
  q: Queryable, projectId: number, targetHead: string, sourceHead: string, labels: { ours: string; theirs: string },
): Promise<ConflictFile[]> {
  const merged = await mergeOfCommits(q, projectId, targetHead, sourceHead, labels);
  return merged.conflicts.map((found) => ({ path: found.path, kind: found.kind, segments: found.segments ?? null, markedText: found.markedText }));
}

// Callers refuse through the merge checks first; this only guards what those checks already cover.
export const cannotMerge = (): ApiError => conflict("merge_blocked", "The merge can't be completed.");

/** Lands a merge request by the project's merge method (merge commit, squash, fast-forward, rebase); returns the new target head. */
export async function performMerge(tx: Tx, input: MergeInput): Promise<{ mergeCommit: string; update: BranchUpdate }> {
  const { project, actor, targetBranch, sourceBranch, sourceHead, method } = input;
  await tx.lockProject(project.id);
  const targetHead = await branchHead(tx, project.id, targetBranch);
  if (targetHead === null) throw cannotMerge();
  await assertMayUpdate(tx, project, input.access, targetBranch, "merge");
  const fastForwardable = await isAncestor(tx, project.id, targetHead, sourceHead);
  if ((method === "fast_forward" || method === "rebase") && !fastForwardable) throw cannotMerge();

  const before = await entriesOfCommit(tx, project.id, targetHead);
  let newHead = sourceHead;
  if (method === "fast_forward") {
    const head = await requireCommit(tx, project.id, sourceHead);
    await enforcePushRules(tx, {
      projectId: project.id, branch: targetBranch, isNewBranch: false, message: head.message, before, after: await entriesOfCommit(tx, project.id, sourceHead),
    });
  } else {
    const merged = await mergeOfCommits(tx, project.id, targetHead, sourceHead, { ours: targetBranch, theirs: sourceBranch });
    if (merged.conflicts.length > 0) throw cannotMerge();
    const message = method === "squash"
      ? `${input.title} (!${input.iid})`
      : `Merge branch '${sourceBranch}' into '${targetBranch}'\n\n${input.title}\n\nSee merge request !${input.iid}`;
    await enforcePushRules(tx, {
      projectId: project.id, branch: targetBranch, isNewBranch: false, message: message.replace(/\s+$/u, ""), before, after: merged.entries, known: merged.texts,
    });
    const at = nowSeconds();
    const commit = await storeCommit(tx, {
      projectId: project.id, parents: method === "squash" ? [targetHead] : [targetHead, sourceHead], entries: merged.entries,
      blobs: merged.blobs, author: actor.username, authoredAt: at, committer: actor.username, committedAt: at, message,
    });
    newHead = commit.id;
  }
  const landed = await advanceBranch(tx, { project, branch: targetBranch, oldHead: targetHead, newHead, actor, source: "merge" });
  return { mergeCommit: newHead, update: landed.update };
}

/** Replays the source branch's commits onto the target head (409 `rebase_conflict` leaves nothing changed). */
export async function rebaseBranch(tx: Tx, input: RebaseInput): Promise<{ head: string; update: BranchUpdate }> {
  const { project, actor, sourceBranch, targetBranch } = input;
  await tx.lockProject(project.id);
  const sourceHead = await branchHead(tx, project.id, sourceBranch);
  const targetHead = await branchHead(tx, project.id, targetBranch);
  if (sourceHead === null || targetHead === null) throw staleBase(sourceHead, sourceBranch, targetHead);
  await assertMayUpdate(tx, project, input.access, sourceBranch, "push");
  const base = await mergeBase(tx, project.id, targetHead, sourceHead);
  const replay = await commitsOldestFirst(tx, project.id, base, sourceHead);

  let head = targetHead;
  let entries = await entriesOfCommit(tx, project.id, head);
  const at = nowSeconds();
  for (const original of replay) {
    const parentEntries = await entriesOfCommit(tx, project.id, original.parents[0] ?? null);
    const merged = await mergeEntries(
      tx, project.id, parentEntries, entries, await entriesOfCommit(tx, project.id, original.id), { ours: targetBranch, theirs: sourceBranch },
    );
    const clash = merged.conflicts[0];
    if (clash !== undefined) throw conflict("rebase_conflict", `Rebase stopped at ${shortId(original.id)}: ${clash.path} conflicts.`);
    await enforcePushRules(tx, {
      projectId: project.id, branch: sourceBranch, isNewBranch: false, message: original.message, before: entries, after: merged.entries, known: merged.texts,
    });
    const replayed = await storeCommit(tx, {
      projectId: project.id, parents: [head], entries: merged.entries, blobs: merged.blobs, author: original.author,
      authoredAt: original.authored_at, committer: actor.username, committedAt: at, message: original.message,
    });
    head = replayed.id;
    entries = merged.entries;
  }
  if (head === sourceHead) {
    const update: BranchUpdate = { project, branch: sourceBranch, oldHead: sourceHead, newHead: sourceHead, actor, source: "rebase", newCommits: [] };
    return { head, update };
  }
  const landed = await advanceBranch(tx, { project, branch: sourceBranch, oldHead: sourceHead, newHead: head, actor, source: "rebase" });
  return { head, update: landed.update };
}
