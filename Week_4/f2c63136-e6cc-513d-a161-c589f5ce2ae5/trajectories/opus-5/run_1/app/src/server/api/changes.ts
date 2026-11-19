import { serverNow } from '../clock.js';
import { db } from '../db.js';
import { conflict, forbidden, invalid, invalidFields, notFound } from '../errors.js';
import { repoAccess, sendJson, type Ctx } from '../http.js';
import { diffHunks } from '../../domain/diff.js';
import { changeObject, loadChangeView } from '../../domain/changeview.js';
import { mergeChangeNow } from '../../domain/merge.js';
import {
  getChange,
  getUserById,
  listChanges,
  listReviews,
  ROLE_RANK,
  type ChangeRow,
  type RepoRow,
} from '../../domain/model.js';
import { performPush } from '../../domain/push.js';
import { admitToQueue, activeEntries, getEntry, historyEntries, moveEntry, queueEntryObject } from '../../domain/queue.js';
import { dismissReview, mailMentions, requestReview, submitReview, type ReviewType } from '../../domain/reviews.js';
import { getBranchRevision, readFileText } from '../../domain/revisions.js';
import {
  buildSuggestionApplication,
  createThread,
  lineIsInDiff,
  loadThreads,
  markSuggestionsApplied,
  threadObject,
} from '../../domain/threads.js';
import { asString, body, inRepoTx, storageError, wholeNumber } from './common.js';

async function changeOrNotFound(tx: typeof db, repo: RepoRow, number: number): Promise<ChangeRow> {
  const change = await getChange(tx, repo.id, number);
  if (!change) throw notFound();
  return change;
}

