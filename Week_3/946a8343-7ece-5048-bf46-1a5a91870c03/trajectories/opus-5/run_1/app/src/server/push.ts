import { Access, ProjectRow } from './access';
import { nowSeconds } from './clock';
import { config } from './config';
import { errors } from './errors';
import { Tx, emit } from './live';
import { StorageUnavailable } from './storage';
import {
  MergeRequestRow,
  createVersion,
  latestVersion,
  mapThreadsToVersion,
  openRequestsForBranch,
  resetApprovals,
  systemNote,
} from './mr';
import { createPipeline } from './pipeline';
import { assertCanPush, assertPushRules } from './pushrules';
import {
  assertFileSize,
  assertUtf8,
  branchHead,
  filesOfCommit,
  findCommit,
  setBranch,
  shortId,
  storeCommit,
  writeTree,
} from './repo';
import { queueEvent } from './webhooks';

export type CommitAction = {
  action: 'create' | 'update' | 'delete' | 'move';
  path: string;
  content?: string;
  previous_path?: string;
};

export type CommitInput = {
  project: ProjectRow;
  access: Access;
  actor: string;
  branch: string;
  startRef?: string | null;
  baseCommit: string | null;
  message: string;
  actions: CommitAction[];
  timestamp?: number;
  committer?: string;
  skipProtection?: boolean;
};

export function staleBase(base: string | null, branch: string, head: string | null) {
  return errors.conflict(
    'stale_base',
    `Your base commit ${base === null ? 'none' : shortId(base)} is behind ${branch} at ${
      head === null ? 'none' : shortId(head)
    }. Refresh and try again.`,
  );
}

export function applyActions(files: Map<string, string>, actions: CommitAction[]): Map<string, string> {
  const out = new Map(files);
  for (const action of actions) {
    if (action.action === 'create') {
      if (out.has(action.path)) throw errors.validation('path', `File ${action.path} already exists.`);
      assertUtf8(action.path, action.content ?? '');
      assertFileSize(action.path, action.content ?? '');
      out.set(action.path, action.content ?? '');
      continue;
    }
    if (action.action === 'update') {
      if (!out.has(action.path)) throw errors.validation('path', `File ${action.path} does not exist.`);
      assertUtf8(action.path, action.content ?? '');
      assertFileSize(action.path, action.content ?? '');
      out.set(action.path, action.content ?? '');
      continue;
    }
    if (action.action === 'delete') {
      if (!out.has(action.path)) throw errors.validation('path', `File ${action.path} does not exist.`);
      out.delete(action.path);
      continue;
    }
    const previous = action.previous_path ?? '';
    if (!out.has(previous)) throw errors.validation('previous_path', `File ${previous} does not exist.`);
    if (out.has(action.path) && action.path !== previous) {
      throw errors.validation('path', `File ${action.path} already exists.`);
    }
    const content = action.content ?? out.get(previous) ?? '';
    assertUtf8(action.path, content);
    assertFileSize(action.path, content);
    out.delete(previous);
    out.set(action.path, content);
  }
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export async function commitToBranch(
  t: Tx,
  input: CommitInput,
): Promise<{ commit: string; pipeline: { id: number } | { created: false; reason: string } }> {
  const head = await branchHead(t.sql, input.project.id, input.branch);
  const isNewBranch = head === null;
  let parentId: string | null = head;
  if (isNewBranch) {
    if (input.startRef !== null && input.startRef !== undefined && input.startRef !== '') {
      const startHead = await branchHead(t.sql, input.project.id, input.startRef);
      if (startHead === null) throw staleBase(input.baseCommit, input.branch, null);
      if (input.baseCommit !== startHead) throw staleBase(input.baseCommit, input.branch, startHead);
      parentId = startHead;
    } else {
      if (input.baseCommit !== null) throw staleBase(input.baseCommit, input.branch, null);
      parentId = null;
    }
  } else if (input.baseCommit !== head) {
    throw staleBase(input.baseCommit, input.branch, head);
  }
  if (input.message.trim() === '') {
    throw errors.validation('message', "Commit message can't be blank.");
  }
  if (input.skipProtection !== true) {
    await assertCanPush(t.sql, input.project, input.access, input.branch);
  }
  const before = parentId === null ? new Map<string, string>() : await filesOfCommit(t.sql, input.project.id, parentId);
  const after = applyActions(before, input.actions);
  if (input.skipProtection !== true) {
    await assertPushRules(t.sql, input.project.id, {
      branch: input.branch,
      isNewBranch,
      message: input.message,
      before,
      after,
    });
  }
  let tree: string;
  try {
    tree = await writeTree(t, input.project.id, after);
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      throw errors.storageUnavailable('File storage is unavailable. Nothing was committed. Try again in a moment.');
    }
    throw error;
  }
  const when = input.timestamp ?? nowSeconds();
  const commit = await storeCommit(t, input.project.id, {
    tree,
    parents: parentId === null ? [] : [parentId],
    author: input.actor,
    authored_at: when,
    committer: input.committer ?? input.actor,
    committed_at: when,
    message: input.message,
  });
  await setBranch(t, input.project.id, input.branch, commit);
  const pipeline = await afterPush(t, {
    project: input.project,
    branch: input.branch,
    oldHead: head,
    newHead: commit,
    actor: input.actor,
    isNewBranch,
    commitCount: 1,
  });
  return { commit, pipeline };
}

