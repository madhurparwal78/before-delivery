import { Access, ProjectRow } from './access';
import { nowSeconds } from './clock';
import { config } from './config';
import { Sql } from './db';
import { errors } from './errors';
import { Tx, emit } from './live';
import { threeWayMergeTrees } from './diff';
import {
  MergeRequestRow,
  closingIids,
  firstFailedCheck,
  mergeChecks,
  systemNote,
} from './mr';
import { afterPush } from './push';
import { assertCanMerge, assertPushRules } from './pushrules';
import {
  branchHead,
  deleteBranch,
  filesOfCommit,
  findCommit,
  isAncestor,
  loadCommit,
  mergeBase,
  setBranch,
  shortId,
  storeCommit,
  writeTree,
} from './repo';
import { queueEvent } from './webhooks';

export type MergeOutcome = { state: 'merged'; merge_commit: string };

export async function mergedFiles(
  sql: Sql,
  project: ProjectRow,
  request: MergeRequestRow,
  targetHead: string,
  sourceHead: string,
): Promise<{ files: Map<string, string>; conflicts: string[]; base: string }> {
  const base = (await mergeBase(sql, project.id, targetHead, sourceHead)) ?? targetHead;
  const result = threeWayMergeTrees(
    await filesOfCommit(sql, project.id, base),
    await filesOfCommit(sql, project.id, targetHead),
    await filesOfCommit(sql, project.id, sourceHead),
    request.target,
    request.source,
  );
  return { files: result.files, conflicts: result.conflicts, base };
}

export async function performMerge(
  t: Tx,
  project: ProjectRow,
  access: Access,
  request: MergeRequestRow,
  sha: string | null,
  actor: string,
  options: { skipChecks?: boolean; speculative?: string | null } = {},
): Promise<MergeOutcome> {
  if (request.state === 'merged') {
    throw errors.conflict('wrong_state', 'This merge request is already merged.');
  }
  const sourceHead = await branchHead(t.sql, project.id, request.source);
  const targetHead = await branchHead(t.sql, project.id, request.target);
  if (sourceHead === null || targetHead === null) throw errors.notFound();
  if (sha !== null && sha !== sourceHead) {
    throw errors.conflict('stale_head', 'The source branch changed. Review the new commits and try again.');
  }
  await assertCanMerge(t.sql, project, access, request.target);
  if (options.skipChecks !== true) {
    const checks = await mergeChecks(t.sql, project, request);
    const failed = firstFailedCheck(checks);
    if (failed !== null) throw errors.conflict('merge_blocked', failed.text);
  }

  const method = project.settings.merge_method;
  let mergeCommit: string;
  if (options.speculative !== null && options.speculative !== undefined) {
    mergeCommit = options.speculative;
    await setBranch(t, project.id, request.target, mergeCommit);
  } else if (method === 'fast_forward') {
    if (!(await isAncestor(t.sql, project.id, targetHead, sourceHead))) {
      throw errors.conflict('merge_blocked', `Source branch must be rebased onto ${request.target}.`);
    }
    mergeCommit = sourceHead;
    await setBranch(t, project.id, request.target, sourceHead);
  } else {
    const merged = await mergedFiles(t.sql, project, request, targetHead, sourceHead);
    if (merged.conflicts.length > 0) {
      throw errors.conflict('merge_blocked', `Source branch has conflicts with ${request.target}.`);
    }
    const title = request.title.replace(/^Draft: /, '');
    const message =
      method === 'squash'
        ? `${title} (!${request.iid})`
        : `Merge branch '${request.source}' into '${request.target}'\n\n${title}\n\nSee merge request !${request.iid}`;
    if (method === 'rebase' && !(await isAncestor(t.sql, project.id, targetHead, sourceHead))) {
      throw errors.conflict('merge_blocked', `Source branch must be rebased onto ${request.target}.`);
    }
    await assertPushRules(t.sql, project.id, {
      branch: request.target,
      isNewBranch: false,
      message,
      before: await filesOfCommit(t.sql, project.id, targetHead),
      after: merged.files,
    });
    const tree = await writeTree(t, project.id, merged.files);
    const when = nowSeconds();
    mergeCommit = await storeCommit(t, project.id, {
      tree,
      parents: method === 'squash' ? [targetHead] : [targetHead, sourceHead],
      author: actor,
      authored_at: when,
      committer: actor,
      committed_at: when,
      message,
    });
    await setBranch(t, project.id, request.target, mergeCommit);
  }

  await t.sql.query(
    `update merge_requests set state = 'merged', merge_commit = $2, merged_at = now(), auto_merge = false
     where id = $1`,
    [request.id, mergeCommit],
  );
  await systemNote(t, request, actor, `Merged by @${actor} into ${request.target}.`);
  await emit(t, project.id, 'merge_request', {
    iid: request.iid,
    state: 'merged',
    target: request.target,
    merge_commit: mergeCommit,
    announcement: `Merged into ${request.target}.`,
  });
  await queueEvent(t, project, 'merge_request', {
    event: 'merge_request',
    action: 'merge',
    project: { id: project.id, path: project.path },
    merge_request: {
      iid: request.iid,
      title: request.title,
      state: 'merged',
      source: request.source,
      target: request.target,
    },
    user: actor,
  });

  if (request.target === project.default_branch) {
    await closeLinkedIssues(t, project, request, actor);
  }

  if (request.delete_source_branch) {
    const { protectionFor } = await import('./pushrules');
    const protection = await protectionFor(t.sql, project.id, request.source);
    if (protection === null) {
      await deleteBranch(t, project.id, request.source);
      await retargetStacked(t, project, request, actor);
    }
  }

  await afterPush(t, {
    project,
    branch: request.target,
    oldHead: targetHead,
    newHead: mergeCommit,
    actor,
    isNewBranch: false,
    commitCount: 1,
    skipTrainRebuild: options.speculative !== null && options.speculative !== undefined,
  });

  return { state: 'merged', merge_commit: mergeCommit };
}

