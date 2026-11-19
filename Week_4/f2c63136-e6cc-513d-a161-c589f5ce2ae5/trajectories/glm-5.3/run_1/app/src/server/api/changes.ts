import { Errors, expectObject, visibleRepo, type RequestContext , parseBodyWithLimit } from './context.js';
import { isValidBranchName } from '../../shared/rules.js';
import { splitLines, diffFile } from '../../shared/lines.js';
import {
  getChange, getBranch, revisionFileTexts, changeHeadRevision, type ChangeRow, type RepoRow,
} from '../store/revisions.js';
import {
  mergeBoxView, threadViews, stackOfChange, getUserByUsername, roleFor,
} from '../store/changes.js';
import { performPush } from '../store/push.js';
import { diffSignature, type ServiceDeps } from '../store/domain.js';
import { admitToQueue, getQueueEntries, mergeChangeIntoBase } from '../store/queue.js';

function parseBody(ctx: { cfg: { pushSizeLimitBytes: number }; req: { body: Buffer; url: URL } }): unknown {
  return parseBodyWithLimit(ctx);
}

interface ChangeObject {
  id: string; number: number; title: string; state: string; draft: boolean; author: string;
  head: string; base: string; base_revision: string; head_revision: string;
  conflicting: boolean; conflict_paths: string[]; changes_requested: boolean;
  merge_rules: Array<{ rule: string; text: string }>;
  restack: { result: string | null; dismissed_count: number | null; notice: string | null };
  files: Array<{ path: string; status: string }>;
  counts: { files_viewed: number; files_total: number; unresolved_threads: number; approvals_remaining: number };
  stack: Array<{ number: number; position: number; title: string; state: string }>;
  queue_entry: unknown;
}

function depsOf(ctx: RequestContext): ServiceDeps {
  return { db: ctx.db.pool, cfg: ctx.cfg, clock: ctx.clock, storage: ctx.storage, mailer: ctx.mailer, live: ctx.live };
}

function announce(ctx: RequestContext, repoId: number, payload: Record<string, unknown>): void {
  ctx.live.publish({ repoId, kind: 'update', payload });
}

async function repoOf(ctx: RequestContext, org: string, name: string): Promise<RepoRow> {
  const { getRepoByPath } = await import('../store/revisions.js');
  const repo = await getRepoByPath(ctx.tx, org, name);
  if (!repo) throw Errors.notFound();
  return repo;
}

/** The change object, computed from the records. */
export async function changeObject(
  ctx: RequestContext, repo: RepoRow, change: ChangeRow, viewerId: number | null,
): Promise<ChangeObject> {
  const diff = await (await import('../store/revisions.js')).changeCombinedDiff(ctx.tx, ctx.storage, change);
  const box = await mergeBoxView(ctx.tx, depsOf(ctx), repo, change, diff);
  const threads = await threadViews(ctx.tx, repo.id, change.number);
  const unresolved = threads.filter((t) => t.state === 'unresolved').length;
  const viewed = viewerId
    ? await ctx.tx.query(
        'SELECT COUNT(*) AS c FROM viewed_marks WHERE repo_id = $1 AND change_number = $2 AND user_id = $3',
        [repo.id, change.number, viewerId],
      )
    : { rows: [{ c: 0 }] };
  const stack = await stackOfChange(ctx.tx, change);
  const queueEntry = await ctx.tx.query(
    "SELECT * FROM queue_entries WHERE repo_id = $1 AND change_number = $2 AND state IN ('waiting','checking')",
    [repo.id, change.number],
  );
  const author = await (await import('../store/changes.js')).getUserById(ctx.tx, change.author_id);
  const headRev = await changeHeadRevision(ctx.tx, change);
  const currentApprovals = box.approvals.length;
  return {
    id: `${repo.org}/${repo.name}#${change.number}`,
    number: change.number,
    title: change.title,
    state: change.state,
    draft: change.draft,
    author: author?.username ?? '',
    head: change.head_branch,
    base: change.base_branch,
    base_revision: change.base_revision,
    head_revision: headRev,
    conflicting: box.conflicting,
    conflict_paths: box.conflictPaths,
    changes_requested: box.changesRequested.length > 0,
    merge_rules: box.rules,
    restack: { result: change.restack_result, dismissed_count: change.restack_dismissed, notice: change.restack_notice },
    files: diff.map((f) => ({ path: f.path, status: f.status })),
    counts: {
      files_viewed: Number(viewed.rows[0].c),
      files_total: diff.length,
      unresolved_threads: unresolved,
      approvals_remaining: Math.max(0, repo.required_approvals - currentApprovals),
    },
    stack: stack.map((c, i) => ({ number: c.number, position: i + 1, title: c.title, state: c.state })),
    queue_entry: queueEntry.rows[0] ?? null,
  };
}