export type AfterPushInput = {
  project: ProjectRow;
  branch: string;
  oldHead: string | null;
  newHead: string;
  actor: string;
  isNewBranch: boolean;
  commitCount: number;
  source?: 'push' | 'web';
  skipTrainRebuild?: boolean;
};

export async function afterPush(
  t: Tx,
  input: AfterPushInput,
): Promise<{ id: number } | { created: false; reason: string }> {
  const commit = await findCommit(t.sql, input.project.id, input.newHead);
  await queueEvent(t, input.project, 'push', {
    event: 'push',
    project: { id: input.project.id, path: input.project.path },
    ref: input.branch,
    before: input.oldHead,
    after: input.newHead,
    commits:
      commit === null
        ? []
        : [{ id: commit.id, message: commit.message, author: commit.author }],
    user: input.actor,
  });

  const requests = await openRequestsForBranch(t.sql, input.project.id, input.branch);
  for (const request of requests) {
    await onSourcePush(t, input.project, request, input.newHead, input.commitCount, input.actor);
  }

  const pipeline = await createPipeline(t, {
    project: input.project,
    ref: input.branch,
    sha: input.newHead,
    source: input.source ?? 'push',
    beforeSha: input.oldHead,
    actor: input.actor,
  });

  if (input.skipTrainRebuild !== true) {
    const { rebuildTargetTrain } = await import('./train');
    await rebuildTargetTrain(t, input.project, input.branch);
  }
  return pipeline;
}

export async function onSourcePush(
  t: Tx,
  project: ProjectRow,
  request: MergeRequestRow,
  head: string,
  commitCount: number,
  actor: string,
): Promise<void> {
  const previous = await latestVersion(t.sql, request.id);
  const version = await createVersion(t, project, request, head);
  await mapThreadsToVersion(t, project, request, previous, version);
  await systemNote(
    t,
    request,
    actor,
    commitCount === 1 ? 'Added 1 commit.' : `Added ${commitCount} commits.`,
  );
  if (project.settings.reset_approvals_on_push) {
    await resetApprovals(t, project, request);
  }
  if (request.auto_merge) {
    await t.sql.query('update merge_requests set auto_merge = false, auto_merge_sha = null where id = $1', [request.id]);
    await systemNote(t, request, actor, 'Auto-merge canceled: new commits were pushed.');
  }
  const { removeCar } = await import('./train');
  await removeCar(t, project, request, 'new commits were pushed', false);
  await emit(t, project.id, 'checks', { iid: request.iid });
}
