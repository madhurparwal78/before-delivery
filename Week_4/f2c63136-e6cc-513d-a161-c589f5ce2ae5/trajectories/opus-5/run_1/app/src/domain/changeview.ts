import type { Db } from '../server/db.js';
import { applyChangeOnto } from './apply.js';
import { combinedFiles, diffFingerprint, type CombinedFile } from './combined.js';
import { CHECK_STATE_WORDS, checkRows, latestReports, type CheckRowView } from './checks.js';
import {
  changesRequestedReviews,
  changesWithBaseBranch,
  changeForHeadBranch,
  currentApprovals,
  getChange,
  getUserById,
  listReviews,
  type ChangeRow,
  type RepoRow,
  type ReviewRow,
  type UserRow,
} from './model.js';
import { OWNERS_PATH, ownersForPath, parseOwners, type OwnersLine } from './owners.js';
import { byteOrder, getBranchRevision, getRevision, getSnapshot, readFileText, type Snapshot } from './revisions.js';
import { loadThreads, type ThreadView } from './threads.js';
import { entryForChange, type QueueEntryRow } from './queue.js';

export interface MergeRule {
  rule: string;
  text: string;
}

export interface StackRow {
  number: number;
  position: number;
  title: string;
  state: string;
  restack: string;
  dismissedCount: number;
}

export interface ChangeView {
  repo: RepoRow;
  change: ChangeRow;
  author: UserRow;
  headRevision: string;
  baseBranchHead: string;
  files: CombinedFile[];
  conflicting: boolean;
  conflictPaths: string[];
  reviews: Array<{ review: ReviewRow; reviewer: UserRow }>;
  approvalCount: number;
  changesRequestedNames: string[];
  ownersWaiting: string[];
  checks: CheckRowView[];
  mergeRules: MergeRule[];
  counts: { filesViewed: number; filesTotal: number; unresolvedThreads: number; approvalsRemaining: number };
  stack: StackRow[];
  threads: ThreadView[];
  queueEntry: QueueEntryRow | null;
  requestedReviewers: UserRow[];
  diffFingerprint: string;
  viewedPaths: Set<string>;
  dismissedByName: Map<number, string>;
}

async function ownersLines(tx: Db, repo: RepoRow, baseRevision: string): Promise<OwnersLine[]> {
  try {
    const text = await readFileText(tx, repo.id, baseRevision, OWNERS_PATH);
    return text === null ? [] : parseOwners(text);
  } catch {
    return [];
  }
}

async function resolveOwnerUsers(tx: Db, tokens: string[]): Promise<Set<number>> {
  const users = new Set<number>();
  for (const token of tokens) {
    const body = token.startsWith('@') ? token.slice(1) : token;
    if (body.includes('/')) {
      const [orgSlug, teamName] = body.split('/');
      const rows = await tx.query<{ user_id: string }>(
        `SELECT tm.user_id FROM rs_team_members tm
         JOIN rs_teams t ON t.id = tm.team_id
         JOIN rs_orgs o ON o.id = t.org_id
         WHERE o.slug = $1 AND t.name = $2`,
        [orgSlug, teamName],
      );
      for (const row of rows) users.add(Number(row.user_id));
    } else {
      const rows = await tx.query<{ id: string }>('SELECT id FROM rs_users WHERE username = $1', [body]);
      for (const row of rows) users.add(Number(row.id));
    }
  }
  return users;
}

export async function ownerPathsWaiting(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  files: CombinedFile[],
  approvals: ReviewRow[],
): Promise<string[]> {
  const lines = await ownersLines(tx, repo, change.baseRevision);
  if (lines.length === 0) return [];
  const approverIds = new Set(approvals.map((review) => review.reviewerUserId));
  const waiting: string[] = [];
  for (const file of files) {
    const tokens = ownersForPath(lines, file.path);
    if (tokens.length === 0) continue;
    const ownerIds = await resolveOwnerUsers(tx, tokens);
    const satisfied = [...ownerIds].some((id) => approverIds.has(id));
    if (!satisfied) waiting.push(file.path);
  }
  return waiting.sort(byteOrder);
}

