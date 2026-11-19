import type { Db } from '../server/db.js';
import type { EventSink } from '../server/live.js';
import { changeMailBody, changeUrl, enqueueMail } from '../server/mail.js';
import { applyChangeOnto } from './apply.js';
import { changesAbove } from './changeview.js';
import { getUserById, type ChangeRow, type RepoRow } from './model.js';
import { restackOnto, type Actor } from './restack.js';
import { createRevision, getBranchRevision, getSnapshot, loadContents, setBranchRevision } from './revisions.js';

/** Creates the merge revision, moves the base branch and marks the change merged in one step. */
export async function mergeChangeNow(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  actor: Actor,
  sink: EventSink,
): Promise<string> {
  const headRevision = (await getBranchRevision(tx, repo.id, change.headBranch))!;
  const baseHead = (await getBranchRevision(tx, repo.id, change.baseBranch))!;
  const baseSnapshot = await getSnapshot(tx, repo.id, change.baseRevision);
  const headSnapshot = await getSnapshot(tx, repo.id, headRevision);
  const targetSnapshot = await getSnapshot(tx, repo.id, baseHead);
  const result = applyChangeOnto(baseSnapshot, headSnapshot, targetSnapshot);
  if (!result.ok) throw new Error('merge attempted on a conflicting change');

  const contents = await loadContents(result.snapshot);
  const mergeRevision = await createRevision(tx, repo.id, {
    parents: [baseHead, headRevision],
    message: `Merge #${change.number}: ${change.title}`,
    authorUsername: actor.username,
    authorName: actor.name,
    contents,
  });
  await setBranchRevision(tx, repo.id, change.baseBranch, mergeRevision);
  await tx.query("UPDATE rs_changes SET state = 'merged', merge_revision = $2, removal_reason = NULL WHERE id = $1", [
    change.id,
    mergeRevision,
  ]);
  await tx.query('UPDATE rs_review_requests SET pending = false WHERE change_id = $1', [change.id]);

  const author = (await getUserById(tx, change.authorUserId))!;
  await enqueueMail(tx, {
    to: author.email,
    subject: `[${repo.org}/${repo.name}] #${change.number} merged: ${change.title}`,
    body: changeMailBody([
      `Change #${change.number} ${change.title} was merged into ${change.baseBranch}.`,
      changeUrl(repo.org, repo.name, change.number),
    ]),
    changeHeader: `${repo.org}/${repo.name}#${change.number}`,
  });
  sink.add({ kind: 'merge', text: `#${change.number} merged`, change: change.number });

  const above = await changesAbove(tx, repo, change);
  for (const upper of above) {
    await tx.query('UPDATE rs_changes SET base_branch = $2 WHERE id = $1', [upper.id, change.baseBranch]);
    const retargeted = { ...upper, baseBranch: change.baseBranch };
    await restackOnto(tx, repo, retargeted, change, mergeRevision, sink, actor, {
      kind: 'base-changed',
      text: `Base changed to ${change.baseBranch} after #${change.number} merged`,
    });
    break;
  }

  return mergeRevision;
}