/** POST /api/repos/<org>/<repo>/changes */
export async function createChange(ctx: RequestContext, org: string, repoName: string): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'write');
  const repo = await repoOf(ctx, org, repoName);
  if (!ctx.auth.user) throw Errors.notFound();
  const body = expectObject(parseBody(ctx));
  const title = typeof body.title === 'string' ? body.title : '';
  const description = typeof body.description === 'string' ? body.description : '';
  const head = typeof body.head === 'string' ? body.head : '';
  const base = typeof body.base === 'string' ? body.base : '';
  const draft = body.draft === true;
  const errors: Record<string, string> = {};
  if (!title || title.length < 1 || title.length > 200) errors.title = 'Title must be 1 to 200 characters';
  if (!head || !base) { if (!head) errors.head = 'head is required'; if (!base) errors.base = 'base is required'; }
  else if (head === base) errors.head = 'Head and base must differ';
  if (Object.keys(errors).length > 0) throw Errors.invalid(errors);
  const headBranch = await getBranch(ctx.tx, repo.id, head);
  const baseBranch = await getBranch(ctx.tx, repo.id, base);
  if (!headBranch || !baseBranch) throw Errors.notFound();
  const existing = await ctx.tx.query(
    "SELECT 1 FROM changes WHERE repo_id = $1 AND head_branch = $2 AND state IN ('draft','open','queued')",
    [repo.id, head],
  );
  if (existing.rows.length > 0) throw Errors.conflict(`An open change already exists for branch ${head}`);
  const nextNumber = await ctx.tx.query(
    'SELECT COALESCE(MAX(number), 0) + 1 AS n FROM changes WHERE repo_id = $1', [repo.id],
  );
  const number = nextNumber.rows[0].n;
  await ctx.tx.query(
    `INSERT INTO changes (repo_id, number, title, description, head_branch, base_branch, base_revision, state, draft, author_id, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9,$10)`,
    [repo.id, number, title, description, head, base, baseBranch.revision_id, draft, ctx.auth.user.id, ctx.clock.nowMs()],
  );
  const change = await getChange(ctx.tx, repo.id, number) as ChangeRow;
  return { status: 201, body: await changeObject(ctx, repo, change, ctx.auth.user!.id) };
}

/** GET /api/repos/<org>/<repo>/changes */
export async function listChanges(ctx: RequestContext, org: string, repoName: string): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'read');
  const repo = await repoOf(ctx, org, repoName);
  const state = ctx.req.url.searchParams.get('state');
  const rows = state
    ? await ctx.tx.query('SELECT * FROM changes WHERE repo_id = $1 AND state = $2 ORDER BY number', [repo.id, state])
    : await ctx.tx.query('SELECT * FROM changes WHERE repo_id = $1 ORDER BY number', [repo.id]);
  const out = [];
  for (const row of rows.rows as ChangeRow[]) out.push(await changeObject(ctx, repo, row, ctx.auth.user?.id ?? null));
  return { status: 200, body: out };
}

/** GET /api/repos/<org>/<repo>/changes/<n> */
export async function getChangeRoute(ctx: RequestContext, org: string, repoName: string, number: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'read');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  return { status: 200, body: await changeObject(ctx, repo, change, ctx.auth.user?.id ?? null) };
}

/** GET /api/repos/<org>/<repo>/changes/<n>/diff */
export async function getChangeDiff(ctx: RequestContext, org: string, repoName: string, number: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'read');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  const storageOk = await ctx.storage.healthy();
  if (!storageOk) throw Errors.outage('Storage is unavailable. Nothing was saved. Try again in a moment.');
  const base = await revisionFileTexts(ctx.tx, ctx.storage, repo.id, change.base_revision);
  const headRev = await changeHeadRevision(ctx.tx, change);
  const head = await revisionFileTexts(ctx.tx, ctx.storage, repo.id, headRev);
  const { combinedDiff } = await import('../../shared/rules.js');
  const diff = combinedDiff(new Map(base), new Map(head));
  return {
    status: 200,
    body: {
      files: diff.map((f) => ({
        path: f.path,
        status: f.status,
        base_text: f.baseText,
        head_text: f.headText,
        hunks: diffFile(f.baseText, f.headText, ctx.cfg.diffContextLines).hunks,
      })),
    },
  };
}

