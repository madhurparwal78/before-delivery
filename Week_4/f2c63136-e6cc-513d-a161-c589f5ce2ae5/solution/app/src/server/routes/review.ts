import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { config } from '../config.ts';
import { db, transaction, type Row, type Tx } from '../db.ts';
import { now, wholeSecond } from '../clock.ts';
import { conflict, forbidden, invalid, notFound, StorageDown } from '../errors.ts';
import { asObject, errorReply, mentions, readBody, reply, usable, type Body, type Ctx, type Json, type Router } from '../http.ts';
import { queueMail } from '../mail.ts';
import { atLeast, authenticate, canSee, repoAccess, requireMaintainer, requireWrite, userByName, type RepoAccess } from '../domain/access.ts';
import { changeObject, changeView, loadChange, parseNumber, threadViewsFor, timeView } from '../domain/changes.ts';
import { combinedDiff, diffHash } from '../domain/combined.ts';
import { changeDiff } from '../domain/diffing.ts';
import { Events } from '../domain/events.ts';
import { enqueue, moveEntry, queueView, removeEntry } from '../domain/queue.ts';
import { Contents, createRevision, loadSnap, storeBytes, type Snap } from '../domain/revisions.ts';
import { isMet, loadReviews, mergeBox } from '../domain/rules.ts';
import { headAdvanced, mergeChange, stackNumbers, unmergedChanges } from '../domain/stack.ts';
import { applyEdits, locateRange, newThread, StaleSuggestion, type SuggestionEdit } from '../domain/threads.ts';
import { subscribe } from '../live.ts';
import { authorOf } from './code.ts';
import type { ThreadView } from '../../shared/types.ts';

const isString = (value: unknown): value is string => typeof value === 'string';
const MERGED = 'This change is already merged';

async function touchStack(tx: Tx, repo: Row, change: Row, events: Events): Promise<void> {
  events.touch(change.state === 'merged' ? [change.number] : stackNumbers(await unmergedChanges(tx, repo.id), change));
}

async function notifyMentions(tx: Tx, access: RepoAccess, change: Row, text: string): Promise<void> {
  for (const username of mentions(text)) {
    const target = await userByName(tx, username);
    if (!target || target.id === access.user!.id || !(await canSee(tx, access.repo, target.id))) continue;
    await queueMail(tx, {
      to: target.email,
      subject: `[${access.org.slug}/${access.repo.name}] ${access.user!.name} mentioned you on #${change.number}`,
      body: `${access.user!.name} mentioned you on #${change.number} "${change.title}":\n\n${text}\n\n${config.publicUrl}/${access.org.slug}/${access.repo.name}/changes/${change.number}\n`,
      changeId: `${access.org.slug}/${access.repo.name}#${change.number}`,
    });
  }
}

function apiThread(thread: ThreadView) {
  return {
    ...thread,
    comments: thread.comments.map((comment) => ({
      id: comment.id, author: comment.author, body: comment.body, created_at: comment.created_at.iso, suggestion: comment.suggestion,
    })),
  };
}

const oneThread = async (changeId: number, threadId: number): Promise<ThreadView> => (await threadViewsFor(db, changeId, threadId))[0];

const entryObject = (entry: { id: number; change: number; state: string; position: number | null; revision: string; reason: string | null }) => ({
  id: entry.id, change: entry.change, state: entry.state, position: entry.position, revision: entry.revision, reason: entry.reason,
});

const freshRepo = async (tx: Tx, id: number): Promise<Row> =>
  (await tx.q<Row>('SELECT r.*, o.slug AS org_slug FROM repos r JOIN orgs o ON o.id = r.org_id WHERE r.id = $1', [id]))[0];

// ---- operations: shared by the routes and the grading steps; permission checks live in the routes ----