/** The merge box: the one place that decides which rules are unmet. */
export function mergeRulesFor(input: {
  repo: RepoRow;
  change: ChangeRow;
  conflictPaths: string[];
  approvalCount: number;
  changesRequestedNames: string[];
  ownersWaiting: string[];
  checks: CheckRowView[];
}): MergeRule[] {
  const rules: MergeRule[] = [];
  if (input.change.state === 'draft') {
    rules.push({ rule: 'draft', text: 'This change is a draft' });
  }
  if (input.conflictPaths.length > 0) {
    rules.push({
      rule: 'conflicting',
      text: `Conflicts with ${input.change.baseBranch}: ${input.conflictPaths.join(', ')}`,
    });
  }
  if (input.approvalCount < input.repo.requiredApprovals) {
    rules.push({
      rule: 'approvals',
      text: `Needs ${input.repo.requiredApprovals} approvals, has ${input.approvalCount}`,
    });
  }
  if (input.ownersWaiting.length > 0) {
    rules.push({ rule: 'code-owners', text: `Needs code owner approval for ${input.ownersWaiting.join(', ')}` });
  }
  if (input.changesRequestedNames.length > 0) {
    rules.push({ rule: 'changes-requested', text: `Changes requested by ${input.changesRequestedNames.join(', ')}` });
  }
  const notPassed = input.checks.filter((row) => row.required && row.state !== 'success');
  if (notPassed.length > 0) {
    rules.push({
      rule: 'checks',
      text: `Required checks not passed: ${notPassed
        .map((row) => `${row.name} (${CHECK_STATE_WORDS[row.state]})`)
        .join(', ')}`,
    });
  }
  if (rules.length === 0) return [{ rule: 'met', text: 'All merge rules are met' }];
  return rules;
}

export async function stackChain(tx: Db, repo: RepoRow, change: ChangeRow): Promise<ChangeRow[]> {
  const below: ChangeRow[] = [];
  let current = change;
  for (;;) {
    const lower = await changeForHeadBranch(tx, repo.id, current.baseBranch);
    if (!lower || lower.id === current.id || below.some((item) => item.id === lower.id)) break;
    below.unshift(lower);
    current = lower;
  }
  const above: ChangeRow[] = [];
  current = change;
  for (;;) {
    const upper = (await changesWithBaseBranch(tx, repo.id, current.headBranch))[0];
    if (!upper || upper.id === current.id || above.some((item) => item.id === upper.id)) break;
    above.push(upper);
    current = upper;
  }
  return [...below, change, ...above];
}

export async function changesAbove(tx: Db, repo: RepoRow, change: ChangeRow): Promise<ChangeRow[]> {
  return changesWithBaseBranch(tx, repo.id, change.headBranch);
}