export async function handleCreateChange(ctx: Ctx, org: string, name: string): Promise<void> {
  const created = await inRepoTx(ctx, org, name, 'write', {}, async (tx, access) => {
    const repo = access.repo;
    const input = body(ctx);
    const title = asString(input.title);
    const head = asString(input.head);
    const base = asString(input.base);
    const draft = input.draft === true;

    const errors: Record<string, string> = {};
    if (title.length < 1 || title.length > 200) errors.title = 'Title must be 1 to 200 characters';
    if (head === base) errors.head = 'Head and base must differ';
    if (Object.keys(errors).length > 0) throw invalidFields(errors);

    const headRevision = await getBranchRevision(tx, repo.id, head);
    const baseRevision = await getBranchRevision(tx, repo.id, base);
    if (headRevision === null || baseRevision === null) throw notFound();

    const existing = await tx.query(
      "SELECT 1 FROM rs_changes WHERE repo_id = $1 AND head_branch = $2 AND state <> 'merged'",
      [repo.id, head],
    );
    if (existing.length > 0) throw conflict(`An open change already exists for branch ${head}`);

    const numbers = await tx.query<{ next_change_number: number }>(
      'UPDATE rs_repos SET next_change_number = next_change_number + 1 WHERE id = $1 RETURNING next_change_number - 1 AS next_change_number',
      [repo.id],
    );
    const number = Number(numbers[0].next_change_number);
    await tx.query(
      `INSERT INTO rs_changes (repo_id, number, title, description, author_user_id, head_branch, base_branch,
         base_revision, state, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        repo.id,
        number,
        title,
        asString(input.description),
        access.user!.id,
        head,
        base,
        baseRevision,
        draft ? 'draft' : 'open',
        serverNow(),
      ],
    );
    const change = await changeOrNotFound(tx as typeof db, repo, number);
    const view = await loadChangeView(tx, repo, change, access.user!.id);
    return changeObject(view);
  });
  sendJson(ctx.response, 201, created);
}

export async function handleListChanges(ctx: Ctx, org: string, name: string): Promise<void> {
  const access = await repoAccess(db, ctx, org, name, 'read', { tokensAllowed: true });
  const state = ctx.url.searchParams.get('state');
  const viewer = access.user ? access.user.id : null;
  const changes = await listChanges(db, access.repo.id);
  const objects: Array<Record<string, unknown>> = [];
  for (const change of changes) {
    if (state !== null && change.state !== state) continue;
    objects.push(changeObject(await loadChangeView(db, access.repo, change, viewer)));
  }
  sendJson(ctx.response, 200, objects);
}

export async function handleGetChange(ctx: Ctx, org: string, name: string, number: number): Promise<void> {
  const access = await repoAccess(db, ctx, org, name, 'read', { tokensAllowed: true });
  const change = await changeOrNotFound(db, access.repo, number);
  const view = await loadChangeView(db, access.repo, change, access.user ? access.user.id : null);
  sendJson(ctx.response, 200, changeObject(view));
}

export async function handleChangeDiff(ctx: Ctx, org: string, name: string, number: number): Promise<void> {
  const access = await repoAccess(db, ctx, org, name, 'read', { tokensAllowed: true });
  const repo = access.repo;
  const change = await changeOrNotFound(db, repo, number);
  const view = await loadChangeView(db, repo, change, access.user ? access.user.id : null);
  try {
    const files = [];
    for (const file of view.files) {
      const baseText = (await readFileText(db, repo.id, change.baseRevision, file.path)) ?? '';
      const headText = (await readFileText(db, repo.id, view.headRevision, file.path)) ?? '';
      files.push({
        path: file.path,
        status: file.status,
        base_text: baseText,
        head_text: headText,
        hunks: diffHunks(baseText, headText),
      });
    }
    sendJson(ctx.response, 200, { files });
  } catch (error) {
    storageError(error, 'push');
  }
}

export async function handleReady(ctx: Ctx, org: string, name: string, number: number): Promise<void> {
  const object = await inRepoTx(ctx, org, name, 'write', {}, async (tx, access, sink) => {
    const change = await changeOrNotFound(tx as typeof db, access.repo, number);
    if (change.state !== 'draft') throw conflict('This change is not a draft');
    await tx.query("UPDATE rs_changes SET state = 'open' WHERE id = $1", [change.id]);
    sink.add({ kind: 'rules', text: '', change: change.number });
    const updated = await changeOrNotFound(tx as typeof db, access.repo, number);
    return changeObject(await loadChangeView(tx, access.repo, updated, access.user!.id));
  });
  sendJson(ctx.response, 200, object);
}

export async function handleReviewRequest(ctx: Ctx, org: string, name: string, number: number): Promise<void> {
  const result = await inRepoTx(ctx, org, name, 'write', {}, async (tx, access) => {
    const change = await changeOrNotFound(tx as typeof db, access.repo, number);
    return requestReview(tx, access.repo, change, asString(body(ctx).username));
  });
  sendJson(ctx.response, result.created ? 201 : 200, { username: result.user.username });
}

export async function handleCreateThread(ctx: Ctx, org: string, name: string, number: number): Promise<void> {
  const thread = await inRepoTx(ctx, org, name, 'read', {}, async (tx, access, sink) => {
    const repo = access.repo;
    const user = access.user!;
    const change = await changeOrNotFound(tx as typeof db, repo, number);
    if (change.state === 'merged') throw conflict('This change is already merged');

    const input = body(ctx);
    const path = asString(input.path);
    const side = asString(input.side) === 'old' ? 'old' : 'new';
    const line = wholeNumber(input.line);
    const endLine = wholeNumber(input.end_line) ?? line;
    const text = asString(input.body);
    const suggestion = input.suggestion as { lines?: unknown } | undefined;

    if (text.trim() === '') throw invalid('body', 'Comment cannot be empty');
    if (line === null) throw invalid('line', 'Line 0 is not in the diff');
    const headRevision = (await getBranchRevision(tx, repo.id, change.headBranch))!;
    if (!(await lineIsInDiff(tx, repo, change, headRevision, path, side, line))) {
      throw invalid('line', `Line ${line} is not in the diff`);
    }
    let suggestionLines: string[] | null = null;
    if (suggestion && Array.isArray(suggestion.lines)) {
      if (side !== 'new') throw invalid('suggestion', 'Suggestions are only possible on new lines');
      suggestionLines = suggestion.lines.map((entry) => String(entry));
    }

    const threadId = await createThread(tx, change, {
      path,
      side,
      line,
      endLine: endLine ?? line,
      body: text,
      authorUserId: user.id,
      revisionId: side === 'new' ? headRevision : change.baseRevision,
      suggestion: suggestionLines,
    });
    sink.add({ kind: 'comment', text: `#${change.number}: new comment from ${user.name}`, change: change.number });
    await mailMentions(tx, repo, change, user, text);
    const threads = await loadThreads(tx, change.id);
    return threadObject(threads.find((item) => item.id === threadId)!);
  });
  sendJson(ctx.response, 201, thread);
}

export async function handleReply(
  ctx: Ctx,
  org: string,
  name: string,
  number: number,
  threadId: number,
): Promise<void> {
  const comment = await inRepoTx(ctx, org, name, 'read', {}, async (tx, access, sink) => {
    const repo = access.repo;
    const user = access.user!;
    const change = await changeOrNotFound(tx as typeof db, repo, number);
    const threads = await loadThreads(tx, change.id);
    const thread = threads.find((item) => item.id === threadId);
    if (!thread) throw notFound();
    const text = asString(body(ctx).body);
    if (text.trim() === '') throw invalid('body', 'Comment cannot be empty');
    const rows = await tx.query<{ id: string }>(
      'INSERT INTO rs_comments (thread_id, author_user_id, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [thread.id, user.id, text, serverNow()],
    );
    sink.add({ kind: 'comment', text: `#${change.number}: new comment from ${user.name}`, change: change.number });
    await mailMentions(tx, repo, change, user, text);
    return { id: Number(rows[0].id), author: user.username, body: text };
  });
  sendJson(ctx.response, 201, comment);
}

export async function handleThreadState(
  ctx: Ctx,
  org: string,
  name: string,
  number: number,
  threadId: number,
): Promise<void> {
  const thread = await inRepoTx(ctx, org, name, 'read', {}, async (tx, access, sink) => {
    const change = await changeOrNotFound(tx as typeof db, access.repo, number);
    const threads = await loadThreads(tx, change.id);
    const existing = threads.find((item) => item.id === threadId);
    if (!existing) throw notFound();
    const state = asString(body(ctx).state) === 'resolved' ? 'resolved' : 'unresolved';
    await tx.query('UPDATE rs_threads SET state = $2 WHERE id = $1', [threadId, state]);
    sink.add({ kind: 'rules', text: '', change: change.number });
    const updated = await loadThreads(tx, change.id);
    return threadObject(updated.find((item) => item.id === threadId)!);
  });
  sendJson(ctx.response, 200, thread);
}

export async function handleApplySuggestions(ctx: Ctx, org: string, name: string, number: number): Promise<void> {
  try {
    const result = await inRepoTx(ctx, org, name, 'read', {}, async (tx, access, sink) => {
      const repo = access.repo;
      const user = access.user!;
      const change = await changeOrNotFound(tx as typeof db, repo, number);
      const role = access.role!;
      if (change.authorUserId !== user.id && ROLE_RANK[role] < ROLE_RANK.maintainer) {
        throw forbidden('Only the change author or a maintainer can apply suggestions');
      }
      const raw = body(ctx).comments;
      const ids = Array.isArray(raw) ? raw.map((entry) => Number(entry)) : [];
      if (ids.length === 0) throw invalid('comments', 'comments is required');

      const headRevision = (await getBranchRevision(tx, repo.id, change.headBranch))!;
      const application = await buildSuggestionApplication(tx, repo, change, headRevision, ids);
      const files = [...application.contents.entries()].map(([path, content]) => ({
        path,
        content: content.toString('utf8'),
      }));
      const push = await performPush(
        tx,
        repo,
        {
          branch: change.headBranch,
          expectedHead: headRevision,
          from: null,
          message: application.message,
          files,
          actor: { username: user.username, name: user.name },
        },
        sink,
      );
      await markSuggestionsApplied(tx, ids);
      return { revision: push.revision, message: application.message };
    });
    sendJson(ctx.response, 201, result);
  } catch (error) {
    storageError(error, 'push');
  }
}

export async function handleCreateReview(ctx: Ctx, org: string, name: string, number: number): Promise<void> {
  const review = await inRepoTx(ctx, org, name, 'read', {}, async (tx, access, sink) => {
    const repo = access.repo;
    const user = access.user!;
    const change = await changeOrNotFound(tx as typeof db, repo, number);
    const input = body(ctx);
    const type = asString(input.type) as ReviewType;
    if (!['comment', 'approve', 'request_changes'].includes(type)) {
      throw invalid('type', 'Type must be comment, approve or request_changes');
    }
    if (type !== 'comment' && access.role === 'reader') throw forbidden('Readers cannot approve or request changes');
    if (type === 'approve' && change.authorUserId === user.id) throw forbidden('You cannot approve your own change');

    const id = await submitReview(tx, repo, change, user, type, asString(input.summary), sink);
    const reviews = await listReviews(tx, change.id);
    const created = reviews.find((item) => item.id === id)!;
    return {
      id: created.id,
      reviewer: user.username,
      type: created.type,
      state: created.state,
      summary: created.summary,
      reason: created.reason,
      created_at: `${created.createdAt.toISOString().slice(0, 19)}Z`,
    };
  });
  sendJson(ctx.response, 201, review);
}

export async function handleDismissReview(
  ctx: Ctx,
  org: string,
  name: string,
  number: number,
  reviewId: number,
): Promise<void> {
  const review = await inRepoTx(ctx, org, name, 'maintainer', {}, async (tx, access, sink) => {
    const change = await changeOrNotFound(tx as typeof db, access.repo, number);
    const reviews = await listReviews(tx, change.id);
    const existing = reviews.find((item) => item.id === reviewId);
    if (!existing) throw notFound();
    await dismissReview(tx, change, existing, asString(body(ctx).reason), access.user!, sink);
    const updated = (await listReviews(tx, change.id)).find((item) => item.id === reviewId)!;
    const reviewer = (await getUserById(tx, updated.reviewerUserId))!;
    return {
      id: updated.id,
      reviewer: reviewer.username,
      type: updated.type,
      state: updated.state,
      summary: updated.summary,
      reason: updated.reason,
      created_at: `${updated.createdAt.toISOString().slice(0, 19)}Z`,
    };
  });
  sendJson(ctx.response, 200, review);
}

export async function handleViewed(ctx: Ctx, org: string, name: string, number: number): Promise<void> {
  const counts = await inRepoTx(ctx, org, name, 'read', {}, async (tx, access, sink) => {
    const repo = access.repo;
    const user = access.user!;
    const change = await changeOrNotFound(tx as typeof db, repo, number);
    const view = await loadChangeView(tx, repo, change, user.id);
    const path = asString(body(ctx).path);
    const file = view.files.find((entry) => entry.path === path);
    if (!file) throw invalid('path', 'Path is not in this change');
    if (body(ctx).viewed === true) {
      await tx.query(
        `INSERT INTO rs_viewed (change_id, user_id, path, content_key) VALUES ($1, $2, $3, $4)
         ON CONFLICT (change_id, user_id, path) DO UPDATE SET content_key = $4`,
        [change.id, user.id, path, file.headKey ?? ''],
      );
    } else {
      await tx.query('DELETE FROM rs_viewed WHERE change_id = $1 AND user_id = $2 AND path = $3', [
        change.id,
        user.id,
        path,
      ]);
    }
    const updated = await loadChangeView(tx, repo, change, user.id);
    sink.add({ kind: 'rules', text: '', change: change.number });
    return {
      files_viewed: updated.counts.filesViewed,
      files_total: updated.counts.filesTotal,
      unresolved_threads: updated.counts.unresolvedThreads,
      approvals_remaining: updated.counts.approvalsRemaining,
    };
  });
  sendJson(ctx.response, 200, counts);
}

export async function handleMerge(ctx: Ctx, org: string, name: string, number: number): Promise<void> {
  try {
    const result = await inRepoTx(ctx, org, name, 'write', {}, async (tx, access, sink) => {
      const repo = access.repo;
      const user = access.user!;
      const change = await changeOrNotFound(tx as typeof db, repo, number);
      if (change.state === 'queued') throw conflict('This change is in the merge queue');
      if (change.state === 'merged') throw conflict('This change is already merged');
      if (repo.queueOn) throw conflict('This repository merges through the merge queue');
      const view = await loadChangeView(tx, repo, change, user.id);
      if (view.mergeRules.some((rule) => rule.rule !== 'met')) {
        throw conflict('This change has unmet merge rules and cannot be merged');
      }
      const revision = await mergeChangeNow(tx, repo, change, { username: user.username, name: user.name }, sink);
      return { state: 'merged', revision };
    });
    sendJson(ctx.response, 200, result);
  } catch (error) {
    storageError(error, 'push');
  }
}

export async function handleQueueChange(ctx: Ctx, org: string, name: string, number: number): Promise<void> {
  try {
    const entry = await inRepoTx(ctx, org, name, 'write', {}, async (tx, access, sink) => {
      const change = await changeOrNotFound(tx as typeof db, access.repo, number);
      return admitToQueue(tx, access.repo, change, sink);
    });
    sendJson(ctx.response, 201, queueEntryObject(entry));
  } catch (error) {
    storageError(error, 'push');
  }
}

export async function handleGetQueue(ctx: Ctx, org: string, name: string): Promise<void> {
  const access = await repoAccess(db, ctx, org, name, 'read', { tokensAllowed: true });
  const entries = await activeEntries(db, access.repo.id);
  const history = await historyEntries(db, access.repo.id);
  sendJson(ctx.response, 200, {
    entries: entries.map(queueEntryObject),
    history: history.map(queueEntryObject),
  });
}

export async function handleQueuePosition(
  ctx: Ctx,
  org: string,
  name: string,
  entryId: number,
): Promise<void> {
  try {
    const entries = await inRepoTx(ctx, org, name, 'maintainer', {}, async (tx, access, sink) => {
      const entry = await getEntry(tx, entryId);
      if (!entry || entry.repoId !== access.repo.id) throw notFound();
      const count = (await activeEntries(tx, access.repo.id)).length;
      const position = wholeNumber(body(ctx).position);
      if (position === null || position < 1 || position > count) {
        throw invalid('position', `Position must be between 1 and ${count}`);
      }
      await moveEntry(tx, access.repo, entry, position, sink);
      return (await activeEntries(tx, access.repo.id)).map(queueEntryObject);
    });
    sendJson(ctx.response, 200, entries);
  } catch (error) {
    storageError(error, 'push');
  }
}