export async function opCreateChange(access: RepoAccess, input: Json): Promise<Row> {
  const repo = access.repo;
  const head = isString(input.head) ? input.head : '';
  const base = isString(input.base) ? input.base : '';
  const branches = await db.q<Row>('SELECT name, revision FROM branches WHERE repo_id = $1 AND name = ANY($2)', [repo.id, [head, base]]);
  const baseRow = branches.find((row) => row.name === base);
  const headRow = branches.find((row) => row.name === head);
  if (!headRow || !baseRow) throw notFound();
  if ((await db.q(`SELECT 1 FROM changes WHERE repo_id = $1 AND head = $2 AND state <> 'merged'`, [repo.id, head])).length) {
    throw conflict(`An open change already exists for branch ${head}`);
  }
  const errors: Record<string, string> = {};
  if (head === base) errors.head = 'Head and base must differ';
  const title = isString(input.title) ? input.title.trim() : '';
  if (title.length < 1 || title.length > 200) errors.title = 'Title must be 1 to 200 characters';
  if (Object.keys(errors).length) throw invalid(errors);
  return transaction(async (tx) => {
    await tx.lockRepo(repo.id);
    if ((await tx.q(`SELECT 1 FROM changes WHERE repo_id = $1 AND head = $2 AND state <> 'merged'`, [repo.id, head])).length) {
      throw conflict(`An open change already exists for branch ${head}`);
    }
    const number = (await tx.q<Row>('SELECT coalesce(max(number), 0) + 1 AS n FROM changes WHERE repo_id = $1', [repo.id]))[0].n;
    const row = (
      await tx.q<Row>(
        `INSERT INTO changes (repo_id, number, title, description, author_id, head, base, base_revision, head_revision, state, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [repo.id, number, title, isString(input.description) ? input.description : '', access.user!.id, head, base, baseRow.revision, headRow.revision,
          input.draft === true ? 'draft' : 'open', wholeSecond(now())],
      )
    )[0];
    const events = new Events();
    await touchStack(tx, repo, row, events);
    events.emit(tx, repo.id);
    return { ...row, author_username: access.user!.username };
  });
}

export async function opReady(access: RepoAccess, change: Row): Promise<void> {
  if (change.state !== 'draft') throw conflict('This change is not a draft');
  await transaction(async (tx) => {
    await tx.q(`UPDATE changes SET state = 'open' WHERE id = $1`, [change.id]);
    const events = new Events();
    await touchStack(tx, access.repo, change, events);
    events.emit(tx, access.repo.id);
  });
}

export async function opRequestReview(access: RepoAccess, change: Row, target: { id: number; email: string }): Promise<boolean> {
  return transaction(async (tx) => {
    await tx.lockRepo(access.repo.id);
    if ((await tx.q('SELECT 1 FROM review_requests WHERE change_id = $1 AND user_id = $2 AND pending', [change.id, target.id])).length) return false;
    await tx.q('INSERT INTO review_requests (change_id, user_id) VALUES ($1, $2)', [change.id, target.id]);
    await queueMail(tx, {
      to: target.email,
      subject: `[${access.org.slug}/${access.repo.name}] Review requested on #${change.number}: ${change.title}`,
      body: `${access.user!.name} asked you to review #${change.number} "${change.title}".\n\n${config.publicUrl}/${access.org.slug}/${access.repo.name}/changes/${change.number}\n`,
      changeId: `${access.org.slug}/${access.repo.name}#${change.number}`,
    });
    const events = new Events();
    await touchStack(tx, access.repo, change, events);
    events.emit(tx, access.repo.id);
    return true;
  });
}