/** PUT /api/repos/<org>/<repo>/changes/<n>/ready */
export async function markReady(ctx: RequestContext, org: string, repoName: string, number: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'session-only');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  if (!change.draft) throw Errors.conflict('This change is not a draft');
  await ctx.tx.query('UPDATE changes SET draft = false WHERE repo_id = $1 AND number = $2', [repo.id, number]);
  const updated = await getChange(ctx.tx, repo.id, number) as ChangeRow;
  return { status: 200, body: await changeObject(ctx, repo, updated, ctx.auth.user!.id) };
}

/** POST /api/repos/<org>/<repo>/changes/<n>/review-requests */
export async function requestReview(ctx: RequestContext, org: string, repoName: string, number: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'session-only');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  const body = expectObject(parseBody(ctx));
  const username = typeof body.username === 'string' ? body.username : '';
  const user = await getUserByUsername(ctx.tx, username);
  if (!user) throw Errors.notFound();
  const role = await roleFor(ctx.tx, repo, user);
  if (role === 'none') throw Errors.notFound();
  const pending = await ctx.tx.query(
    `SELECT 1 FROM review_requests WHERE repo_id = $1 AND change_number = $2 AND user_id = $3 AND pending = true`,
    [repo.id, number, user.id],
  );
  if (pending.rows.length > 0) return { status: 200, body: { username } };
  await ctx.tx.query(
    'INSERT INTO review_requests (repo_id, change_number, user_id, pending, created_at_ms) VALUES ($1,$2,$3,true,$4)',
    [repo.id, number, user.id, ctx.clock.nowMs()],
  );
  await ctx.mailer.record({
    to: user.email,
    subject: `[${repo.org}/${repo.name}] Review requested on #${change.number}: ${change.title}`,
    body: `${ctx.auth.user!.name} requested your review on "${change.title}".\n\n${ctx.cfg.appPublicUrl}/${repo.org}/${repo.name}/changes/${change.number}`,
    headers: { 'X-Change-Id': `${repo.org}/${repo.name}#${change.number}` },
  });
  return { status: 201, body: { username } };
}

