import type { Db } from '../server/db.js';
import { combinedFiles, diffFingerprint } from './combined.js';
import { currentApprovals, listReviews, type ChangeRow, type RepoRow } from './model.js';
import { getSnapshot } from './revisions.js';
import { remapThreads } from './threads.js';

export interface HeadUpdateResult {
  kept: boolean;
  dismissedCount: number;
}

/**
 * The one place that decides what a new head or base revision does to approvals, viewed marks and
 * thread anchors: approvals survive only while the combined diff is identical.
 */
export async function applyHeadUpdate(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  previous: { head: string; base: string },
  next: { head: string; base: string },
): Promise<HeadUpdateResult> {
  const previousFiles = combinedFiles(
    await getSnapshot(tx, repo.id, previous.base),
    await getSnapshot(tx, repo.id, previous.head),
  );
  const nextFiles = combinedFiles(
    await getSnapshot(tx, repo.id, next.base),
    await getSnapshot(tx, repo.id, next.head),
  );
  const kept = diffFingerprint(previousFiles) === diffFingerprint(nextFiles);

  let dismissedCount = 0;
  if (!kept) {
    const approvals = currentApprovals(await listReviews(tx, change.id));
    for (const approval of approvals) {
      await tx.query("UPDATE rs_reviews SET state = 'dismissed', dismissal_kind = 'update' WHERE id = $1", [approval.id]);
      dismissedCount += 1;
    }
  }

  const previousHeadSnapshot = await getSnapshot(tx, repo.id, previous.head);
  const nextHeadSnapshot = await getSnapshot(tx, repo.id, next.head);
  const viewedRows = await tx.query<{ path: string; user_id: string }>(
    'SELECT path, user_id FROM rs_viewed WHERE change_id = $1',
    [change.id],
  );
  for (const row of viewedRows) {
    const before = previousHeadSnapshot.get(row.path)?.contentKey ?? null;
    const after = nextHeadSnapshot.get(row.path)?.contentKey ?? null;
    if (before !== after) {
      await tx.query('DELETE FROM rs_viewed WHERE change_id = $1 AND user_id = $2 AND path = $3', [
        change.id,
        row.user_id,
        row.path,
      ]);
    }
  }

  await remapThreads(tx, repo, change, previous, next);
  return { kept, dismissedCount };
}