export async function opThread(access: RepoAccess, change: Row, input: Json): Promise<number> {
  if (change.state === 'merged') throw conflict(MERGED);
  const errors: Record<string, string> = {};
  const path = isString(input.path) ? input.path : '';
  const side = input.side;
  if (side !== 'old' && side !== 'new') errors.side = 'side is required';
  const line = input.line as number;
  if (!Number.isInteger(line) || line < 1) errors.line = 'line is required';
  const endLine = (input.end_line === undefined || input.end_line === null ? line : input.end_line) as number;
  if (!Number.isInteger(endLine) || endLine < line) errors.end_line = 'end_line is required';
  const text = isString(input.body) ? input.body : '';
  if (text.trim() === '') errors.body = 'Comment cannot be empty';
  let suggestion: string[] | null = null;
  if (input.suggestion !== undefined && input.suggestion !== null) {
    const lines = asObject(input.suggestion).lines;
    if (side === 'old') errors.suggestion = 'Suggestions are only possible on new lines';
    else if (Array.isArray(lines) && lines.every(isString)) suggestion = lines;
    else errors.suggestion = 'lines is required';
  }
  if (!Object.keys(errors).length) {
    const [file] = await changeDiff(db, access.repo, change, new Contents(), path);
    const rows = new Set(file?.hunks.flatMap((hunk) => hunk.rows).filter((row) => row.kind !== 'hunk').map((row) => (side === 'old' ? row.old_line : row.new_line)));
    const covered = file && Array.from({ length: endLine - line + 1 }, (_, i) => line + i).every((n) => rows.has(n));
    if (!covered) errors.line = `Line ${line} is not in the diff`;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return transaction(async (tx) => {
    const ids = await newThread(tx, change, { path, side: side as 'old' | 'new', line, endLine, authorId: access.user!.id, body: text, suggestion });
    const events = new Events();
    events.say(`#${change.number}: new comment from ${access.user!.name}`);
    await touchStack(tx, access.repo, change, events);
    events.emit(tx, access.repo.id);
    await notifyMentions(tx, access, change, text);
    return ids.threadId;
  });
}

async function opReply(access: RepoAccess, change: Row, threadId: number, input: Json): Promise<number> {
  const text = isString(input.body) ? input.body : '';
  if (text.trim() === '') throw invalid({ body: 'Comment cannot be empty' });
  return transaction(async (tx) => {
    const row = (await tx.q<Row>('INSERT INTO comments (thread_id, author_id, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id', [threadId, access.user!.id, text, wholeSecond(now())]))[0];
    const events = new Events();
    events.say(`#${change.number}: new comment from ${access.user!.name}`);
    await touchStack(tx, access.repo, change, events);
    events.emit(tx, access.repo.id);
    await notifyMentions(tx, access, change, text);
    return row.id;
  });
}

async function opApply(access: RepoAccess, change: Row, ids: number[]): Promise<{ revision: string; message: string }> {
  const comments = await db.q<Row>(
    `SELECT c.*, t.path, t.revision AS anchor_revision, t.anchor_line, t.anchor_end_line FROM comments c JOIN threads t ON t.id = c.thread_id
      WHERE t.change_id = $1 AND c.id = ANY($2)`,
    [change.id, ids],
  );
  if (comments.length !== new Set(ids).size) throw notFound();
  if (change.state === 'merged') throw conflict(MERGED);
  const plain = ids.map((id) => comments.find((comment) => comment.id === id)!).find((comment) => !comment.suggestion);
  if (plain) throw invalid({ comments: `Comment ${plain.id} has no suggestion` });
  if (comments.some((comment) => comment.suggestion_state === 'applied')) throw conflict('This suggestion was already applied');
  return transaction(async (tx) => {
    await tx.lockRepo(access.repo.id);
    if ((await tx.q(`SELECT 1 FROM comments WHERE id = ANY($1) AND suggestion_state = 'applied'`, [comments.map((comment) => comment.id)])).length) {
      throw conflict('This suggestion was already applied');
    }
    const fresh = await loadChange(tx, access.repo, change.number);
    const contents = new Contents();
    const headSnap = await loadSnap(tx, access.repo.id, fresh.head_revision);
    const edits = new Map<string, SuggestionEdit[]>();
    try {
      for (const comment of comments) {
        const was = (await loadSnap(tx, access.repo.id, comment.anchor_revision)).get(comment.path);
        const current = headSnap.get(comment.path);
        if (!was || !current) throw new StaleSuggestion(comment.anchor_line);
        const range = locateRange((await contents.get(was.sha)).toString('utf8'), (await contents.get(current.sha)).toString('utf8'), comment.anchor_line, comment.anchor_end_line);
        edits.set(comment.path, [...(edits.get(comment.path) ?? []), { path: comment.path, ...range, lines: comment.suggestion }]);
      }
    } catch (error) {
      throw error instanceof StaleSuggestion ? conflict(error.message) : error;
    }
    const next: Snap = new Map(headSnap);
    for (const [path, list] of edits) {
      const text = applyEdits((await contents.get(headSnap.get(path)!.sha)).toString('utf8'), list);
      next.set(path, await storeBytes(Buffer.from(text, 'utf8'), contents));
    }
    const message = comments.length === 1 ? 'Apply 1 suggestion' : `Apply ${comments.length} suggestions`;
    const revision = await createRevision(tx, access.repo.id, { parents: [fresh.head_revision], message, snap: next, author: authorOf(access) }, contents);
    await tx.q('UPDATE branches SET revision = $1 WHERE repo_id = $2 AND name = $3', [revision, access.repo.id, fresh.head]);
    await tx.q(`UPDATE comments SET suggestion_state = 'applied' WHERE id = ANY($1)`, [comments.map((comment) => comment.id)]);
    const events = new Events();
    await headAdvanced(tx, access.repo, fresh, fresh.head_revision, authorOf(access), contents, events, (entry, reason) => removeEntry(tx, access.repo, entry, reason, contents, events));
    events.emit(tx, access.repo.id);
    return { revision, message };
  });
}

export async function opReview(access: RepoAccess, change: Row, input: Json): Promise<Row> {
  const type = input.type;
  if (type !== 'comment' && type !== 'approve' && type !== 'request_changes') throw invalid({ type: 'Type must be one of comment, approve, request_changes' });
  if (change.state === 'merged') throw conflict(MERGED);
  const summary = isString(input.summary) ? input.summary : '';
  if (type === 'request_changes' && summary.trim() === '') throw invalid({ summary: 'A summary is required to request changes' });
  return transaction(async (tx) => {
    const repo = access.repo;
    const diff = diffHash(combinedDiff(await loadSnap(tx, repo.id, change.base_revision), await loadSnap(tx, repo.id, change.head_revision)));
    const state = type === 'approve' ? 'approved' : type === 'request_changes' ? 'changes_requested' : 'commented';
    const row = (
      await tx.q<Row>(
        `INSERT INTO reviews (change_id, reviewer_id, type, state, summary, diff_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [change.id, access.user!.id, type, state, summary, diff, wholeSecond(now())],
      )
    )[0];
    await tx.q('UPDATE review_requests SET pending = false WHERE change_id = $1 AND user_id = $2', [change.id, access.user!.id]);
    const events = new Events();
    if (type === 'approve') events.say(`#${change.number}: ${access.user!.name} approved`);
    if (type === 'request_changes') events.say(`#${change.number}: ${access.user!.name} requested changes`);
    await touchStack(tx, repo, change, events);
    events.emit(tx, repo.id);
    await notifyMentions(tx, access, change, summary);
    return row;
  });
}

export async function opDismiss(access: RepoAccess, change: Row, review: Row, input: Json): Promise<string> {
  if (review.state === 'dismissed') throw conflict('This review is already dismissed');
  if (review.type === 'comment') throw conflict('Only approvals and change requests can be dismissed');
  const reason = isString(input.reason) ? input.reason.trim() : '';
  if (!reason) throw invalid({ reason: 'A reason is required' });
  const reviewer = (await db.q<Row>('SELECT name FROM users WHERE id = $1', [review.reviewer_id]))[0];
  await transaction(async (tx) => {
    const done = await tx.q(`UPDATE reviews SET state = 'dismissed', reason = $1, dismissed_by = $2 WHERE id = $3 AND state <> 'dismissed' RETURNING id`, [reason, access.user!.id, review.id]);
    if (!done.length) throw conflict('This review is already dismissed');
    const events = new Events();
    events.say(`#${change.number}: review by ${reviewer.name} dismissed`);
    await touchStack(tx, access.repo, change, events);
    events.emit(tx, access.repo.id);
  });
  return reason;
}

export async function opViewed(access: RepoAccess, change: Row, path: string, viewed: boolean): Promise<void> {
  const changed = combinedDiff(await loadSnap(db, access.repo.id, change.base_revision), await loadSnap(db, access.repo.id, change.head_revision));
  if (!changed.some((file) => file.path === path)) throw invalid({ path: 'Path is not in this change' });
  if (viewed) await db.q('INSERT INTO viewed (change_id, user_id, path) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [change.id, access.user!.id, path]);
  else await db.q('DELETE FROM viewed WHERE change_id = $1 AND user_id = $2 AND path = $3', [change.id, access.user!.id, path]);
}

export async function opQueue(access: RepoAccess, change: Row): Promise<Row> {
  return transaction(async (tx) => {
    await tx.lockRepo(access.repo.id);
    const fresh = await loadChange(tx, access.repo, change.number);
    const repo = await freshRepo(tx, access.repo.id);
    if (fresh.state === 'merged') throw conflict(MERGED);
    if (fresh.state === 'queued') throw conflict('This change is already in the merge queue');
    if (!repo.queue) throw conflict('This repository does not use a merge queue');
    if (fresh.base !== 'main') throw conflict('Only changes based on main can join the merge queue');
    if (fresh.state === 'draft') throw conflict('A draft change cannot join the merge queue');
    const box = await mergeBox(tx, repo, fresh, await loadReviews(tx, fresh.id));
    if (box.storageDown) throw new StorageDown();
    if (!isMet(box)) throw conflict('This change has unmet merge rules and cannot join the merge queue');
    const events = new Events();
    const row = await enqueue(tx, repo, fresh, new Contents(), events);
    events.emit(tx, repo.id);
    return row;
  });
}

async function opMerge(access: RepoAccess, change: Row): Promise<string> {
  return transaction(async (tx) => {
    await tx.lockRepo(access.repo.id);
    const fresh = await loadChange(tx, access.repo, change.number);
    const repo = await freshRepo(tx, access.repo.id);
    if (fresh.state === 'merged') throw conflict(MERGED);
    if (fresh.state === 'queued') throw conflict('This change is in the merge queue');
    if (repo.queue) throw conflict('This repository merges through the merge queue');
    const box = await mergeBox(tx, repo, fresh, await loadReviews(tx, fresh.id));
    if (box.storageDown) throw new StorageDown();
    if (!isMet(box)) throw conflict('This change has unmet merge rules and cannot be merged');
    const events = new Events();
    const revision = await mergeChange(tx, repo, fresh, authorOf(access), new Contents(), events);
    events.emit(tx, repo.id);
    return revision;
  });
}

// ---- routes ----

interface Loaded {
  access: RepoAccess;
  change: Row;
  body: Body;
}

async function load(c: Ctx, withBody = false): Promise<Loaded> {
  const caller = await authenticate(c.req, false);
  const body: Body = withBody ? await readBody(c.req, config.jsonLimitBytes) : { kind: 'none' };
  const access = await repoAccess(db, caller, c.params.org, c.params.repo);
  return { access, change: await loadChange(db, access.repo, parseNumber(c.params.n)), body };
}

const inChange = async (table: 'threads' | 'reviews', id: string, changeId: number): Promise<Row> => {
  const row = /^[1-9][0-9]*$/.test(id) ? (await db.q<Row>(`SELECT * FROM ${table} WHERE id = $1 AND change_id = $2`, [Number(id), changeId]))[0] : undefined;
  if (!row) throw notFound();
  return row;
};

const reviewObject = (row: Row, reviewer: string, reason: string | null) => ({
  id: row.id, reviewer, type: row.type, state: row.state, summary: row.summary, reason, created_at: timeView(row.created_at).iso,
});

/** The live stream: a WebSocket upgrade on /api/live/:org/:repo, refused with the API's status when the repository is not visible. */
export async function openLive(req: IncomingMessage, socket: Duplex, org: string, repo: string): Promise<void> {
  try {
    const access = await repoAccess(db, await authenticate(req, false), org, repo);
    subscribe(access.repo.id, req, socket);
  } catch (error) {
    const out = errorReply(error);
    socket.end(`HTTP/1.1 ${out.status} Refused\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
  }
}

export function register(router: Router): void {
  router.add('POST', '/api/repos/:org/:repo/changes', async (c) => {
    const caller = await authenticate(c.req, false);
    const body = await readBody(c.req, config.jsonLimitBytes);
    const access = await repoAccess(db, caller, c.params.org, c.params.repo);
    requireWrite(access);
    const created = await opCreateChange(access, usable(body, config.jsonLimitBytes));
    return reply(201, await changeObject(db, access.repo, created, access.user!.id));
  });

  router.add('GET', '/api/repos/:org/:repo/changes', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, true), c.params.org, c.params.repo);
    const rows = await db.q<Row>(
      `SELECT c.*, u.username AS author_username FROM changes c JOIN users u ON u.id = c.author_id
        WHERE c.repo_id = $1 AND ($2::text IS NULL OR c.state = $2) ORDER BY c.number`,
      [access.repo.id, c.url.searchParams.get('state')],
    );
    return reply(200, await Promise.all(rows.map((row) => changeObject(db, access.repo, row, access.user?.id ?? null))));
  });

  router.add('GET', '/api/repos/:org/:repo/changes/:n', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, true), c.params.org, c.params.repo);
    const change = await loadChange(db, access.repo, parseNumber(c.params.n));
    return reply(200, await changeObject(db, access.repo, change, access.user?.id ?? null));
  });

  router.add('GET', '/api/repos/:org/:repo/changes/:n/diff', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, true), c.params.org, c.params.repo);
    const change = await loadChange(db, access.repo, parseNumber(c.params.n));
    return reply(200, { files: await changeDiff(db, access.repo, change, new Contents()) });
  });

  router.add('GET', '/api/repos/:org/:repo/changes/:n/view', async (c) => {
    const { access, change } = await load(c);
    return reply(200, await changeView(db, access, change));
  });

  router.add('PUT', '/api/repos/:org/:repo/changes/:n/ready', async (c) => {
    const { access, change } = await load(c);
    requireWrite(access);
    await opReady(access, change);
    return reply(200, await changeObject(db, access.repo, await loadChange(db, access.repo, change.number), access.user!.id));
  });

  router.add('POST', '/api/repos/:org/:repo/changes/:n/review-requests', async (c) => {
    const { access, change, body } = await load(c, true);
    const name = body.kind === 'ok' ? asObject(body.value).username : undefined;
    const target = isString(name) ? await userByName(db, name) : null;
    if (!target || !(await canSee(db, access.repo, target.id))) throw notFound();
    requireWrite(access);
    usable(body, config.jsonLimitBytes);
    return reply((await opRequestReview(access, change, target)) ? 201 : 200, { username: target.username });
  });

  router.add('POST', '/api/repos/:org/:repo/changes/:n/threads', async (c) => {
    const { access, change, body } = await load(c, true);
    const id = await opThread(access, change, usable(body, config.jsonLimitBytes));
    return reply(201, apiThread(await oneThread(change.id, id)));
  });

  router.add('POST', '/api/repos/:org/:repo/changes/:n/threads/:id/replies', async (c) => {
    const { access, change, body } = await load(c, true);
    const thread = await inChange('threads', c.params.id, change.id);
    const commentId = await opReply(access, change, thread.id, usable(body, config.jsonLimitBytes));
    return reply(201, apiThread(await oneThread(change.id, thread.id)).comments.find((entry) => entry.id === commentId));
  });

  router.add('PUT', '/api/repos/:org/:repo/changes/:n/threads/:id/state', async (c) => {
    const { access, change, body } = await load(c, true);
    const thread = await inChange('threads', c.params.id, change.id);
    const input = usable(body, config.jsonLimitBytes);
    if (input.state !== 'resolved' && input.state !== 'unresolved') throw invalid({ state: 'State must be resolved or unresolved' });
    await transaction(async (tx) => {
      await tx.q('UPDATE threads SET state = $1 WHERE id = $2', [input.state, thread.id]);
      const events = new Events();
      await touchStack(tx, access.repo, change, events);
      events.emit(tx, access.repo.id);
    });
    return reply(200, apiThread(await oneThread(change.id, thread.id)));
  });

  router.add('POST', '/api/repos/:org/:repo/changes/:n/suggestions/apply', async (c) => {
    const { access, change, body } = await load(c, true);
    const raw = body.kind === 'ok' ? asObject(body.value).comments : undefined;
    const ids = Array.isArray(raw) ? raw : [];
    if (ids.some((id) => !Number.isInteger(id))) throw notFound();
    if (!(change.author_id === access.user!.id || atLeast(access.role, 'maintainer'))) throw forbidden('Only the change author or a maintainer can apply suggestions');
    usable(body, config.jsonLimitBytes);
    if (!ids.length) throw invalid({ comments: 'comments is required' });
    return reply(201, await opApply(access, change, ids as number[]));
  });

  router.add('POST', '/api/repos/:org/:repo/changes/:n/reviews', async (c) => {
    const { access, change, body } = await load(c, true);
    const input = usable(body, config.jsonLimitBytes);
    if (input.type === 'approve' || input.type === 'request_changes') {
      if (!atLeast(access.role, 'writer')) throw forbidden('Readers cannot approve or request changes');
      if (input.type === 'approve' && change.author_id === access.user!.id) throw forbidden('You cannot approve your own change');
    }
    const row = await opReview(access, change, input);
    return reply(201, reviewObject(row, access.user!.username, null));
  });

  router.add('POST', '/api/repos/:org/:repo/changes/:n/reviews/:id/dismiss', async (c) => {
    const { access, change, body } = await load(c, true);
    const review = await inChange('reviews', c.params.id, change.id);
    requireMaintainer(access);
    const reason = await opDismiss(access, change, review, usable(body, config.jsonLimitBytes));
    const reviewer = (await db.q<Row>('SELECT username FROM users WHERE id = $1', [review.reviewer_id]))[0];
    return reply(200, reviewObject({ ...review, state: 'dismissed' }, reviewer.username, reason));
  });

  router.add('PUT', '/api/repos/:org/:repo/changes/:n/viewed', async (c) => {
    const { access, change, body } = await load(c, true);
    const input = usable(body, config.jsonLimitBytes);
    await opViewed(access, change, isString(input.path) ? input.path : '', input.viewed !== false);
    return reply(200, (await changeObject(db, access.repo, change, access.user!.id)).counts);
  });

  router.add('POST', '/api/repos/:org/:repo/changes/:n/merge', async (c) => {
    const { access, change } = await load(c);
    requireWrite(access);
    return reply(200, { state: 'merged', revision: await opMerge(access, change) });
  });

  router.add('POST', '/api/repos/:org/:repo/changes/:n/queue', async (c) => {
    const { access, change } = await load(c);
    requireWrite(access);
    const entry = await opQueue(access, change);
    const view = await queueView(db, access.repo, access.org, false);
    return reply(201, entryObject([...view.entries, ...view.history].find((item) => item.id === entry.id)!));
  });

  router.add('GET', '/api/repos/:org/:repo/queue', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, true), c.params.org, c.params.repo);
    const view = await queueView(db, access.repo, access.org, false);
    return reply(200, { entries: view.entries.map(entryObject), history: view.history.map(entryObject) });
  });

  router.add('GET', '/api/repos/:org/:repo/queue/view', async (c) => {
    const access = await repoAccess(db, await authenticate(c.req, false), c.params.org, c.params.repo);
    return reply(200, await queueView(db, access.repo, access.org, atLeast(access.role, 'maintainer')));
  });

  router.add('PUT', '/api/repos/:org/:repo/queue/:entry/position', async (c) => {
    const caller = await authenticate(c.req, false);
    const body = await readBody(c.req, config.jsonLimitBytes);
    const access = await repoAccess(db, caller, c.params.org, c.params.repo);
    const found = /^[1-9][0-9]*$/.test(c.params.entry) ? (await db.q<Row>(`SELECT id FROM queue_entries WHERE id = $1 AND repo_id = $2 AND status = 'active'`, [Number(c.params.entry), access.repo.id]))[0] : undefined;
    if (!found) throw notFound();
    requireMaintainer(access);
    const input = usable(body, config.jsonLimitBytes);
    await transaction(async (tx) => {
      await tx.lockRepo(access.repo.id);
      const entry = (await tx.q<Row>('SELECT * FROM queue_entries WHERE id = $1', [found.id]))[0];
      if (entry.status !== 'active') throw notFound();
      const events = new Events();
      await moveEntry(tx, await freshRepo(tx, access.repo.id), entry, input.position as number, new Contents(), events);
      events.emit(tx, access.repo.id);
    });
    return reply(200, (await queueView(db, access.repo, access.org, false)).entries.map(entryObject));
  });
}