/** POST /api/repos/<org>/<repo>/changes/<n>/threads */
export async function createThread(ctx: RequestContext, org: string, repoName: string, number: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'session-only');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  if (change.state === 'merged') throw Errors.conflict('This change is already merged');
  const body = expectObject(parseBody(ctx));
  const path = typeof body.path === 'string' ? body.path : '';
  const side = body.side === 'old' || body.side === 'new' ? body.side : '';
  const line = typeof body.line === 'number' ? body.line : NaN;
  const endLine = typeof body.end_line === 'number' ? body.end_line : line;
  const commentBody = typeof body.body === 'string' ? body.body : '';
  const suggestion = body.suggestion === null || body.suggestion === undefined ? null : body.suggestion;
  const errors: Record<string, string> = {};
  if (!commentBody.trim()) errors.body = 'Comment cannot be empty';
  // Line must be a row of the combined diff on that side.
  const storageOk = await ctx.storage.healthy();
  if (!storageOk) throw Errors.outage('Storage is unavailable. Nothing was saved. Try again in a moment.');
  const base = await revisionFileTexts(ctx.tx, ctx.storage, repo.id, change.base_revision);
  const headRev = await changeHeadRevision(ctx.tx, change);
  const head = await revisionFileTexts(ctx.tx, ctx.storage, repo.id, headRev);
  const { combinedDiff } = await import('../../shared/rules.js');
  const diff = combinedDiff(new Map(base), new Map(head));
  const file = diff.find((f) => f.path === path);
  if (!file || !Number.isInteger(line)) {
    errors.line = `Line ${Number.isInteger(line) ? line : ''} is not in the diff`.replace('Line  is', 'Line is');
  } else {
    const { diffRowsOf } = await import('../../shared/lines.js');
    const rows = diffRowsOf(file!.baseText, file!.headText);
    const wantedSide = side === 'old' ? 'removed' : 'added';
    const valid = rows.some((r) => {
      if (side === 'old') return r.kind !== 'added' && r.oldLine === line - 1;
      return r.kind !== 'removed' && r.newLine === line - 1;
    });
    if (!valid) errors.line = `Line ${line} is not in the diff`;
    if (endLine !== undefined && Number.isInteger(endLine) && endLine < line) errors.line = `Line ${line} is not in the diff`;
  }
  if (suggestion !== null) {
    if (side !== 'new') errors.suggestion = 'Suggestions are only possible on new lines';
    else {
      const sug = suggestion as { lines?: unknown };
      if (!Array.isArray(sug.lines) || sug.lines.some((l) => typeof l !== 'string')) {
        errors.suggestion = 'Suggestions are only possible on new lines';
      }
    }
  }
  if (Object.keys(errors).length > 0) throw Errors.invalid(errors);
  const insert = await ctx.tx.query(
    `INSERT INTO threads (repo_id, change_number, path, side, line, end_line, state, outdated, revision, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,'unresolved',false,$7,$8) RETURNING id`,
    [repo.id, number, path, side, line, endLine ?? line, headRev, ctx.clock.nowMs()],
  );
  const threadId = insert.rows[0].id;
  let suggestionLines: string | null = null;
  if (suggestion !== null) {
    suggestionLines = JSON.stringify((suggestion as { lines: string[] }).lines);
  }
  const commentInsert = await ctx.tx.query(
    `INSERT INTO comments (thread_id, author_id, body, created_at_ms, suggestion_lines, suggestion_state, suggestion_line, suggestion_end_line)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [threadId, ctx.auth.user!.id, commentBody, ctx.clock.nowMs(), suggestionLines, suggestionLines ? 'open' : null, line, endLine ?? line],
  );
  await sendMentions(ctx, repo, change, commentBody);
  announce(ctx, repo.id, { kind: 'comment', number, threadId, commentId: commentInsert.rows[0].id, author: ctx.auth.user!.name });
  const threads = await threadViews(ctx.tx, repo.id, number);
  return { status: 201, body: threads.find((t) => t.id === threadId) };
}

/** @mentions in a comment, reply or summary mail the mentioned user once. */
async function sendMentions(ctx: RequestContext, repo: RepoRow, change: ChangeRow, text: string): Promise<void> {
  const seen = new Set<string>();
  for (const match of text.matchAll(/@([a-z0-9][a-z0-9-]{1,31})/g)) {
    const username = match[1];
    if (seen.has(username)) continue;
    seen.add(username);
    const user = await getUserByUsername(ctx.tx, username);
    if (!user || user.id === ctx.auth.user!.id) continue;
    const role = await roleFor(ctx.tx, repo, user);
    if (role === 'none') continue;
    await ctx.mailer.record({
      to: user.email,
      subject: `[${repo.org}/${repo.name}] ${ctx.auth.user!.name} mentioned you on #${change.number}`,
      body: `${ctx.auth.user!.name} mentioned you on "${change.title}".\n\n${ctx.cfg.appPublicUrl}/${repo.org}/${repo.name}/changes/${change.number}`,
      headers: { 'X-Change-Id': `${repo.org}/${repo.name}#${change.number}` },
    });
  }
}