export async function loadChangeView(
  tx: Db,
  repo: RepoRow,
  change: ChangeRow,
  viewerUserId: number | null,
): Promise<ChangeView> {
  const headRevision = (await getBranchRevision(tx, repo.id, change.headBranch))!;
  const baseBranchHead = (await getBranchRevision(tx, repo.id, change.baseBranch))!;
  const baseSnapshot = await getSnapshot(tx, repo.id, change.baseRevision);
  const headSnapshot = await getSnapshot(tx, repo.id, headRevision);
  const files = combinedFiles(baseSnapshot, headSnapshot);

  const targetSnapshot: Snapshot =
    baseBranchHead === change.baseRevision ? baseSnapshot : await getSnapshot(tx, repo.id, baseBranchHead);
  const applied = applyChangeOnto(baseSnapshot, headSnapshot, targetSnapshot);
  const conflictPaths = change.state === 'merged' || applied.ok ? [] : applied.conflicts;

  const reviewRows = await listReviews(tx, change.id);
  const reviews: Array<{ review: ReviewRow; reviewer: UserRow }> = [];
  const dismissedByName = new Map<number, string>();
  for (const review of reviewRows) {
    reviews.push({ review, reviewer: (await getUserById(tx, review.reviewerUserId))! });
    if (review.dismissedByUserId !== null) {
      dismissedByName.set(review.id, (await getUserById(tx, review.dismissedByUserId))!.name);
    }
  }
  const approvals = currentApprovals(reviewRows);
  const changesRequested = changesRequestedReviews(reviewRows);
  const changesRequestedNames = changesRequested
    .map((review) => reviews.find((item) => item.review.id === review.id)!.reviewer.name)
    .sort(byteOrder);

  const ownersWaiting =
    change.state === 'merged' ? [] : await ownerPathsWaiting(tx, repo, change, files, approvals);

  const headRevisionRecord = await getRevision(tx, repo.id, headRevision);
  const reports = await latestReports(tx, repo.id, headRevision);
  const checks = checkRows(
    repo.requiredChecks,
    reports,
    change.state === 'merged' ? null : headRevisionRecord!.createdAt,
  );

  const mergeRules = mergeRulesFor({
    repo,
    change,
    conflictPaths,
    approvalCount: approvals.length,
    changesRequestedNames,
    ownersWaiting,
    checks,
  });

  const threads = await loadThreads(tx, change.id);
  const unresolved = threads.filter((thread) => thread.state === 'unresolved').length;

  const viewedRows =
    viewerUserId === null
      ? []
      : await tx.query<{ path: string }>('SELECT path FROM rs_viewed WHERE change_id = $1 AND user_id = $2', [
          change.id,
          viewerUserId,
        ]);
  const viewedPaths = new Set(viewedRows.map((row) => row.path));
  const filesViewed = files.filter((file) => viewedPaths.has(file.path)).length;

  const chain = await stackChain(tx, repo, change);
  const stack: StackRow[] = chain.map((item, index) => ({
    number: item.number,
    position: index + 1,
    title: item.title,
    state: item.state,
    restack: item.restackResult ?? '',
    dismissedCount: item.restackDismissedCount ?? 0,
  }));

  const requestedRows = await tx.query<{ user_id: string }>(
    'SELECT user_id FROM rs_review_requests WHERE change_id = $1 AND pending = true ORDER BY id',
    [change.id],
  );
  const requestedReviewers: UserRow[] = [];
  for (const row of requestedRows) {
    requestedReviewers.push((await getUserById(tx, Number(row.user_id)))!);
  }

  return {
    repo,
    change,
    author: (await getUserById(tx, change.authorUserId))!,
    headRevision,
    baseBranchHead,
    files,
    conflicting: conflictPaths.length > 0,
    conflictPaths,
    reviews,
    approvalCount: approvals.length,
    changesRequestedNames,
    ownersWaiting,
    checks,
    mergeRules,
    counts: {
      filesViewed,
      filesTotal: files.length,
      unresolvedThreads: unresolved,
      approvalsRemaining: Math.max(0, repo.requiredApprovals - approvals.length),
    },
    stack,
    threads,
    queueEntry: await entryForChange(tx, change.id),
    requestedReviewers,
    diffFingerprint: diffFingerprint(files),
    viewedPaths,
    dismissedByName,
  };
}

export async function loadChangeViewByNumber(
  tx: Db,
  repo: RepoRow,
  number: number,
  viewerUserId: number | null,
): Promise<ChangeView | null> {
  const change = await getChange(tx, repo.id, number);
  if (!change) return null;
  return loadChangeView(tx, repo, change, viewerUserId);
}

export function changeObject(view: ChangeView): Record<string, unknown> {
  return {
    id: `${view.repo.org}/${view.repo.name}#${view.change.number}`,
    number: view.change.number,
    title: view.change.title,
    state: view.change.state,
    draft: view.change.state === 'draft',
    author: view.author.username,
    head: view.change.headBranch,
    base: view.change.baseBranch,
    base_revision: view.change.baseRevision,
    head_revision: view.headRevision,
    conflicting: view.conflicting,
    conflict_paths: view.conflictPaths,
    changes_requested: view.changesRequestedNames.length > 0,
    merge_rules: view.mergeRules,
    restack: {
      result: view.change.restackResult ?? null,
      dismissed_count: view.change.restackDismissedCount ?? 0,
      notice: view.change.restackNotice ?? null,
    },
    files: view.files.map((file) => ({ path: file.path, status: file.status })),
    counts: {
      files_viewed: view.counts.filesViewed,
      files_total: view.counts.filesTotal,
      unresolved_threads: view.counts.unresolvedThreads,
      approvals_remaining: view.counts.approvalsRemaining,
    },
    stack: view.stack.map((row) => ({
      number: row.number,
      position: row.position,
      title: row.title,
      state: row.state,
    })),
    queue_entry: view.queueEntry
      ? {
          id: view.queueEntry.id,
          change: view.change.number,
          state: view.queueEntry.state,
          position: view.queueEntry.position,
          revision: view.queueEntry.revisionId,
          reason: view.queueEntry.reason,
        }
      : null,
  };
}
