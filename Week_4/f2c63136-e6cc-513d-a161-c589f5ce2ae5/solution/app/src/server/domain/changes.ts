import type { Db, Row } from '../db.ts';
import { iso } from '../clock.ts';
import { workspaceTime } from '../format.ts';
import { notFound } from '../errors.ts';
import { checkRows, latestReports } from './checks.ts';
import { loadReviews, mergeBox, type BoxState } from './rules.ts';
import { entryState } from './queue.ts';
import { loadRevision } from './revisions.ts';
import { stackOf, unmergedChanges } from './stack.ts';
import type {
  ChangeObject, ChangeView, CommentView, NoticeKind, QueueEntryObject, ReviewView, StackRow, ThreadView, TimeView, Viewer,
} from '../../shared/types.ts';
import type { RepoAccess } from './access.ts';
import { atLeast } from './access.ts';

export const timeView = (date: Date): TimeView => ({ iso: iso(date), shown: workspaceTime(date) });

export async function loadChange(db: Db, repo: Row, number: number): Promise<Row> {
  const rows = await db.q<Row>(
    `SELECT c.*, u.username AS author_username, u.name AS author_name FROM changes c JOIN users u ON u.id = c.author_id WHERE c.repo_id = $1 AND c.number = $2`,
    [repo.id, number],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

export function parseNumber(text: string): number {
  if (!/^[1-9][0-9]*$/.test(text) || text.length > 9) throw notFound();
  return Number(text);
}

async function stackFor(db: Db, repo: Row, change: Row): Promise<Row[]> {
  if (change.state === 'merged') return [change];
  return stackOf(await unmergedChanges(db, repo.id), change);
}

async function queueObject(db: Db, repo: Row, change: Row): Promise<QueueEntryObject | null> {
  const entry = (await db.q<Row>(`SELECT * FROM queue_entries WHERE change_id = $1 ORDER BY id DESC LIMIT 1`, [change.id]))[0];
  if (!entry) return null;
  const state = entry.status === 'active' ? (await entryState(db, repo, entry)).state : entry.status;
  return { id: entry.id, change: change.number, state, position: entry.position, revision: entry.revision, reason: entry.reason };
}

function boxFor(db: Db, repo: Row, change: Row, reviews: Awaited<ReturnType<typeof loadReviews>>): Promise<BoxState> {
  return mergeBox(db, repo, change, reviews);
}

/** The change object of the API; the merge box, counts and stack are computed from the records on every read. */
export async function changeObject(db: Db, repo: Row, change: Row, viewerId: number | null, precomputed?: BoxState): Promise<ChangeObject> {
  const reviews = await loadReviews(db, change.id);
  const merged = change.state === 'merged';
  const box = precomputed ?? (await boxFor(db, repo, change, reviews));
  const stack = await stackFor(db, repo, change);
  const unresolved = (await db.q<Row>(`SELECT count(*)::int AS n FROM threads WHERE change_id = $1 AND state = 'unresolved'`, [change.id]))[0].n;
  const marks = viewerId
    ? await db.q<Row>('SELECT path FROM viewed WHERE change_id = $1 AND user_id = $2', [change.id, viewerId])
    : [];
  const inDiff = new Set(box.changed.map((file) => file.path));
  return {
    id: `${repo.org_slug}/${repo.name}#${change.number}`,
    number: change.number,
    title: change.title,
    state: change.state,
    draft: change.state === 'draft',
    author: change.author_username,
    head: change.head,
    base: change.base,
    base_revision: change.base_revision,
    head_revision: change.head_revision,
    conflicting: !merged && box.conflicting,
    conflict_paths: merged ? [] : box.conflictPaths,
    changes_requested: box.changesRequested,
    merge_rules: merged ? [] : box.rules,
    restack: { result: change.restack_result, dismissed_count: change.restack_result === 'conflicting' ? 0 : change.restack_dismissed, notice: change.restack_notice },
    files: box.changed.map((file) => ({ path: file.path, status: file.status })),
    counts: {
      files_viewed: marks.filter((mark) => inDiff.has(mark.path)).length,
      files_total: box.changed.length,
      unresolved_threads: unresolved,
      approvals_remaining: Math.max(0, repo.required_approvals - box.approvals),
    },
    stack: stack.map((row, index) => ({ number: row.number, position: index + 1, title: row.title, state: row.state })),
    queue_entry: await queueObject(db, repo, change),
  };
}

function reviewView(row: Row): ReviewView {
  const dismissedText = row.state !== 'dismissed' ? null : row.dismissed_by ? `Dismissed by ${row.dismisser_name}: ${row.reason}` : 'Dismissed: the change was updated after this approval';
  return {
    id: row.id,
    reviewer: row.username,
    reviewer_name: row.name,
    type: row.type,
    state: row.state,
    summary: row.summary,
    dismissed_text: dismissedText,
    created_at: timeView(row.created_at),
  };
}

export async function threadViewsFor(db: Db, changeId: number, onlyId?: number): Promise<ThreadView[]> {
  const threads = await db.q<Row>('SELECT * FROM threads WHERE change_id = $1 AND ($2::bigint IS NULL OR id = $2) ORDER BY path COLLATE "C", line, id', [changeId, onlyId ?? null]);
  const comments = await db.q<Row>(
    `SELECT c.*, u.username, u.name FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.thread_id = ANY($1) ORDER BY c.id`,
    [threads.map((thread) => thread.id)],
  );
  return threads.map((thread) => ({
    id: thread.id,
    path: thread.path,
    side: thread.side,
    line: thread.line,
    end_line: thread.end_line,
    state: thread.state,
    outdated: thread.outdated,
    revision: thread.revision,
    comments: comments
      .filter((comment) => comment.thread_id === thread.id)
      .map((comment): CommentView => ({
        id: comment.id,
        author: comment.username,
        author_name: comment.name,
        body: comment.body,
        created_at: timeView(comment.created_at),
        suggestion: comment.suggestion ? { lines: comment.suggestion, state: comment.suggestion_state } : null,
      })),
  }));
}

function viewerOf(access: RepoAccess, change: Row): Viewer {
  const user = access.user!;
  const isAuthor = change.author_id === user.id;
  return {
    username: user.username,
    name: user.name,
    role: access.role,
    is_author: isAuthor,
    can_write: atLeast(access.role, 'writer'),
    can_maintain: atLeast(access.role, 'maintainer'),
    approve_block: !atLeast(access.role, 'writer') ? 'Readers cannot approve or request changes' : isAuthor ? 'You cannot approve your own change' : null,
    request_block: !atLeast(access.role, 'writer') ? 'Readers cannot approve or request changes' : null,
  };
}

export async function changeView(db: Db, access: RepoAccess, change: Row): Promise<ChangeView> {
  const repo = access.repo;
  const user = access.user!;
  const reviewRecords = await loadReviews(db, change.id);
  const box = await boxFor(db, repo, change, reviewRecords);
  const object = await changeObject(db, repo, change, user.id, box);
  const reviewRows = await db.q<Row>(
    `SELECT r.*, u.username, u.name, d.name AS dismisser_name FROM reviews r JOIN users u ON u.id = r.reviewer_id
       LEFT JOIN users d ON d.id = r.dismissed_by WHERE r.change_id = $1 ORDER BY r.id`,
    [change.id],
  );
  const requested = await db.q<Row>(
    `SELECT u.username, u.name FROM review_requests q JOIN users u ON u.id = q.user_id WHERE q.change_id = $1 AND q.pending ORDER BY q.id`,
    [change.id],
  );
  const headRevision = (await loadRevision(db, repo.id, change.head_revision))!;
  const checks = checkRows(await latestReports(db, repo.id, change.head_revision), repo.required_checks, headRevision.created_at, change.state !== 'merged');
  const marks = await db.q<Row>('SELECT path FROM viewed WHERE change_id = $1 AND user_id = $2', [change.id, user.id]);
  const all = change.state === 'merged' ? [change] : await stackFor(db, repo, change);
  const stack: StackRow[] = all.map((row, index) => ({
    number: row.number,
    position: index + 1,
    title: row.title,
    state: row.state,
    restack: { result: row.restack_result, dismissed_count: row.restack_dismissed },
  }));
  const entry = object.queue_entry;
  return {
    change: object,
    repo: { id: repo.id, org: repo.org_slug, name: repo.name, queue: repo.queue, required_checks: repo.required_checks, required_approvals: repo.required_approvals },
    viewer: viewerOf(access, change),
    reviews: reviewRows.map(reviewView),
    threads: await threadViewsFor(db, change.id),
    requested: requested.map((row) => ({ username: row.username, name: row.name })),
    checks,
    stack,
    notice: change.restack_notice_kind ? { kind: change.restack_notice_kind as NoticeKind, text: change.restack_notice } : null,
    viewed: marks.map((mark) => mark.path),
    queue_position: change.state === 'queued' && entry ? entry.position : null,
    merged_into: change.state === 'merged' ? { branch: change.base, revision: change.merge_revision } : null,
    storage_down: box.storageDown,
  };
}