/** POST /api/repos/<org>/<repo>/changes/<n>/threads/<id>/replies */
export async function replyThread(ctx: RequestContext, org: string, repoName: string, number: number, threadId: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'session-only');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  const thread = await ctx.tx.query('SELECT * FROM threads WHERE id = $1 AND repo_id = $2 AND change_number = $3', [threadId, repo.id, number]);
  if (thread.rows.length === 0) throw Errors.notFound();
  if (change.state === 'merged') throw Errors.conflict('This change is already merged');
  const body = expectObject(parseBody(ctx));
  const commentBody = typeof body.body === 'string' ? body.body : '';
  if (!commentBody.trim()) throw Errors.invalid({ body: 'Comment cannot be empty' });
  const insert = await ctx.tx.query(
    'INSERT INTO comments (thread_id, author_id, body, created_at_ms) VALUES ($1,$2,$3,$4) RETURNING *',
    [threadId, ctx.auth.user!.id, commentBody, ctx.clock.nowMs()],
  );
  await sendMentions(ctx, repo, change, commentBody);
  announce(ctx, repo.id, { kind: 'comment', number, threadId, commentId: insert.rows[0].id, author: ctx.auth.user!.name });
  return {
    status: 201,
    body: {
      id: insert.rows[0].id,
      thread_id: threadId,
      author: ctx.auth.user!.username,
      body: commentBody,
      created_at: iso(insert.rows[0].created_at_ms),
    },
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** PUT /api/repos/<org>/<repo>/changes/<n>/threads/<id>/state */
export async function setThreadState(ctx: RequestContext, org: string, repoName: string, number: number, threadId: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'session-only');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  const thread = await ctx.tx.query('SELECT * FROM threads WHERE id = $1 AND repo_id = $2 AND change_number = $3', [threadId, repo.id, number]);
  if (thread.rows.length === 0) throw Errors.notFound();
  const body = expectObject(parseBody(ctx));
  const state = body.state === 'resolved' || body.state === 'unresolved' ? body.state : null;
  if (!state) throw Errors.invalid({ state: 'state is required' });
  await ctx.tx.query('UPDATE threads SET state = $1 WHERE id = $2', [state, threadId]);
  const threads = await threadViews(ctx.tx, repo.id, number);
  return { status: 200, body: threads.find((t) => t.id === threadId) };
}

/** POST /api/repos/<org>/<repo>/changes/<n>/suggestions/apply */
export async function applySuggestions(ctx: RequestContext, org: string, repoName: string, number: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'session-only');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  const role = await roleFor(ctx.tx, repo, ctx.auth.user!);
  if (change.author_id !== ctx.auth.user!.id && role !== 'maintainer' && role !== 'owner') {
    throw Errors.forbidden('Only the change author or a maintainer can apply suggestions');
  }
  const body = expectObject(parseBody(ctx));
  const commentIds = Array.isArray(body.comments) ? body.comments : null;
  if (!commentIds) throw Errors.invalid({ comments: 'comments is required' });
  const comments = [];
  for (const id of commentIds) {
    const c = await ctx.tx.query('SELECT * FROM comments WHERE id = $1', [id]);
    if (c.rows.length === 0) throw Errors.notFound();
    if (c.rows[0].suggestion_lines === null) throw Errors.invalid({ comments: `Comment ${id} has no suggestion` });
    comments.push(c.rows[0]);
  }
  // Every suggestion must still apply at its mapped position.
  const storageOk = await ctx.storage.healthy();
  if (!storageOk) throw Errors.outage('Storage is unavailable. Nothing was saved. Try again in a moment.');
  const headRev = await changeHeadRevision(ctx.tx, change);
  const headTexts = await revisionFileTexts(ctx.tx, ctx.storage, repo.id, headRev);
  const edits = new Map<string, string>();
  for (const c of comments) {
    const thread = await ctx.tx.query('SELECT * FROM threads WHERE id = $1', [c.thread_id]);
    const t = thread.rows[0];
    if (c.suggestion_state === 'applied') throw Errors.conflict('This suggestion was already applied');
    const current = headTexts.get(t.path);
    const commentRev = await revisionFileTexts(ctx.tx, ctx.storage, repo.id, t.revision);
    const old = commentRev.get(t.path) ?? null;
    if (current === undefined || current === null) {
      throw Errors.conflict(`This suggestion can no longer be applied: line ${c.suggestion_line} changed since it was made.`);
    }
    const lines = splitLines(current);
    const rangeStart = c.suggestion_line;
    const rangeEnd = c.suggestion_end_line;
    const oldLines = old === null ? [] : splitLines(old);
    // The suggestion's range must be unchanged since the comment's revision.
    const currentSlice = lines.slice(rangeStart - 1, rangeEnd).join('\n');
    const oldSlice = oldLines.slice(rangeStart - 1, rangeEnd).join('\n');
    const unchanged = old !== null && currentSlice === oldSlice && lines.length >= rangeEnd;
    if (!unchanged) {
      throw Errors.conflict(`This suggestion can no longer be applied: line ${c.suggestion_line} changed since it was made.`);
    }
    const replacement = JSON.parse(c.suggestion_lines) as string[];
    const before = lines.slice(0, rangeStart - 1);
    const after = lines.slice(rangeEnd);
    const merged = [...before, ...replacement, ...after].join('\n');
    const finalNewline = current.endsWith('\n') && !merged.endsWith('\n') ? merged + '\n' : merged;
    edits.set(t.path, finalNewline);
  }
  const message = comments.length === 1 ? 'Apply 1 suggestion' : `Apply ${comments.length} suggestions`;
  const previousHead = headRev;
  const author = { username: ctx.auth.user!.username, name: ctx.auth.user!.name };
  const outcome = await performPush(depsOf(ctx), ctx.tx, repo.id, change.head_branch, previousHead, message,
    [...edits.entries()].map(([path, content]) => ({ path, content })), author);
  for (const c of comments) {
    await ctx.tx.query("UPDATE comments SET suggestion_state = 'applied' WHERE id = $1", [c.id]);
  }
  announce(ctx, repo.id, { kind: 'new_revision', number, revision: outcome.revision, author: author.name });
  return { status: 201, body: { revision: outcome.revision, message } };
}

