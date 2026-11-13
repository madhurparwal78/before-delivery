import type { PoolClient } from 'pg';
import type { Ctx } from '../api/ctx.js';
import { AppError } from '../core/errors.js';
import { getCommit, mergeBase, isAncestor, readTreeFull, storeCommit, splitLines } from './repo.js';
import { mergeFileStates, diffLines } from './diff.js';
import type { MrRow } from './mr-service.js';

export interface PushConsequences {
  commitId: string;
  branch: string;
  projectId: number;
}

/** Create a pipeline for a push, per the pipeline rules. */
const filesOfCache = new Map<string, Map<string, string>>();

export async function filesOf(c: PoolClient, ctx: Ctx, commitId: string): Promise<Map<string, string>> {
  const cached = filesOfCache.get(commitId);
  if (cached) return cached;
  const commit = await getCommit(c, commitId);
  if (!commit) return new Map();
  const files = await readTreeFull(c, commit.tree, async (k) => ctx.storage.tryGet(k));
  filesOfCache.set(commitId, files);
  return files;
}

export async function fileFromCommit(c: PoolClient, ctx: Ctx, commitId: string, path: string): Promise<string | null> {
  const files = await filesOf(c, ctx, commitId);
  return files.get(path) ?? null;
}

export interface MergeOutcome {
  commitId: string | null;
  method: string;
  fastForward: boolean;
  conflicts: string[];
}

/** Compute the merge commit per the project's merge method. */
export async function computeMerge(
  ctx: Ctx,
  c: PoolClient,
  mr: MrRow,
  method: string,
  actor: string,
  pipelineVars: Record<string, string> = {},
): Promise<MergeOutcome> {
  void pipelineVars;
  const sourceHead = (await c.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [mr.project_id, mr.source])).rows[0]?.commit_id ?? null;
  const targetHead = (await c.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [mr.project_id, mr.target])).rows[0]?.commit_id ?? null;
  if (!sourceHead || !targetHead) {
    throw new AppError(409, 'stale_head', 'The source branch changed. Review the new commits and try again.');
  }
  if (method === 'fast_forward') {
    const ok = await isAncestor(c, targetHead, sourceHead);
    if (!ok) {
      throw new AppError(409, 'merge_blocked', `Source branch must be rebased onto ${mr.target}.`);
    }
    await c.query(`UPDATE refs SET commit_id = $3 WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [mr.project_id, mr.target, sourceHead]);
    return { commitId: sourceHead, method, fastForward: true, conflicts: [] };
  }
  const base = await mergeBase(c, sourceHead, targetHead);
  if (method === 'rebase') {
    const ok = await isAncestor(c, targetHead, sourceHead);
    if (!ok) {
      throw new AppError(409, 'merge_blocked', `Source branch must be rebased onto ${mr.target}.`);
    }
  }
  const baseFiles = base ? await filesOf(c, ctx, base) : new Map<string, string>();
  const targetFiles = await filesOf(c, ctx, targetHead);
  const sourceFiles = await filesOf(c, ctx, sourceHead);
  const merged = new Map<string, string>();
  const conflicts: string[] = [];
  for (const path of new Set([...baseFiles.keys(), ...targetFiles.keys(), ...sourceFiles.keys()])) {
    const res = mergeFileStates(baseFiles.get(path) ?? null, targetFiles.get(path) ?? null, sourceFiles.get(path) ?? null, mr.target, mr.source);
    if (res.content !== null) merged.set(path, res.content);
    if (res.conflict) conflicts.push(path);
  }
  if (conflicts.length > 0) {
    return { commitId: null, method, fastForward: false, conflicts };
  }
  const now = ctx.now();
  const secs = Math.floor(now / 1000);
  const { buildTreeFromFiles } = await import('./repo.js');
  const tree = await buildTreeFromFiles(c, merged, ctx.settings.inlineMaxBytes);
  let parents: string[];
  let message: string;
  if (method === 'squash') {
    parents = [targetHead];
    message = `${mr.title} (!${mr.iid})`;
  } else {
    parents = [targetHead, sourceHead];
    message = `Merge branch '${mr.source}' into '${mr.target}'\n\n${mr.title}\n\nSee merge request !${mr.iid}`;
  }
  const commitId = await storeCommit(c, {
    tree,
    parents,
    author: actor,
    author_time: secs,
    committer: actor,
    commit_time: secs,
    message,
  });
  await c.query(`UPDATE refs SET commit_id = $3 WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [mr.project_id, mr.target, commitId]);
  return { commitId, method, fastForward: false, conflicts: [] };
}

export function closingKeywords(description: string): number[] {
  const out = new Set<number>();
  const re = /\b(closes|fixes|resolves)\s+#(\d+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) {
    out.add(parseInt(m[2], 10));
  }
  return [...out];
}

export function commitsBetween(c: PoolClient, from: string, to: string): Promise<string[]> {
  // commits reachable from `to` but not `from`
  return (async () => {
    const fromSet = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (fromSet.has(id)) continue;
      fromSet.add(id);
      const commit = await getCommit(c, id);
      if (commit) stack.push(...commit.parents);
    }
    const out: string[] = [];
    const seen = new Set<string>();
    const stack2 = [to];
    while (stack2.length > 0) {
      const id = stack2.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (fromSet.has(id)) continue;
      out.push(id);
      const commit = await getCommit(c, id);
      if (commit) stack2.push(...commit.parents);
    }
    return out;
  })();
}

export async function commitMessagesOf(c: PoolClient, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const commit = await getCommit(c, id);
    if (commit) out.push(commit.message);
  }
  return out;
}

export function diffLinePairs(a: string, b: string): ReturnType<typeof diffLines> {
  return diffLines(a, b);
}

export { splitLines };
