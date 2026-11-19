import type { Db } from '../server/db.js';

export type Role = 'reader' | 'writer' | 'maintainer' | 'owner';
export const ROLE_RANK: Record<Role, number> = { reader: 1, writer: 2, maintainer: 3, owner: 4 };

export interface UserRow {
  id: number;
  username: string;
  name: string;
  email: string;
}

export interface RepoRow {
  id: number;
  orgId: number;
  org: string;
  name: string;
  visibility: 'private' | 'public';
  defaultBranch: string;
  requiredApprovals: number;
  requiredChecks: string[];
  queueOn: boolean;
}

export type ChangeState = 'draft' | 'open' | 'queued' | 'merged' | 'removed';

export interface ChangeRow {
  id: number;
  repoId: number;
  number: number;
  title: string;
  description: string;
  authorUserId: number;
  headBranch: string;
  baseBranch: string;
  baseRevision: string;
  state: ChangeState;
  mergeRevision: string | null;
  removalReason: string | null;
  restackResult: string | null;
  restackNotice: string | null;
  restackNoticeKind: string | null;
  restackDismissedCount: number | null;
  createdAt: Date;
}

export interface ReviewRow {
  id: number;
  changeId: number;
  reviewerUserId: number;
  type: 'comment' | 'approve' | 'request_changes';
  state: 'commented' | 'approved' | 'changes_requested' | 'dismissed';
  summary: string;
  reason: string | null;
  dismissalKind: 'update' | 'maintainer' | null;
  dismissedByUserId: number | null;
  diffFingerprint: string | null;
  createdAt: Date;
}

const USER_COLUMNS = 'id, username, name, email';

function toUser(row: { id: string | number; username: string; name: string; email: string }): UserRow {
  return { id: Number(row.id), username: row.username, name: row.name, email: row.email };
}

export async function getUserById(tx: Db, id: number): Promise<UserRow | null> {
  const rows = await tx.query(`SELECT ${USER_COLUMNS} FROM rs_users WHERE id = $1`, [id]);
  return rows.length === 0 ? null : toUser(rows[0] as never);
}

export async function getUserByUsername(tx: Db, username: string): Promise<UserRow | null> {
  const rows = await tx.query(`SELECT ${USER_COLUMNS} FROM rs_users WHERE username = $1`, [username]);
  return rows.length === 0 ? null : toUser(rows[0] as never);
}

const REPO_SELECT = `SELECT r.id, r.org_id, o.slug AS org, r.name, r.visibility, r.default_branch,
  r.required_approvals, r.required_checks, r.queue_on
  FROM rs_repos r JOIN rs_orgs o ON o.id = r.org_id`;

interface RepoQueryRow {
  id: string;
  org_id: string;
  org: string;
  name: string;
  visibility: 'private' | 'public';
  default_branch: string;
  required_approvals: number;
  required_checks: string[];
  queue_on: boolean;
}

function toRepo(row: RepoQueryRow): RepoRow {
  return {
    id: Number(row.id),
    orgId: Number(row.org_id),
    org: row.org,
    name: row.name,
    visibility: row.visibility,
    defaultBranch: row.default_branch,
    requiredApprovals: Number(row.required_approvals),
    requiredChecks: row.required_checks,
    queueOn: row.queue_on,
  };
}

export async function getRepo(tx: Db, org: string, name: string): Promise<RepoRow | null> {
  const rows = await tx.query<RepoQueryRow>(`${REPO_SELECT} WHERE o.slug = $1 AND r.name = $2`, [org, name]);
  return rows.length === 0 ? null : toRepo(rows[0]);
}

export async function getRepoById(tx: Db, id: number): Promise<RepoRow | null> {
  const rows = await tx.query<RepoQueryRow>(`${REPO_SELECT} WHERE r.id = $1`, [id]);
  return rows.length === 0 ? null : toRepo(rows[0]);
}

export async function listAllRepos(tx: Db): Promise<RepoRow[]> {
  const rows = await tx.query<RepoQueryRow>(`${REPO_SELECT} ORDER BY o.slug, r.name`);
  return rows.map(toRepo);
}

export async function roleFor(tx: Db, repo: RepoRow, userId: number | null): Promise<Role | null> {
  if (userId === null) return null;
  const rows = await tx.query<{ role: Role }>(
    `SELECT role FROM rs_roles WHERE repo_id = $1 AND (
       (subject_type = 'user' AND subject_id = $2)
       OR (subject_type = 'team' AND subject_id IN (SELECT team_id FROM rs_team_members WHERE user_id = $2))
     )`,
    [repo.id, userId],
  );
  let best: Role | null = null;
  for (const row of rows) {
    if (best === null || ROLE_RANK[row.role] > ROLE_RANK[best]) best = row.role;
  }
  if (best === null && repo.visibility === 'public') return 'reader';
  return best;
}

export async function isOrgOwner(tx: Db, orgSlug: string, userId: number | null): Promise<boolean> {
  if (userId === null) return false;
  const rows = await tx.query('SELECT 1 FROM rs_orgs WHERE slug = $1 AND owner_user_id = $2', [orgSlug, userId]);
  return rows.length > 0;
}