/** POST /api/repos/<org>/<repo>/changes/<n>/reviews */
export async function submitReview(ctx: RequestContext, org: string, repoName: string, number: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'session-only');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  if (change.state === 'merged') throw Errors.conflict('This change is already merged');
  const me = ctx.auth.user!;
  const role = await roleFor(ctx.tx, repo, me);
  const body = expectObject(parseBody(ctx));
  const type = body.type === 'comment' || body.type === 'approve' || body.type === 'request_changes' ? body.type : null;
  const summary = typeof body.summary === 'string' ? body.summary : '';
  if (!type) throw Errors.invalid({ type: 'type is required' });
  if (role === 'reader' && (type === 'approve' || type === 'request_changes')) {
    throw Errors.forbidden('Readers cannot approve or request changes');
  }
  if (type === 'approve' && change.author_id === me.id) {
    throw Errors.forbidden('You cannot approve your own change');
  }
  if (type === 'request_changes' && !summary.trim()) {
    throw Errors.invalid({ summary: 'A summary is required to request changes' });
  }
  const state = type === 'comment' ? 'commented' : type === 'approve' ? 'approved' : 'changes_requested';
  const storageOk = await ctx.storage.healthy();
  if (!storageOk) throw Errors.outage('Storage is unavailable. Nothing was saved. Try again in a moment.');
  const diff = await (await import('../store/revisions.js')).changeCombinedDiff(ctx.tx, ctx.storage, change);
  const insert = await ctx.tx.query(
    `INSERT INTO reviews (repo_id, change_number, reviewer_id, type, state, summary, reason, dismissed_by, diff_signature, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,$7,$8) RETURNING id`,
    [repo.id, number, me.id, type, state, summary, diffSignature(diff), ctx.clock.nowMs()],
  );
  // A submitted review stops the pending request for this reviewer.
  await ctx.tx.query(
    'UPDATE review_requests SET pending = false WHERE repo_id = $1 AND change_number = $2 AND user_id = $3',
    [repo.id, number, me.id],
  );
  await sendMentions(ctx, repo, change, summary);
  announce(ctx, repo.id, {
    kind: 'review', number, reviewId: insert.rows[0].id, type, state, reviewer: me.name,
  });
  return {
    status: 201,
    body: {
      id: insert.rows[0].id, reviewer: me.username, type, state, summary,
      reason: null, created_at: iso(ctx.clock.nowMs()),
    },
  };
}

/** POST /api/repos/<org>/<repo>/changes/<n>/reviews/<id>/dismiss */
export async function dismissReview(ctx: RequestContext, org: string, repoName: string, number: number, reviewId: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'maintainer');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  const review = await ctx.tx.query('SELECT * FROM reviews WHERE id = $1 AND repo_id = $2 AND change_number = $3', [reviewId, repo.id, number]);
  if (review.rows.length === 0) throw Errors.notFound();
  const body = expectObject(parseBody(ctx));
  const reason = typeof body.reason === 'string' ? body.reason : '';
  if (!reason.trim()) throw Errors.invalid({ reason: 'A reason is required' });
  const row = review.rows[0];
  if (row.state === 'dismissed') throw Errors.conflict('This review is already dismissed');
  await ctx.tx.query(
    "UPDATE reviews SET state = 'dismissed', reason = $1, dismissed_by = $2 WHERE id = $3",
    [`Dismissed by ${ctx.auth.user!.name}: ${reason}`, ctx.auth.user!.id, reviewId],
  );
  announce(ctx, repo.id, { kind: 'review_dismissed', number, reviewId, by: ctx.auth.user!.name });
  const updated = await ctx.tx.query('SELECT * FROM reviews WHERE id = $1', [reviewId]);
  const r = updated.rows[0];
  const reviewer = await (await import('../store/changes.js')).getUserById(ctx.tx, r.reviewer_id);
  return {
    status: 200,
    body: { id: r.id, reviewer: reviewer?.username, type: r.type, state: r.state, summary: r.summary, reason: r.reason, created_at: iso(r.created_at_ms) },
  };
}

