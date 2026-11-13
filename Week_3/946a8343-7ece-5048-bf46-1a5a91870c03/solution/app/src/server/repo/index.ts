// Repository module: the content-addressed store, commits, refs, history, merge methods, protection and push rules.
// This file is the module's public surface; the implementation lives in sibling files.
import type { Queryable } from "../db.ts";

export { readCommitRequest, registerRepoRoutes } from "./routes.ts";

export { branchHead, commitsBetween, isAncestor, mergeBase, resolveRef } from "./history.ts";
export { changedFiles, diffCommits } from "./diffs.ts";
export { checkPushRules } from "./enforce.ts";
export { isProtectedBranch } from "./protection.ts";
export { commitToBranch, commitWithParents, createTag, deleteBranchRef, moveBranch, writeCommit } from "./commits.ts";
export { cannotMerge, conflictsFor, mergeCommits, performMerge, rebaseBranch } from "./merging.ts";
export { getCommit } from "./store.ts";
export { listPaths, readFile, snapshot } from "./snapshots.ts";

import { branchHead } from "./history.ts";

export async function branchExists(q: Queryable, projectId: number, name: string): Promise<boolean> {
  return (await branchHead(q, projectId, name)) !== null;
}
