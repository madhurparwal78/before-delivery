import type { Db } from '../server/db.js';
import { serverNow } from '../server/clock.js';
import { conflict, invalid, notFound } from '../server/errors.js';
import type { EventSink } from '../server/live.js';
import { changeMailBody, changeUrl, enqueueMail } from '../server/mail.js';
import { combinedFiles, diffFingerprint } from './combined.js';
import { getUserById, getUserByUsername, roleFor, type ChangeRow, type RepoRow, type ReviewRow, type UserRow } from './model.js';
import { getBranchRevision, getSnapshot } from './revisions.js';

export type ReviewType = 'comment' | 'approve' | 'request_changes';

const STATE_BY_TYPE: Record<ReviewType, ReviewRow['state']> = {
  comment: 'commented',
  approve: 'approved',
  request_changes: 'changes_requested',
};

export async function currentDiffFingerprint(tx: Db, repo: RepoRow, change: ChangeRow): Promise<string> {
  const headRevision = (await getBranchRevision(tx, repo.id, change.headBranch))!;
  const files = combinedFiles(
    await getSnapshot(tx, repo.id, change.baseRevision),
    await getSnapshot(tx, repo.id, headRevision),
  );
  return diffFingerprint(files);
}

export async function submitReview(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  reviewer: UserRow,
  type: ReviewType,
  summary: string,
  sink: EventSink,
): Promise<number> {
  if (change.state === 'merged') throw conflict('This change is already merged');
  if (type === 'request_changes' && summary.trim() === '') {
    throw invalid('summary', 'A summary is required to request changes');
  }

  const fingerprint = type === 'approve' ? await currentDiffFingerprint(tx, repo, change) : null;
  const rows = await tx.query<{ id: string }>(
    `INSERT INTO rs_reviews (change_id, reviewer_user_id, type, state, summary, diff_fingerprint, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [change.id, reviewer.id, type, STATE_BY_TYPE[type], summary, fingerprint, serverNow()],
  );
  await tx.query('UPDATE rs_review_requests SET pending = false WHERE change_id = $1 AND user_id = $2', [
    change.id,
    reviewer.id,
  ]);

  if (type === 'approve') {
    sink.add({ kind: 'review', text: `#${change.number}: ${reviewer.name} approved`, change: change.number });
  } else if (type === 'request_changes') {
    sink.add({ kind: 'review', text: `#${change.number}: ${reviewer.name} requested changes`, change: change.number });
  } else {
    sink.add({ kind: 'rules', text: '', change: change.number });
  }
  await mailMentions(tx, repo, change, reviewer, summary);
  return Number(rows[0].id);
}

export async function dismissReview(
  tx: Db,
  change: ChangeRow,
  review: ReviewRow,
  reason: string,
  dismissedBy: UserRow,
  sink: EventSink,
): Promise<void> {
  if (review.state === 'dismissed') throw conflict('This review is already dismissed');
  if (reason.trim() === '') throw invalid('reason', 'A reason is required');
  await tx.query(
    `UPDATE rs_reviews SET state = 'dismissed', reason = $2, dismissal_kind = 'maintainer', dismissed_by_user_id = $3
     WHERE id = $1`,
    [review.id, reason, dismissedBy.id],
  );
  const reviewer = (await getUserById(tx, review.reviewerUserId))!;
  sink.add({
    kind: 'review-dismissed',
    text: `#${change.number}: review by ${reviewer.name} dismissed`,
    change: change.number,
  });
}

export async function requestReview(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  username: string,
): Promise<{ created: boolean; user: UserRow }> {
  const user = await getUserByUsername(tx, username);
  if (!user) throw notFound();
  const role = await roleFor(tx, repo, user.id);
  if (role === null) throw notFound();

  const pending = await tx.query('SELECT 1 FROM rs_review_requests WHERE change_id = $1 AND user_id = $2 AND pending = true', [
    change.id,
    user.id,
  ]);
  if (pending.length > 0) return { created: false, user };

  await tx.query('INSERT INTO rs_review_requests (change_id, user_id, pending, created_at) VALUES ($1, $2, true, $3)', [
    change.id,
    user.id,
    serverNow(),
  ]);
  await enqueueMail(tx, {
    to: user.email,
    subject: `[${repo.org}/${repo.name}] Review requested on #${change.number}: ${change.title}`,
    body: changeMailBody([
      `You were asked to review change #${change.number} ${change.title}.`,
      changeUrl(repo.org, repo.name, change.number),
    ]),
    changeHeader: `${repo.org}/${repo.name}#${change.number}`,
  });
  return { created: true, user };
}

/** Mails every mentioned user who can see the repository, once per comment. */
export async function mailMentions(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  author: UserRow,
  text: string,
): Promise<void> {
  const names = new Set<string>();
  for (const match of text.matchAll(/@([a-z][a-z0-9-]{1,31})/g)) {
    names.add(match[1]);
  }
  for (const username of names) {
    const user = await getUserByUsername(tx, username);
    if (!user || user.id === author.id) continue;
    const role = await roleFor(tx, repo, user.id);
    if (role === null) continue;
    await enqueueMail(tx, {
      to: user.email,
      subject: `[${repo.org}/${repo.name}] ${author.name} mentioned you on #${change.number}`,
      body: changeMailBody([
        `${author.name} mentioned you on change #${change.number} ${change.title}.`,
        changeUrl(repo.org, repo.name, change.number),
      ]),
      changeHeader: `${repo.org}/${repo.name}#${change.number}`,
    });
  }
}
