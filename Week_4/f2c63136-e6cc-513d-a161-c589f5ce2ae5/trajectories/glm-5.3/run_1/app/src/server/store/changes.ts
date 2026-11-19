import type { Tx, ChangeRow, RepoRow } from './revisions.js';
import { getChange, changeCombinedDiff, revisionFileTexts, getBranch, changeHeadRevision } from './revisions.js';
import { parseOwners, ownersFor } from '../../shared/owners.js';
import { byteOrder } from '../../shared/bytes.js';
import { diffSignature, mergeBoxRules, CheckStateWords, type ServiceDeps } from './domain.js';
import type { CombinedFile } from '../../shared/rules.js';
import { fileLevelApply } from '../../shared/rules.js';
import { splitLines, lineMovement } from '../../shared/lines.js';

export interface UserRow { id: number; username: string; email: string; name: string }

export async function getUserById(tx: Tx, id: number): Promise<UserRow | null> {
  const r = await tx.query('SELECT id, username, email, name FROM users WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

export async function getUserByUsername(tx: Tx, username: string): Promise<UserRow | null> {
  const r = await tx.query('SELECT id, username, email, name FROM users WHERE username = $1', [username]);
  return r.rows[0] ?? null;
}

export type Role = 'owner' | 'maintainer' | 'writer' | 'reader' | 'none';

const ROLE_RANK: Record<Role, number> = { owner: 4, maintainer: 3, writer: 2, reader: 1, none: 0 };

/** The highest role from any grant applies; public repos give every signed-in user reader. */
export async function roleFor(tx: Tx, repo: RepoRow, user: { id: number; username: string }): Promise<Role> {
  const direct = await tx.query(
    'SELECT role FROM repo_roles WHERE repo_id = $1 AND subject = $2',
    [repo.id, `user:${user.username}`],
  );
  let best: Role = 'none';
  if (direct.rows.length > 0) best = direct.rows[0].role as Role;
  const teams = await tx.query(
    `SELECT rr.role FROM repo_roles rr
     JOIN team_members tm ON tm.team_name = split_part(rr.subject, ':', 2) AND tm.user_id = $2
     WHERE rr.repo_id = $3 AND rr.subject LIKE 'team:%' AND tm.org_id = $1`,
    [repo.org_id, user.id, repo.id],
  );
  for (const t of teams.rows) {
    const role = t.role as Role;
    if (ROLE_RANK[role] > ROLE_RANK[best]) best = role;
  }
  if (best === 'none' && repo.visibility === 'public') return 'reader';
  return best;
}

/** Owners of the changed paths, read from the base revision. */
export async function codeOwnerPaths(
  tx: Tx, deps: ServiceDeps, change: ChangeRow, diff: CombinedFile[],
): Promise<{ paths: string[]; ownersByPath: Map<string, string[]> }> {
  const ownersRow = await tx.query(
    'SELECT key FROM revision_files WHERE repo_id = $1 AND revision_id = $2 AND path = $3',
    [change.repo_id, change.base_revision, '.review/OWNERS'],
  );
  const ownersByPath = new Map<string, string[]>();
  if (ownersRow.rowCount === 0) return { paths: [], ownersByPath };
  const text = await deps.storage.get(ownersRow.rows[0].key);
  const lines = parseOwners(text);
  const paths: string[] = [];
  for (const f of diff) {
    const owners = ownersFor(lines, f.path);
    if (owners === null || owners.length === 0) continue;
    ownersByPath.set(f.path, owners);
    paths.push(f.path);
  }
  return { paths: byteOrder(paths), ownersByPath };
}

/** Resolves owner subjects (users and teams) to user ids. */
export async function ownerUserIds(
  tx: Tx, repo: RepoRow, owners: string[],
): Promise<Set<number>> {
  const ids = new Set<number>();
  for (const owner of owners) {
    if (owner.startsWith('@')) {
      const name = owner.slice(1);
      if (name.includes('/')) {
        const team = name.split('/')[1];
        const members = await tx.query(
          'SELECT user_id FROM team_members WHERE org_id = $1 AND team_name = $2',
          [repo.org_id, team],
        );
        for (const m of members.rows) ids.add(m.user_id);
      } else {
        const u = await getUserByUsername(tx, name);
        if (u) ids.add(u.id);
      }
    }
  }
  return ids;
}

export interface CheckView { name: string; state: string; summary: string; required: boolean; timeoutAtMs: number | null }

/**
 * The checks view of a revision: every required name, then every other
 * reported name, in byte order, with timeout lines computed by the server.
 */
export async function checksForRevision(
  tx: Tx, deps: ServiceDeps, repo: RepoRow, revision: string, required: string[], revisionCreatedAtMs: number,
): Promise<CheckView[]> {
  const reports = await tx.query(
    'SELECT DISTINCT ON (name) name, state, summary FROM checks WHERE repo_id = $1 AND revision = $2 ORDER BY name, created_at_ms DESC, id DESC',
    [repo.id, revision],
  );
  const byName = new Map<string, { state: string; summary: string }>();
  for (const r of reports.rows) byName.set(r.name, { state: r.state, summary: r.summary });
  const names = new Set<string>([...required, ...byName.keys()]);
  const out: CheckView[] = [];
  for (const name of byteOrder([...names])) {
    const report = byName.get(name);
    const isRequired = required.includes(name);
    let state = report?.state ?? 'queued';
    let timeoutAtMs: number | null = null;
    if (isRequired && (state === 'queued' || state === 'in_progress')) {
      const deadline = revisionCreatedAtMs + deps.cfg.checkTimeoutSeconds * 1000;
      if (deps.clock.nowMs() >= deadline) state = 'timed_out';
      else timeoutAtMs = deadline;
    }
    out.push({ name, state, summary: report?.summary ?? '', required: isRequired, timeoutAtMs });
  }
  return out;
}

export interface MergeBoxView {
  rules: Array<{ rule: string; text: string }>;
  met: boolean;
  conflicting: boolean;
  conflictPaths: string[];
  approvals: Array<{ reviewer: string; name: string }>;
  changesRequested: Array<{ name: string }>;
  codeOwnerPaths: string[];
  checks: CheckView[];
}

/** The full merge box view of a change, computed from the records. */
export async function mergeBoxView(
  tx: Tx, deps: ServiceDeps, repo: RepoRow, change: ChangeRow, diff: CombinedFile[],
): Promise<MergeBoxView> {
  const headRev = await changeHeadRevision(tx, change);
  const headRevRow = await tx.query('SELECT created_at_ms FROM revisions WHERE repo_id = $1 AND id = $2', [repo.id, headRev]);
  const checks = await checksForRevision(tx, deps, repo, headRev, repo.required_checks, headRevRow.rows[0]?.created_at_ms ?? deps.clock.nowMs());
  const standing = await tx.query(
    `SELECT DISTINCT ON (reviewer_id) reviewer_id, type, state FROM reviews
     WHERE repo_id = $1 AND change_number = $2 AND type IN ('approve','request_changes') AND state IN ('approved','changes_requested')
     ORDER BY reviewer_id, created_at_ms DESC, id DESC`,
    [repo.id, change.number],
  );
  const approvals: Array<{ reviewer: string; name: string }> = [];
  const changesRequested: Array<{ name: string }> = [];
  for (const r of standing.rows) {
    const u = await getUserById(tx, r.reviewer_id);
    if (!u) continue;
    if (r.state === 'approved') approvals.push({ reviewer: u.username, name: u.name });
    else changesRequested.push({ name: u.name });
  }
  const { paths, ownersByPath } = await codeOwnerPaths(tx, deps, change, diff);
  const waitingPaths: string[] = [];
  const approvalUserIds = new Map<string, number>();
  for (const a of approvals) {
    const u = await getUserByUsername(tx, a.reviewer);
    if (u) approvalUserIds.set(a.reviewer, u.id);
  }
  for (const path of paths) {
    const ownerIds = await ownerUserIds(tx, repo, ownersByPath.get(path)!);
    let ok = false;
    for (const [, uid] of approvalUserIds) {
      if (ownerIds.has(uid) && uid !== change.author_id) { ok = true; break; }
    }
    if (!ok) waitingPaths.push(path);
  }
  // Conflict against the current base branch head.
  const baseBranch = await getBranch(tx, repo.id, change.base_branch);
  let conflicting = false;
  let conflictPaths: string[] = [];
  if (baseBranch) {
    const baseTexts = await revisionFileTexts(tx, deps.storage, repo.id, change.base_revision);
    const targetTexts = await revisionFileTexts(tx, deps.storage, repo.id, baseBranch.revision_id);
    const apply = fileLevelApply(diff, new Map(baseTexts), new Map(targetTexts));
    conflicting = !apply.ok;
    conflictPaths = apply.conflicts;
  }
  const rules = mergeBoxRules({
    change, repo, diff, conflicting, conflictPaths,
    approvals,
    changesRequested,
    codeOwnerPaths: waitingPaths,
    checks: checks.filter((c) => c.required),
  });
  return { rules, met: rules.length === 0, conflicting, conflictPaths, approvals, changesRequested, codeOwnerPaths: waitingPaths, checks };
}

/** Thread rows of a change with their comments. */
export async function threadViews(tx: Tx, repoId: number, changeNumber: number): Promise<Array<{
  id: number; path: string; side: string; line: number; end_line: number; state: string;
  outdated: boolean; revision: string; comments: Array<{
    id: number; author: string; body: string; created_at_ms: number;
    suggestion: { lines: string[]; state: string; line: number; end_line: number } | null;
  }>;
}>> {
  const threads = await tx.query(
    'SELECT * FROM threads WHERE repo_id = $1 AND change_number = $2 ORDER BY id',
    [repoId, changeNumber],
  );
  const out = [];
  for (const t of threads.rows) {
    const comments = await tx.query(
      'SELECT * FROM comments WHERE thread_id = $1 ORDER BY id',
      [t.id],
    );
    const commentViews = [];
    for (const c of comments.rows) {
      const author = await getUserById(tx, c.author_id);
      commentViews.push({
        id: c.id,
        author: author?.username ?? '',
        body: c.body,
        created_at_ms: c.created_at_ms,
        suggestion: c.suggestion_lines === null ? null : {
          lines: JSON.parse(c.suggestion_lines) as string[],
          state: c.suggestion_state,
          line: c.suggestion_line,
          end_line: c.suggestion_end_line,
        },
      });
    }
    out.push({
      id: t.id, path: t.path, side: t.side, line: t.line, end_line: t.end_line,
      state: t.state, outdated: t.outdated, revision: t.revision, comments: commentViews,
    });
  }
  return out;
}

/** The stack of a change, bottom to top. */
export async function stackOfChange(tx: Tx, change: ChangeRow): Promise<Array<{ number: number; title: string; state: string }>> {
  // Walk down to the bottom, then list upward.
  const chain: ChangeRow[] = [];
  let current: ChangeRow | null = change;
  while (current) {
    chain.unshift(current);
    const below: { rows: ChangeRow[] } = await tx.query(
      "SELECT * FROM changes WHERE repo_id = $1 AND head_branch = $2 AND number < $3 AND state IN ('draft','open','removed','queued') ORDER BY number DESC LIMIT 1",
      [change.repo_id, current.base_branch, current.number],
    );
    current = below.rows[0] ?? null;
  }
  // Walk up from the change itself.
  const upper: ChangeRow[] = [];
  let branch = change.head_branch;
  for (let i = 0; i < 64; i++) {
    const above = await tx.query(
      "SELECT * FROM changes WHERE repo_id = $1 AND base_branch = $2 AND number > $3 AND state IN ('draft','open','removed','queued') ORDER BY number ASC LIMIT 1",
      [change.repo_id, branch, chain.length ? chain[chain.length - 1].number : 0],
    );
    if (above.rows.length === 0) break;
    upper.push(above.rows[0]);
    branch = above.rows[0].head_branch;
  }
  return [...chain, ...upper].map((c) => ({ number: c.number, title: c.title, state: c.state }));
}