interface ChangeQueryRow {
  id: string;
  repo_id: string;
  number: number;
  title: string;
  description: string;
  author_user_id: string;
  head_branch: string;
  base_branch: string;
  base_revision: string;
  state: ChangeState;
  merge_revision: string | null;
  removal_reason: string | null;
  restack_result: string | null;
  restack_notice: string | null;
  restack_notice_kind: string | null;
  restack_dismissed_count: number | null;
  created_at: Date;
}

function toChange(row: ChangeQueryRow): ChangeRow {
  return {
    id: Number(row.id),
    repoId: Number(row.repo_id),
    number: row.number,
    title: row.title,
    description: row.description,
    authorUserId: Number(row.author_user_id),
    headBranch: row.head_branch,
    baseBranch: row.base_branch,
    baseRevision: row.base_revision,
    state: row.state,
    mergeRevision: row.merge_revision,
    removalReason: row.removal_reason,
    restackResult: row.restack_result,
    restackNotice: row.restack_notice,
    restackNoticeKind: row.restack_notice_kind,
    restackDismissedCount: row.restack_dismissed_count === null ? null : Number(row.restack_dismissed_count),
    createdAt: row.created_at,
  };
}

const CHANGE_COLUMNS = `id, repo_id, number, title, description, author_user_id, head_branch, base_branch,
  base_revision, state, merge_revision, removal_reason, restack_result, restack_notice, restack_notice_kind,
  restack_dismissed_count, created_at`;

export async function getChange(tx: Db, repoId: number, number: number): Promise<ChangeRow | null> {
  const rows = await tx.query<ChangeQueryRow>(`SELECT ${CHANGE_COLUMNS} FROM rs_changes WHERE repo_id = $1 AND number = $2`, [
    repoId,
    number,
  ]);
  return rows.length === 0 ? null : toChange(rows[0]);
}

export async function getChangeById(tx: Db, id: number): Promise<ChangeRow | null> {
  const rows = await tx.query<ChangeQueryRow>(`SELECT ${CHANGE_COLUMNS} FROM rs_changes WHERE id = $1`, [id]);
  return rows.length === 0 ? null : toChange(rows[0]);
}

export async function listChanges(tx: Db, repoId: number): Promise<ChangeRow[]> {
  const rows = await tx.query<ChangeQueryRow>(`SELECT ${CHANGE_COLUMNS} FROM rs_changes WHERE repo_id = $1 ORDER BY number`, [
    repoId,
  ]);
  return rows.map(toChange);
}

export async function changesWithBaseBranch(tx: Db, repoId: number, branch: string): Promise<ChangeRow[]> {
  const rows = await tx.query<ChangeQueryRow>(
    `SELECT ${CHANGE_COLUMNS} FROM rs_changes WHERE repo_id = $1 AND base_branch = $2 AND state <> 'merged' ORDER BY number`,
    [repoId, branch],
  );
  return rows.map(toChange);
}

export async function changeForHeadBranch(tx: Db, repoId: number, branch: string): Promise<ChangeRow | null> {
  const rows = await tx.query<ChangeQueryRow>(
    `SELECT ${CHANGE_COLUMNS} FROM rs_changes WHERE repo_id = $1 AND head_branch = $2 AND state <> 'merged' ORDER BY number LIMIT 1`,
    [repoId, branch],
  );
  return rows.length === 0 ? null : toChange(rows[0]);
}

interface ReviewQueryRow {
  id: string;
  change_id: string;
  reviewer_user_id: string;
  type: ReviewRow['type'];
  state: ReviewRow['state'];
  summary: string;
  reason: string | null;
  dismissal_kind: ReviewRow['dismissalKind'];
  dismissed_by_user_id: string | null;
  diff_fingerprint: string | null;
  created_at: Date;
}

export async function listReviews(tx: Db, changeId: number): Promise<ReviewRow[]> {
  const rows = await tx.query<ReviewQueryRow>(
    `SELECT id, change_id, reviewer_user_id, type, state, summary, reason, dismissal_kind, dismissed_by_user_id,
            diff_fingerprint, created_at
     FROM rs_reviews WHERE change_id = $1 ORDER BY id`,
    [changeId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    changeId: Number(row.change_id),
    reviewerUserId: Number(row.reviewer_user_id),
    type: row.type,
    state: row.state,
    summary: row.summary,
    reason: row.reason,
    dismissalKind: row.dismissal_kind,
    dismissedByUserId: row.dismissed_by_user_id === null ? null : Number(row.dismissed_by_user_id),
    diffFingerprint: row.diff_fingerprint,
    createdAt: row.created_at,
  }));
}

/** Only each reviewer's latest approve or request-changes review counts. */
export function standingVerdicts(reviews: ReviewRow[]): Map<number, ReviewRow> {
  const verdicts = new Map<number, ReviewRow>();
  for (const review of reviews) {
    if (review.type === 'comment' || review.state === 'dismissed') continue;
    verdicts.set(review.reviewerUserId, review);
  }
  return verdicts;
}

export function currentApprovals(reviews: ReviewRow[]): ReviewRow[] {
  return [...standingVerdicts(reviews).values()].filter((review) => review.state === 'approved');
}

export function changesRequestedReviews(reviews: ReviewRow[]): ReviewRow[] {
  return [...standingVerdicts(reviews).values()].filter((review) => review.state === 'changes_requested');
}