/** PUT /api/repos/<org>/<repo>/changes/<n>/viewed */
export async function setViewed(ctx: RequestContext, org: string, repoName: string, number: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'session-only');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  const body = expectObject(parseBody(ctx));
  const path = typeof body.path === 'string' ? body.path : '';
  const viewed = body.viewed === true;
  const diff = await (await import('../store/revisions.js')).changeCombinedDiff(ctx.tx, ctx.storage, change);
  if (!diff.some((f) => f.path === path)) throw Errors.invalid({ path: 'Path is not in this change' });
  if (viewed) {
    await ctx.tx.query(
      'INSERT INTO viewed_marks (repo_id, change_number, path, user_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [repo.id, number, path, ctx.auth.user!.id],
    );
  } else {
    await ctx.tx.query(
      'DELETE FROM viewed_marks WHERE repo_id = $1 AND change_number = $2 AND path = $3 AND user_id = $4',
      [repo.id, number, path, ctx.auth.user!.id],
    );
  }
  const viewedCount = await ctx.tx.query(
    'SELECT COUNT(*) AS c FROM viewed_marks WHERE repo_id = $1 AND change_number = $2 AND user_id = $3',
    [repo.id, number, ctx.auth.user!.id],
  );
  announce(ctx, repo.id, { kind: 'viewed', number, path, viewed, by: ctx.auth.user!.username });
  return { status: 200, body: { files_viewed: Number(viewedCount.rows[0].c), files_total: diff.length } };
}

/** POST /api/repos/<org>/<repo>/changes/<n>/merge */
export async function mergeChange(ctx: RequestContext, org: string, repoName: string, number: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'write');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  // Refusals in the published order: state, repository, draft, rules.
  if (change.state === 'queued') throw Errors.conflict('This change is in the merge queue');
  if (change.state === 'merged') throw Errors.conflict('This change is already merged');
  if (repo.queue) throw Errors.conflict('This repository merges through the merge queue');
  if (change.draft) throw Errors.conflict('This change has unmet merge rules and cannot be merged');
  const diff = await (await import('../store/revisions.js')).changeCombinedDiff(ctx.tx, ctx.storage, change);
  const box = await mergeBoxView(ctx.tx, depsOf(ctx), repo, change, diff);
  if (box.rules.length > 0) throw Errors.conflict('This change has unmet merge rules and cannot be merged');
  const storageOk = await ctx.storage.healthy();
  if (!storageOk) throw Errors.outage('Storage is unavailable. Nothing was saved. Try again in a moment.');
  const mergeRev = await mergeChangeIntoBase(depsOf(ctx), ctx.tx, repo, change, null, ctx.auth.user!.username);
  // Retarget the next change above onto the merged change's base branch.
  const { retargetAfterMerge } = await import('../store/push.js');
  await retargetAfterMerge(depsOf(ctx), ctx.tx, repo.id, change, { username: ctx.auth.user!.username, name: ctx.auth.user!.name });
  announce(ctx, repo.id, { kind: 'merged', number, revision: mergeRev });
  return { status: 200, body: { state: 'merged', revision: mergeRev } };
}