export async function closeLinkedIssues(
  t: Tx,
  project: ProjectRow,
  request: MergeRequestRow,
  actor: string,
): Promise<void> {
  const fromDescription = closingIids(request.description);
  const fromCommits: number[] = [];
  if (request.merge_commit !== null) {
    const commit = await findCommit(t.sql, project.id, request.merge_commit);
    if (commit !== null) fromCommits.push(...closingIids(commit.message));
  }
  const iids = [...new Set([...fromDescription, ...fromCommits])];
  const { closeIssue } = await import('./planning');
  for (const iid of iids) {
    await closeIssue(t, project, iid, actor, `Closed by !${request.iid}.`);
  }
}

export async function retargetStacked(
  t: Tx,
  project: ProjectRow,
  request: MergeRequestRow,
  actor: string,
): Promise<void> {
  const rows = await t.sql.query<{ id: string; iid: number }>(
    `select id, iid from merge_requests where project_id = $1 and target = $2 and state = 'opened' order by iid`,
    [project.id, request.source],
  );
  for (const [index, row] of rows.entries()) {
    if (index >= config.retargetLimit) break;
    const id = Number(row.id);
    await t.sql.query('update merge_requests set target = $2 where id = $1', [id, request.target]);
    const stacked = await t.sql.one<MergeRequestRow>(
      `select id, project_id, iid, title, description, author, source, target, state, delete_source_branch,
              assignees, reviewers, auto_merge, auto_merge_sha, merge_commit
       from merge_requests where id = $1`,
      [id],
    );
    if (stacked === null) continue;
    const normalized = {
      ...stacked,
      id: Number(stacked.id),
      project_id: Number(stacked.project_id),
      iid: Number(stacked.iid),
    };
    await systemNote(
      t,
      normalized,
      'spurline-train',
      `Retargeted from ${request.source} to ${request.target} because !${request.iid} merged.`,
    );
    await emit(t, project.id, 'merge_request', { iid: normalized.iid, target: request.target });
  }
}

