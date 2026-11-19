import type { Db } from '../server/db.js';
import type { EventSink } from '../server/live.js';
import { applyChangeOnto } from './apply.js';
import { changesAbove, stackChain } from './changeview.js';
import { applyHeadUpdate } from './headupdate.js';
import { getChangeById, type ChangeRow, type RepoRow } from './model.js';
import { createRevision, getBranchRevision, getSnapshot, loadContents, setBranchRevision } from './revisions.js';

export interface Actor {
  username: string;
  name: string;
}

export type NoticeKind = 'base-changed' | 'restack-stopped' | 'not-restacked';

async function setRestackState(
  tx: Db,
  change: ChangeRow,
  result: string | null,
  dismissedCount: number | null,
  notice: { kind: NoticeKind; text: string } | null,
): Promise<void> {
  await tx.query(
    `UPDATE rs_changes SET restack_result = $2, restack_dismissed_count = $3, restack_notice = $4, restack_notice_kind = $5
     WHERE id = $1`,
    [change.id, result, dismissedCount, notice ? notice.text : null, notice ? notice.kind : null],
  );
}

/** Rows at or below the updated change carry no result. */
export async function clearResultsAtAndBelow(tx: Db, repo: RepoRow, updated: ChangeRow): Promise<void> {
  const chain = await stackChain(tx, repo, updated);
  const updatedIndex = chain.findIndex((item) => item.id === updated.id);
  for (const change of chain.slice(0, updatedIndex + 1)) {
    await setRestackState(tx, change, null, null, null);
  }
}

async function markNotRestacked(tx: Db, repo: RepoRow, conflicting: ChangeRow, sink: EventSink): Promise<void> {
  const queue = await changesAbove(tx, repo, conflicting);
  while (queue.length > 0) {
    const change = queue.shift()!;
    await setRestackState(tx, change, 'not_restacked', null, {
      kind: 'not-restacked',
      text: `Not restacked: #${conflicting.number} has a restack conflict`,
    });
    sink.add({ kind: 'not-restacked', text: `#${change.number}: not restacked`, change: change.number });
    queue.push(...(await changesAbove(tx, repo, change)));
  }
}

/**
 * Restacks one change onto a target revision with the file-level apply rule.
 * Returns true when the change got a new revision.
 */
export async function restackOnto(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  lower: ChangeRow | null,
  target: string,
  sink: EventSink,
  actor: Actor,
  baseChangedNotice: { kind: NoticeKind; text: string } | null,
): Promise<boolean> {
  const headRevision = (await getBranchRevision(tx, repo.id, change.headBranch))!;
  const baseSnapshot = await getSnapshot(tx, repo.id, change.baseRevision);
  const headSnapshot = await getSnapshot(tx, repo.id, headRevision);
  const targetSnapshot = await getSnapshot(tx, repo.id, target);
  const lowerNumber = lower ? lower.number : change.number;

  const result = applyChangeOnto(baseSnapshot, headSnapshot, targetSnapshot);
  if (!result.ok) {
    await setRestackState(tx, change, 'conflicting', result.conflicts.length, {
      kind: 'restack-stopped',
      text: `Restack stopped: ${result.conflicts.join(', ')} changed in #${lowerNumber}`,
    });
    sink.add({
      kind: 'restack-conflict',
      text: `#${change.number}: restack conflict in ${result.conflicts.length} files`,
      change: change.number,
    });
    await markNotRestacked(tx, repo, change, sink);
    return false;
  }

  const contents = await loadContents(result.snapshot);
  const revision = await createRevision(tx, repo.id, {
    parents: [headRevision],
    message: `Restack onto #${lowerNumber}`,
    authorUsername: actor.username,
    authorName: actor.name,
    contents,
  });
  await setBranchRevision(tx, repo.id, change.headBranch, revision);
  await tx.query('UPDATE rs_changes SET base_revision = $2, base_branch = $3 WHERE id = $1', [
    change.id,
    target,
    change.baseBranch,
  ]);

  const update = await applyHeadUpdate(
    tx,
    repo,
    change,
    { head: headRevision, base: change.baseRevision },
    { head: revision, base: target },
  );
  await setRestackState(
    tx,
    change,
    update.kept ? 'kept' : 'dismissed',
    update.kept ? null : update.dismissedCount,
    baseChangedNotice,
  );
  sink.add({
    kind: 'restack',
    text: `#${change.number}: restacked onto #${lowerNumber}, approvals ${update.kept ? 'kept' : 'dismissed'}`,
    change: change.number,
  });

  const refreshed = (await getChangeById(tx, change.id))!;
  await restackAbove(tx, repo, refreshed, sink, actor);
  return true;
}

/** Restacks every change above, in stack order. */
export async function restackAbove(
  tx: Db,
  repo: RepoRow,
  lower: ChangeRow,
  sink: EventSink,
  actor: Actor,
): Promise<void> {
  const target = (await getBranchRevision(tx, repo.id, lower.headBranch))!;
  for (const change of await changesAbove(tx, repo, lower)) {
    await restackOnto(tx, repo, change, lower, target, sink, actor, null);
  }
}