/** POST /api/repos/<org>/<repo>/changes/<n>/queue */
export async function addToQueue(ctx: RequestContext, org: string, repoName: string, number: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'write');
  const repo = await repoOf(ctx, org, repoName);
  const change = await getChange(ctx.tx, repo.id, number);
  if (!change) throw Errors.notFound();
  if (change.state === 'merged') throw Errors.conflict('This change is already merged');
  if (change.state === 'queued') throw Errors.conflict('This change is already in the merge queue');
  if (!repo.queue) throw Errors.conflict('This repository does not use a merge queue');
  if (change.base_branch !== 'main') throw Errors.conflict('Only changes based on main can join the merge queue');
  if (change.draft) throw Errors.conflict('A draft change cannot join the merge queue');
  const diff = await (await import('../store/revisions.js')).changeCombinedDiff(ctx.tx, ctx.storage, change);
  const box = await mergeBoxView(ctx.tx, depsOf(ctx), repo, change, diff);
  if (box.rules.length > 0) throw Errors.conflict('This change has unmet merge rules and cannot join the merge queue');
  const entry = await admitToQueue(depsOf(ctx), ctx.tx, repo.id, change);
  announce(ctx, repo.id, { kind: 'queue', number, entryId: entry.id, position: entry.position, state: entry.state });
  return {
    status: 201,
    body: {
      id: entry.id,
      change: `${repo.org}/${repo.name}#${change.number}`,
      state: entry.state,
      position: entry.position,
      revision: entry.revision,
      reason: null,
    },
  };
}

/** GET /api/repos/<org>/<repo>/queue */
export async function getQueue(ctx: RequestContext, org: string, repoName: string): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'read');
  const repo = await repoOf(ctx, org, repoName);
  const entries = await getQueueEntries(ctx.tx, repo.id);
  const history = await (await import('../store/queue.js')).getQueueHistory(ctx.tx, repo.id);
  const changeByNumber = async (n: number) => getChange(ctx.tx, repo.id, n);
  const entryBody = async (e: typeof entries[number]) => {
    const change = await changeByNumber(e.change_number);
    return {
      id: e.id,
      change: change ? `${repo.org}/${repo.name}#${change.number}` : null,
      state: e.state,
      position: e.position,
      revision: e.revision,
      reason: e.reason,
    };
  };
  return {
    status: 200,
    body: {
      entries: await Promise.all(entries.map(entryBody)),
      history: await Promise.all(history.map(async (e) => ({ ...(await entryBody(e)), ended_at: iso(e.ended_at_ms ?? 0) }))),
    },
  };
}

/** PUT /api/repos/<org>/<repo>/queue/<entry>/position */
export async function moveQueueEntry(ctx: RequestContext, org: string, repoName: string, entryId: number): Promise<{ status: number; body: unknown }> {
  await visibleRepo(ctx, org, repoName, 'maintainer');
  const repo = await repoOf(ctx, org, repoName);
  const entry = await ctx.tx.query('SELECT * FROM queue_entries WHERE id = $1 AND repo_id = $2', [entryId, repo.id]);
  if (entry.rows.length === 0) throw Errors.notFound();
  const body = expectObject(parseBody(ctx));
  const position = typeof body.position === 'number' ? body.position : NaN;
  const entries = await getQueueEntries(ctx.tx, repo.id);
  if (!Number.isInteger(position) || position < 1 || position > entries.length) {
    throw Errors.invalid({ position: `Position must be between 1 and ${entries.length}` });
  }
  const row = entry.rows[0];
  if (row.position === position) return { status: 200, body: entries.map(queueBody) };
  // Move the entry, renumber, then new queue revisions from the lowest move.
  const ordered = entries.filter((e) => e.id !== row.id);
  ordered.splice(position - 1, 0, row);
  let p = 1;
  for (const e of ordered) {
    await ctx.tx.query('UPDATE queue_entries SET position = $1 WHERE id = $2', [p, e.id]);
    p++;
  }
  const { rebuildQueueRevision } = await import('../store/push.js');
  const from = Math.min(row.position, position);
  const after = await getQueueEntries(ctx.tx, repo.id);
  for (const e of after) {
    if (e.position >= from) await rebuildQueueRevision(depsOf(ctx), ctx.tx, repo.id, e.id);
  }
  for (const e of after) announce(ctx, repo.id, { kind: 'queue_position', number: e.change_number, position: e.position });
  const finalEntries = await getQueueEntries(ctx.tx, repo.id);
  return { status: 200, body: finalEntries.map(queueBody) };
}

function queueBody(e: { id: number; change_number: number; state: string; position: number; revision: string; reason: string | null }): unknown {
  return { id: e.id, change: e.change_number, state: e.state, position: e.position, revision: e.revision, reason: e.reason };
}