export async function rebaseRequest(
  t: Tx,
  project: ProjectRow,
  access: Access,
  request: MergeRequestRow,
  actor: string,
): Promise<string> {
  const sourceHead = await branchHead(t.sql, project.id, request.source);
  const targetHead = await branchHead(t.sql, project.id, request.target);
  if (sourceHead === null || targetHead === null) throw errors.notFound();
  const base = (await mergeBase(t.sql, project.id, targetHead, sourceHead)) ?? targetHead;
  const chain: string[] = [];
  let cursor: string | null = sourceHead;
  while (cursor !== null && cursor !== base) {
    chain.unshift(cursor);
    const commit = await findCommit(t.sql, project.id, cursor);
    cursor = commit === null || commit.parents.length === 0 ? null : commit.parents[0];
  }
  let head = targetHead;
  let previousOriginal = base;
  for (const original of chain) {
    const commit = await loadCommit(t.sql, project.id, original);
    const parentFiles = await filesOfCommit(t.sql, project.id, previousOriginal);
    const commitFiles = await filesOfCommit(t.sql, project.id, original);
    const headFiles = await filesOfCommit(t.sql, project.id, head);
    const merged = threeWayMergeTrees(parentFiles, headFiles, commitFiles, request.target, request.source);
    if (merged.conflicts.length > 0) {
      throw errors.conflict(
        'rebase_conflict',
        `Rebase stopped at ${shortId(original)}: ${merged.conflicts[0]} conflicts.`,
      );
    }
    await assertPushRules(t.sql, project.id, {
      branch: request.source,
      isNewBranch: false,
      message: commit.message,
      before: headFiles,
      after: merged.files,
    });
    const tree = await writeTree(t, project.id, merged.files);
    head = await storeCommit(t, project.id, {
      tree,
      parents: [head],
      author: commit.author,
      authored_at: commit.authored_at,
      committer: actor,
      committed_at: nowSeconds(),
      message: commit.message,
    });
    previousOriginal = original;
  }
  await setBranch(t, project.id, request.source, head);
  await systemNote(t, request, actor, `Rebased onto ${request.target} at ${shortId(head)}.`);
  await afterPush(t, {
    project,
    branch: request.source,
    oldHead: sourceHead,
    newHead: head,
    actor,
    isNewBranch: false,
    commitCount: chain.length,
  });
  return head;
}

export async function conflictFiles(
  sql: Sql,
  project: ProjectRow,
  request: MergeRequestRow,
): Promise<{ path: string; content: string }[]> {
  const sourceHead = await branchHead(sql, project.id, request.source);
  const targetHead = await branchHead(sql, project.id, request.target);
  if (sourceHead === null || targetHead === null) return [];
  const merged = await mergedFiles(sql, project, request, targetHead, sourceHead);
  return merged.conflicts.map((path) => ({ path, content: merged.files.get(path) ?? '' }));
}

export async function commitConflictResolution(
  t: Tx,
  project: ProjectRow,
  access: Access,
  request: MergeRequestRow,
  resolutions: { path: string; content: string }[],
  actor: string,
): Promise<string> {
  const sourceHead = await branchHead(t.sql, project.id, request.source);
  const targetHead = await branchHead(t.sql, project.id, request.target);
  if (sourceHead === null || targetHead === null) throw errors.notFound();
  const merged = await mergedFiles(t.sql, project, request, targetHead, sourceHead);
  const files = new Map(merged.files);
  for (const resolution of resolutions) {
    const { hasConflictMarkers } = await import('./diff');
    if (hasConflictMarkers(resolution.content)) {
      throw errors.validation('content', 'Remove all conflict markers before committing.');
    }
    files.set(resolution.path, resolution.content);
  }
  const message = `Resolve conflicts with ${request.target}`;
  const { assertCanPush } = await import('./pushrules');
  await assertCanPush(t.sql, project, access, request.source);
  await assertPushRules(t.sql, project.id, {
    branch: request.source,
    isNewBranch: false,
    message,
    before: await filesOfCommit(t.sql, project.id, sourceHead),
    after: files,
  });
  const tree = await writeTree(t, project.id, files);
  const when = nowSeconds();
  const commit = await storeCommit(t, project.id, {
    tree,
    parents: [sourceHead, targetHead],
    author: actor,
    authored_at: when,
    committer: actor,
    committed_at: when,
    message,
  });
  await setBranch(t, project.id, request.source, commit);
  await afterPush(t, {
    project,
    branch: request.source,
    oldHead: sourceHead,
    newHead: commit,
    actor,
    isNewBranch: false,
    commitCount: 1,
  });
  return commit;
}

export async function cancelAutoMerge(
  t: Tx,
  project: ProjectRow,
  request: MergeRequestRow,
  reason: string,
): Promise<void> {
  await t.sql.query('update merge_requests set auto_merge = false, auto_merge_sha = null where id = $1', [request.id]);
  await systemNote(t, request, 'system', `Auto-merge canceled: ${reason}.`);
}
