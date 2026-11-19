import type { Db, Row } from '../db.ts';
import { CHECK_WORD, type MergeRule } from '../../shared/types.ts';
import { applyChange, combinedDiff, type ChangedPath } from './combined.ts';
import { checkRows, latestReports, unmetChecks } from './checks.ts';
import { ownersOf, parseOwners, sortPaths } from './owners.ts';
import { Contents, loadRevision, loadSnap, type Snap } from './revisions.ts';
import { byteOrder } from './validate.ts';

interface ReviewRecord {
  id: number;
  reviewer_id: number;
  reviewer: string;
  reviewer_name: string;
  type: 'comment' | 'approve' | 'request_changes';
  state: 'commented' | 'approved' | 'changes_requested' | 'dismissed';
  diff_hash: string;
}

export async function loadReviews(db: Db, changeId: number): Promise<ReviewRecord[]> {
  return db.q<ReviewRecord>(
    `SELECT r.id, r.reviewer_id, u.username AS reviewer, u.name AS reviewer_name, r.type, r.state, r.diff_hash
       FROM reviews r JOIN users u ON u.id = r.reviewer_id WHERE r.change_id = $1 ORDER BY r.id`,
    [changeId],
  );
}

/**
 * Each reviewer's standing verdict: their latest approve or request-changes review, unless that one
 * was dismissed (a dismissed review is never revived by an earlier one).
 */
function standing(reviews: ReviewRecord[]): ReviewRecord[] {
  const latest = new Map<number, ReviewRecord>();
  for (const review of reviews) if (review.type !== 'comment') latest.set(review.reviewer_id, review);
  return [...latest.values()].filter((review) => review.state !== 'dismissed');
}

export interface BoxState {
  rules: MergeRule[];
  conflicting: boolean;
  conflictPaths: string[];
  changesRequested: boolean;
  approvals: number;
  changed: ChangedPath[];
  headSnap: Snap;
  baseSnap: Snap;
  storageDown: boolean;
}

async function ownersWaiting(db: Db, changed: ChangedPath[], baseSnap: Snap, approvers: ReviewRecord[]): Promise<string[]> {
  const file = baseSnap.get('.review/OWNERS');
  if (!file) return [];
  const lines = parseOwners((await new Contents().get(file.sha)).toString('utf8'));
  const approving = new Set(approvers.map((review) => review.reviewer));
  const teamMembers = new Map<string, Set<string>>();
  const waiting: string[] = [];
  for (const { path } of changed) {
    const owners = ownersOf(lines, path);
    if (!owners.length) continue;
    let satisfied = false;
    for (const owner of owners) {
      if (!owner.includes('/')) {
        satisfied ||= approving.has(owner);
        continue;
      }
      if (!teamMembers.has(owner)) {
        const [org, team] = owner.split('/');
        const rows = await db.q<Row>(
          `SELECT u.username FROM team_members tm JOIN teams t ON t.id = tm.team_id JOIN orgs o ON o.id = t.org_id
             JOIN users u ON u.id = tm.user_id WHERE o.slug = $1 AND t.name = $2`,
          [org, team],
        );
        teamMembers.set(owner, new Set(rows.map((row) => row.username)));
      }
      satisfied ||= [...teamMembers.get(owner)!].some((member) => approving.has(member));
    }
    if (!satisfied) waiting.push(path);
  }
  return sortPaths(waiting);
}

/** The merge box: every unmet rule in its fixed order. The one place the rules are decided. */
export async function mergeBox(db: Db, repo: Row, change: Row, reviews: ReviewRecord[]): Promise<BoxState> {
  const baseSnap = await loadSnap(db, repo.id, change.base_revision);
  const headSnap = await loadSnap(db, repo.id, change.head_revision);
  const changed = combinedDiff(baseSnap, headSnap);
  const target = (await db.q<Row>('SELECT revision FROM branches WHERE repo_id = $1 AND name = $2', [repo.id, change.base]))[0];
  const applied = applyChange(baseSnap, headSnap, await loadSnap(db, repo.id, target.revision));
  const conflictPaths = applied.ok ? [] : applied.conflicts;
  const verdicts = standing(reviews);
  const approvers = verdicts.filter((review) => review.type === 'approve');
  const requesters = verdicts.filter((review) => review.type === 'request_changes');
  const rules: MergeRule[] = [];
  if (change.state === 'draft') rules.push({ rule: 'draft', text: 'This change is a draft' });
  if (conflictPaths.length) rules.push({ rule: 'conflicting', text: `Conflicts with ${change.base}: ${conflictPaths.join(', ')}` });
  if (approvers.length < repo.required_approvals) {
    rules.push({ rule: 'approvals', text: `Needs ${repo.required_approvals} approvals, has ${approvers.length}` });
  }
  let storageDown = false;
  try {
    const waiting = await ownersWaiting(db, changed, baseSnap, approvers);
    if (waiting.length) rules.push({ rule: 'code-owners', text: `Needs code owner approval for ${waiting.join(', ')}` });
  } catch {
    storageDown = true;
  }
  if (requesters.length) {
    rules.push({ rule: 'changes-requested', text: `Changes requested by ${requesters.map((review) => review.reviewer_name).sort(byteOrder).join(', ')}` });
  }
  const headRow = (await loadRevision(db, repo.id, change.head_revision))!;
  const rows = checkRows(await latestReports(db, repo.id, change.head_revision), repo.required_checks, headRow.created_at, change.state !== 'merged');
  const unmet = unmetChecks(rows, repo.required_checks);
  if (unmet.length) {
    rules.push({ rule: 'checks', text: `Required checks not passed: ${unmet.map((row) => `${row.name} (${CHECK_WORD[row.state]})`).join(', ')}` });
  }
  if (!rules.length) rules.push({ rule: 'met', text: 'All merge rules are met' });
  return {
    rules,
    conflicting: conflictPaths.length > 0,
    conflictPaths,
    changesRequested: requesters.length > 0,
    approvals: approvers.length,
    changed,
    headSnap,
    baseSnap,
    storageDown,
  };
}

export const isMet = (box: BoxState): boolean => box.rules.length === 1 && box.rules[0].rule === 'met';
