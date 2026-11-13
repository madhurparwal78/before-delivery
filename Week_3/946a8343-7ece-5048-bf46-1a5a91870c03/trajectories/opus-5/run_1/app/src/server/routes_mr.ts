import { readableProject, requireLevel, roleLevels } from './access';
import { db } from './db';
import { diffTrees } from './diff';
import { errors } from './errors';
import { Ctx, Reply, param, route, stringList, text } from './http';
import { emit, seqOf, tx } from './live';
import {
  MergeRequestRow,
  addNote,
  approvalRules,
  canApprove,
  closingIids,
  createThread,
  createVersion,
  firstFailedCheck,
  isDraft,
  latestVersion,
  loadRequest,
  mergeChecks,
  missingApprovals,
  notesOf,
  requireRequest,
  setThreadResolved,
  suggestionsOf,
  systemNote,
  threadsOf,
  unresolvedCount,
  versionsOf,
} from './mr';
import { requestJson, threadJson } from './mrjson';
import {
  cancelAutoMerge,
  commitConflictResolution,
  conflictFiles,
  performMerge,
  rebaseRequest,
} from './merge';
import { addToTrain, mergeNow, removeCar, trainJson } from './train';
import { tryAutoMerge } from './trainhooks';
import { changeFinding, requestReports } from './reports';
import { branchHead, filesOfCommit } from './repo';
import { commitToBranch } from './push';
import { writeAudit } from './access';
import { createIssue } from './planning';
import { queueEvent } from './webhooks';
import { splitLines, joinLines } from './diff';

const base = '/api/projects/:id/merge_requests';

route(
  'POST',
  base,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const title = text(ctx.body, 'title') ?? '';
      const source = text(ctx.body, 'source') ?? '';
      const target = text(ctx.body, 'target') ?? project.default_branch;
      if (title.trim() === '') throw errors.validation('title', "Title can't be blank.");
      if (title.length > 255) throw errors.validation('title', 'Title is too long (255 characters at most).');
      const sourceHead = await branchHead(t.sql, project.id, source);
      if (sourceHead === null) throw errors.validation('source', 'Source branch does not exist.');
      const targetHead = await branchHead(t.sql, project.id, target);
      if (targetHead === null) throw errors.validation('target', 'Target branch does not exist.');
      let description = text(ctx.body, 'description') ?? '';
      if (description === '') {
        const files = await filesOfCommit(t.sql, project.id, targetHead);
        description = files.get('.spurline/request-template.md') ?? '';
      }
      const iidRow = await t.sql.one<{ iid: number }>(
        'update projects set next_mr_iid = next_mr_iid + 1 where id = $1 returning next_mr_iid - 1 as iid',
        [project.id],
      );
      const iid = Number(iidRow?.iid ?? 1);
      const row = await t.sql.one<{ id: string }>(
        `insert into merge_requests (project_id, iid, title, description, author, source, target, state,
                                     delete_source_branch, assignees, reviewers)
         values ($1, $2, $3, $4, $5, $6, $7, 'opened', $8, $9, $10) returning id`,
        [
          project.id,
          iid,
          title,
          description,
          ctx.user.username,
          source,
          target,
          ctx.body.delete_source_branch === true,
          JSON.stringify(stringList(ctx.body, 'assignees') ?? []),
          JSON.stringify(stringList(ctx.body, 'reviewers') ?? []),
        ],
      );
      const request = await loadRequest(t.sql, project.id, iid);
      if (request === null) throw errors.notFound();
      void row;
      await createVersion(t, project, request, sourceHead);
      await emit(t, project.id, 'merge_request', { iid, state: 'opened' });
      await queueEvent(t, project, 'merge_request', {
        event: 'merge_request',
        action: 'open',
        project: { id: project.id, path: project.path },
        merge_request: { iid, title, state: 'opened', source, target },
        user: ctx.user.username,
      });
      return { status: 201, body: { iid, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', base, async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const rows = await db.query<{ iid: number; title: string; state: string; author: string; source: string; target: string }>(
    'select iid, title, state, author, source, target from merge_requests where project_id = $1 order by iid desc',
    [project.id],
  );
  return {
    status: 200,
    body: {
      merge_requests: rows.map((row) => ({
        iid: Number(row.iid),
        title: row.title,
        state: row.state,
        draft: isDraft(row.title),
        author: row.author,
        source: row.source,
        target: row.target,
      })),
    },
  };
});

route('GET', `${base}/:iid`, async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const request = await requireRequest(db, project.id, param(ctx, 'iid'));
  return { status: 200, body: await requestJson(db, project, request, ctx.user.id, ctx.user.username) };
});

route(
  'PATCH',
  `${base}/:iid`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      if (request.state === 'merged' && ctx.body.state_event !== undefined) {
        throw errors.conflict('wrong_state', 'This merge request is already merged.');
      }
      const title = text(ctx.body, 'title');
      if (title !== null) {
        if (title.trim() === '') throw errors.validation('title', "Title can't be blank.");
        if (title.length > 255) throw errors.validation('title', 'Title is too long (255 characters at most).');
        const wasDraft = isDraft(request.title);
        await t.sql.query('update merge_requests set title = $2 where id = $1', [request.id, title]);
        if (!wasDraft && isDraft(title)) await systemNote(t, request, ctx.user.username, 'Marked as draft.');
        if (wasDraft && !isDraft(title)) await systemNote(t, request, ctx.user.username, 'Marked as ready.');
      }
      const description = text(ctx.body, 'description');
      if (description !== null) {
        await t.sql.query('update merge_requests set description = $2 where id = $1', [request.id, description]);
      }
      const target = text(ctx.body, 'target');
      if (target !== null && target !== request.target) {
        await t.sql.query('update merge_requests set target = $2 where id = $1', [request.id, target]);
        await systemNote(t, request, ctx.user.username, `Changed target from ${request.target} to ${target}.`);
        if (request.auto_merge) await cancelAutoMerge(t, project, request, 'the target branch changed');
      }
      const assignees = stringList(ctx.body, 'assignees');
      if (assignees !== null) {
        await t.sql.query('update merge_requests set assignees = $2 where id = $1', [
          request.id,
          JSON.stringify(assignees),
        ]);
      }
      const reviewers = stringList(ctx.body, 'reviewers');
      if (reviewers !== null) {
        await t.sql.query('update merge_requests set reviewers = $2 where id = $1', [
          request.id,
          JSON.stringify(reviewers),
        ]);
      }
      const event = text(ctx.body, 'state_event');
      if (event === 'close') {
        await t.sql.query("update merge_requests set state = 'closed' where id = $1", [request.id]);
        await systemNote(t, request, ctx.user.username, 'Closed.');
        await removeCar(t, project, request, `removed by ${ctx.user.username}`, false);
      }
      if (event === 'reopen') {
        await t.sql.query("update merge_requests set state = 'opened' where id = $1", [request.id]);
        await systemNote(t, request, ctx.user.username, 'Reopened.');
      }
      if (event === 'ready') {
        if (!isDraft(request.title)) {
          throw errors.conflict('wrong_state', "This merge request isn't a draft.");
        }
        await t.sql.query('update merge_requests set title = $2 where id = $1', [
          request.id,
          request.title.replace(/^Draft: /, ''),
        ]);
        await systemNote(t, request, ctx.user.username, 'Marked as ready.');
      }
      await emit(t, project.id, 'merge_request', { iid: request.iid });
      const updated = await requireRequest(t.sql, project.id, request.iid);
      return {
        status: 200,
        body: { ...(await requestJson(t.sql, project, updated, ctx.user.id, ctx.user.username)), seq: await seqOf(t, project.id) },
      };
    }),
  { write: true },
);

route('GET', `${base}/:iid/diff`, async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const request = await requireRequest(db, project.id, param(ctx, 'iid'));
  const versions = await versionsOf(db, request.id);
  const fromParam = ctx.url.searchParams.get('from') ?? 'target';
  const toParam = ctx.url.searchParams.get('to');
  const latest = versions[versions.length - 1] ?? null;
  const toVersion = toParam === null ? latest : versions.find((version) => version.number === Number(toParam)) ?? latest;
  if (toVersion === null) return { status: 200, body: { merge_base: null, commits: [], diffs: [] } };
  const fromCommit =
    fromParam === 'target'
      ? toVersion.base
      : versions.find((version) => version.number === Number(fromParam))?.head ?? toVersion.base;
  const before = await filesOfCommit(db, project.id, fromCommit);
  const after = await filesOfCommit(db, project.id, toVersion.head);
  const commits = await (await import('./repo')).historyFor(db, project.id, toVersion.head, null);
  const reach = await (await import('./repo')).ancestors(db, project.id, fromCommit);
  return {
    status: 200,
    body: {
      merge_base: fromCommit,
      commits: commits
        .filter((commit) => !reach.has(commit.id))
        .map((commit) => ({
          id: commit.id,
          parents: commit.parents,
          author: commit.author,
          authored_at: new Date(commit.authored_at * 1000).toISOString(),
          committer: commit.committer,
          committed_at: new Date(commit.committed_at * 1000).toISOString(),
          message: commit.message,
        })),
      diffs: diffTrees(before, after),
    },
  };
});

route('GET', `${base}/:iid/threads`, async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const request = await requireRequest(db, project.id, param(ctx, 'iid'));
  return { status: 200, body: { threads: await threadJson(db, request, ctx.user.username) } };
});

route('GET', `${base}/:iid/notes`, async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const request = await requireRequest(db, project.id, param(ctx, 'iid'));
  const filter = ctx.url.searchParams.get('filter') ?? 'all';
  const notes = await notesOf(db, request, ctx.user.username, filter);
  return { status: 200, body: { notes } };
});

route(
  'POST',
  `${base}/:iid/threads`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'reporter');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      const body = text(ctx.body, 'body') ?? '';
      const rawPosition = ctx.body.position as Record<string, unknown> | null | undefined;
      const latest = await latestVersion(t.sql, request.id);
      const position =
        rawPosition === null || rawPosition === undefined
          ? null
          : {
              path: String(rawPosition.path ?? ''),
              old_line: rawPosition.old_line === null || rawPosition.old_line === undefined ? null : Number(rawPosition.old_line),
              new_line: rawPosition.new_line === null || rawPosition.new_line === undefined ? null : Number(rawPosition.new_line),
              end_line: rawPosition.end_line === null || rawPosition.end_line === undefined ? null : Number(rawPosition.end_line),
              version:
                rawPosition.version === null || rawPosition.version === undefined
                  ? latest?.number ?? 1
                  : Number(rawPosition.version),
            };
      const created = await createThread(
        t,
        project,
        request,
        ctx.user.username,
        body,
        position,
        ctx.body.pending === true,
      );
      await emit(t, project.id, 'checks', { iid: request.iid });
      return { status: 201, body: { id: created.threadId, note: created.noteId, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  `${base}/:iid/threads/:tid/notes`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'reporter');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      const threads = await threadsOf(t.sql, request.id);
      const thread = threads.find((item) => item.id === param(ctx, 'tid'));
      if (thread === undefined) throw errors.notFound();
      const noteId = await addNote(t, request, ctx.user.username, text(ctx.body, 'body') ?? '', {
        threadId: thread.id,
        pending: ctx.body.pending === true,
      });
      await emit(t, project.id, 'thread', { iid: request.iid, thread_id: thread.id, action: 'reply' });
      return { status: 201, body: { id: noteId, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'PATCH',
  `${base}/:iid/threads/:tid`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'reporter');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      const threads = await threadsOf(t.sql, request.id);
      const thread = threads.find((item) => item.id === param(ctx, 'tid'));
      if (thread === undefined) throw errors.notFound();
      const resolved = ctx.body.resolved === true;
      const left = await setThreadResolved(t, project, request, thread, resolved);
      await emit(t, project.id, 'checks', { iid: request.iid });
      return { status: 200, body: { id: thread.id, resolved, unresolved: left, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  `${base}/:iid/threads/move_to_issue`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'reporter');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      const threads = (await threadsOf(t.sql, request.id)).filter((thread) => !thread.resolved);
      const notes = await notesOf(t.sql, request, ctx.user.username, 'comments');
      const body = threads
        .map((thread) => {
          const first = notes.find((note) => note.thread_id === thread.id);
          const place =
            thread.position === null
              ? 'merge request'
              : `${thread.position.path} line ${thread.position.new_line ?? thread.position.old_line}`;
          return `${place}:\n> ${(first?.body ?? '').split('\n').join('\n> ')}`;
        })
        .join('\n\n');
      const issue = await createIssue(t, project, ctx.user.username, {
        title: `Threads from !${request.iid}`,
        description: body,
      });
      for (const thread of threads) {
        await setThreadResolved(t, project, request, thread, true);
      }
      const note =
        threads.length === 1
          ? `Moved 1 thread to #${issue.iid}.`
          : `Moved ${threads.length} threads to #${issue.iid}.`;
      await systemNote(t, request, ctx.user.username, note);
      return {
        status: 201,
        body: { issue_iid: issue.iid, moved: threads.length, seq: await seqOf(t, project.id) },
      };
    }),
  { write: true },
);

route(
  'POST',
  `${base}/:iid/review`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'reporter');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      const pending = await t.sql.query<{ id: string }>(
        'select id from notes where mr_id = $1 and pending = true and author = $2 order by id',
        [request.id, ctx.user.username],
      );
      await t.sql.query('update notes set pending = false where mr_id = $1 and pending = true and author = $2', [
        request.id,
        ctx.user.username,
      ]);
      const summary = text(ctx.body, 'summary');
      if (summary !== null && summary.trim() !== '') {
        await addNote(t, request, ctx.user.username, summary);
      }
      const count = pending.length;
      await emit(t, project.id, 'review', {
        iid: request.iid,
        published: count,
        author: ctx.user.username,
        announcement: count === 1 ? 'Review submitted: 1 comment' : `Review submitted: ${count} comments`,
      });
      await emit(t, project.id, 'checks', { iid: request.iid });
      return { status: 200, body: { published: count, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'DELETE',
  `${base}/:iid/review`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      const threads = await t.sql.query<{ thread_id: string | null }>(
        'select distinct thread_id from notes where mr_id = $1 and pending = true and author = $2',
        [request.id, ctx.user.username],
      );
      await t.sql.query('delete from notes where mr_id = $1 and pending = true and author = $2', [
        request.id,
        ctx.user.username,
      ]);
      for (const row of threads) {
        if (row.thread_id === null) continue;
        const left = await t.sql.one<{ count: string }>(
          'select count(*)::text as count from notes where thread_id = $1',
          [Number(row.thread_id)],
        );
        if (Number(left?.count ?? '0') === 0) {
          await t.sql.query('delete from threads where id = $1', [Number(row.thread_id)]);
        }
      }
      await emit(t, project.id, 'review', { iid: request.iid, discarded: true });
      return { status: 204, body: null };
    }),
  { write: true },
);

route(
  'POST',
  `${base}/:iid/suggestions/apply`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      const ids = (ctx.body.ids as unknown[] | undefined ?? []).map((value) => Number(value));
      const all = await suggestionsOf(t.sql, request.id);
      const threads = await threadsOf(t.sql, request.id);
      const chosen = ids.map((id) => all.find((item) => item.id === id)).filter((item) => item !== undefined);
      if (chosen.length === 0) throw errors.notFound();
      for (const suggestion of chosen) {
        if (suggestion === undefined) continue;
        const thread = threads.find((item) => item.id === suggestion.thread_id);
        if (suggestion.state === 'outdated' || thread?.outdated === true) {
          throw errors.conflict('suggestion_outdated', 'This suggestion is outdated: the lines changed.');
        }
      }
      for (const suggestion of chosen) {
        if (suggestion === undefined) continue;
        for (const other of chosen) {
          if (other === undefined || other.id === suggestion.id) continue;
          if (other.path !== suggestion.path) continue;
          if (other.start_line <= suggestion.end_line && suggestion.start_line <= other.end_line) {
            const first = suggestion.id < other.id ? suggestion : other;
            throw errors.conflict(
              'suggestion_overlap',
              `These suggestions overlap: ${first.path} lines ${first.start_line}-${first.end_line}.`,
            );
          }
        }
      }
      for (const suggestion of chosen) {
        if (suggestion === undefined) continue;
        if (suggestion.state === 'applied') {
          throw errors.conflict('suggestion_applied', 'This suggestion was already applied.');
        }
      }
      for (const suggestion of chosen) {
        if (suggestion === undefined) continue;
        const thread = threads.find((item) => item.id === suggestion.thread_id);
        if (thread?.resolved === true) {
          throw errors.conflict('thread_resolved', 'This thread is resolved.');
        }
      }
      const sourceHead = await branchHead(t.sql, project.id, request.source);
      if (sourceHead === null) throw errors.notFound();
      const files = await filesOfCommit(t.sql, project.id, sourceHead);
      const byPath = new Map<string, typeof chosen>();
      for (const suggestion of chosen) {
        if (suggestion === undefined) continue;
        const bucket = byPath.get(suggestion.path) ?? [];
        bucket.push(suggestion);
        byPath.set(suggestion.path, bucket);
      }
      const actions = [];
      for (const [path, items] of byPath) {
        const lines = splitLines(files.get(path) ?? '');
        const sorted = items
          .filter((item) => item !== undefined)
          .sort((a, b) => (b?.start_line ?? 0) - (a?.start_line ?? 0));
        for (const suggestion of sorted) {
          if (suggestion === undefined) continue;
          lines.splice(suggestion.start_line - 1, suggestion.end_line - suggestion.start_line + 1, ...suggestion.lines);
        }
        actions.push({ action: 'update' as const, path, content: joinLines(lines) });
      }
      const fileCount = byPath.size;
      const message =
        chosen.length === 1
          ? `Apply suggestion to ${chosen[0]?.path}`
          : `Apply ${chosen.length} suggestions to ${fileCount} files`;
      const result = await commitToBranch(t, {
        project,
        access,
        actor: ctx.user.username,
        branch: request.source,
        baseCommit: sourceHead,
        message,
        actions,
      });
      for (const suggestion of chosen) {
        if (suggestion === undefined) continue;
        await t.sql.query("update suggestions set state = 'applied' where id = $1", [suggestion.id]);
        const thread = threads.find((item) => item.id === suggestion.thread_id);
        if (thread !== undefined) {
          const fresh = (await threadsOf(t.sql, request.id)).find((item) => item.id === thread.id);
          if (fresh !== undefined && !fresh.resolved) {
            await setThreadResolved(t, project, request, fresh, true);
          }
        }
      }
      return { status: 201, body: { commit: result.commit, seq: await seqOf(t, project.id) } };
    }),
  { write: true, limit: 'commit' },
);

route(
  'POST',
  `${base}/:iid/approve`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      if (!canApprove(access)) throw errors.forbidden();
      if (request.author === ctx.user.username && !project.settings.author_can_approve) {
        throw new (await import('./errors')).ApiError(
          403,
          'author_cannot_approve',
          "Authors can't approve their own merge request.",
        );
      }
      const state = await approvalRules(t.sql, project, request);
      const eligible =
        state.rules.length === 0
          ? true
          : state.rules.some((rule) => rule.eligible.includes(ctx.user.username));
      if (!eligible) {
        throw new (await import('./errors')).ApiError(
          403,
          'not_eligible',
          "You aren't eligible to approve this merge request.",
        );
      }
      const sha = text(ctx.body, 'sha');
      const sourceHead = await branchHead(t.sql, project.id, request.source);
      if (sha !== null && sha !== sourceHead) {
        throw errors.conflict('stale_head', 'The source branch changed. Review the new commits and try again.');
      }
      await t.sql.query('insert into approvals (mr_id, username) values ($1, $2) on conflict do nothing', [
        request.id,
        ctx.user.username,
      ]);
      await systemNote(t, request, ctx.user.username, `Approved by @${ctx.user.username}.`);
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'approval.add',
        `${project.path}!${request.iid}`,
        null,
        { user: ctx.user.username },
      );
      const after = await approvalRules(t.sql, project, request);
      const missing = missingApprovals(after.rules);
      const announcement =
        missing.total === 0
          ? 'Approved. All approval rules are satisfied.'
          : missing.total === 1
            ? `Approved. Needs 1 more approval: ${missing.names.join(', ')}.`
            : `Approved. Needs ${missing.total} more approvals: ${missing.names.join(', ')}.`;
      await emit(t, project.id, 'approvals', { iid: request.iid, announcement });
      await emit(t, project.id, 'checks', { iid: request.iid });
      await queueEvent(t, project, 'merge_request', {
        event: 'merge_request',
        action: 'approve',
        project: { id: project.id, path: project.path },
        merge_request: {
          iid: request.iid,
          title: request.title,
          state: request.state,
          source: request.source,
          target: request.target,
        },
        user: ctx.user.username,
      });
      await tryAutoMerge(t, project, request.iid);
      return {
        status: 200,
        body: {
          rules: after.rules,
          approved_by: after.approvedBy,
          announcement,
          seq: await seqOf(t, project.id),
        },
      };
    }),
  { write: true, idempotent: true },
);

route(
  'DELETE',
  `${base}/:iid/approve`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      await t.sql.query('delete from approvals where mr_id = $1 and username = $2', [request.id, ctx.user.username]);
      await systemNote(t, request, ctx.user.username, `Revoked approval by @${ctx.user.username}.`);
      await writeAudit(
        t,
        { projectId: project.id },
        ctx.user.username,
        'approval.remove',
        `${project.path}!${request.iid}`,
        { user: ctx.user.username },
        null,
      );
      const after = await approvalRules(t.sql, project, request);
      await emit(t, project.id, 'approvals', { iid: request.iid });
      await emit(t, project.id, 'checks', { iid: request.iid });
      return { status: 200, body: { rules: after.rules, approved_by: after.approvedBy, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  `${base}/:iid/merge`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      const outcome = await performMerge(t, project, access, request, text(ctx.body, 'sha'), ctx.user.username);
      return {
        status: 200,
        body: { state: outcome.state, merge_commit: outcome.merge_commit, seq: await seqOf(t, project.id) },
      };
    }),
  { write: true, idempotent: true },
);

route(
  'POST',
  `${base}/:iid/auto_merge`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      const sha = text(ctx.body, 'sha');
      const sourceHead = await branchHead(t.sql, project.id, request.source);
      if (sha !== null && sha !== sourceHead) {
        throw errors.conflict('stale_head', 'The source branch changed. Review the new commits and try again.');
      }
      await t.sql.query('update merge_requests set auto_merge = true, auto_merge_sha = $2 where id = $1', [
        request.id,
        sourceHead,
      ]);
      await emit(t, project.id, 'merge_request', { iid: request.iid, auto_merge: true });
      const merged = await tryAutoMerge(t, project, request.iid);
      return { status: 200, body: { auto_merge: !merged, merged, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'DELETE',
  `${base}/:iid/auto_merge`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      await cancelAutoMerge(t, project, request, `canceled by ${ctx.user.username}`);
      await emit(t, project.id, 'merge_request', { iid: request.iid, auto_merge: false });
      return { status: 200, body: { auto_merge: false, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  `${base}/:iid/rebase`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      const head = await rebaseRequest(t, project, access, request, ctx.user.username);
      return { status: 200, body: { source_head: head, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', `${base}/:iid/conflicts`, async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const request = await requireRequest(db, project.id, param(ctx, 'iid'));
  const files = await conflictFiles(db, project, request);
  return { status: 200, body: { files, source: request.source, target: request.target } };
});

route(
  'POST',
  `${base}/:iid/conflicts`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      const raw = (ctx.body.files as unknown[] | undefined) ?? [];
      const conflicts = await conflictFiles(t.sql, project, request);
      const resolutions: { path: string; content: string }[] = [];
      for (const item of raw) {
        const entry = item as Record<string, unknown>;
        const path = String(entry.path ?? '');
        if (typeof entry.content === 'string') {
          resolutions.push({ path, content: entry.content });
          continue;
        }
        const hunks = (entry.hunks as string[] | undefined) ?? [];
        const marked = conflicts.find((file) => file.path === path);
        if (marked === undefined) continue;
        resolutions.push({ path, content: resolveHunks(marked.content, hunks) });
      }
      const commit = await commitConflictResolution(t, project, access, request, resolutions, ctx.user.username);
      return { status: 201, body: { commit, seq: await seqOf(t, project.id) } };
    }),
  { write: true, limit: 'commit' },
);

function resolveHunks(marked: string, choices: string[]): string {
  const lines = splitLines(marked);
  const out: string[] = [];
  let index = 0;
  let hunk = 0;
  while (index < lines.length) {
    if (lines[index].startsWith('<<<<<<< ')) {
      const ours: string[] = [];
      const theirs: string[] = [];
      index += 1;
      while (index < lines.length && lines[index] !== '=======') {
        ours.push(lines[index]);
        index += 1;
      }
      index += 1;
      while (index < lines.length && !lines[index].startsWith('>>>>>>> ')) {
        theirs.push(lines[index]);
        index += 1;
      }
      index += 1;
      out.push(...(choices[hunk] === 'theirs' ? theirs : ours));
      hunk += 1;
      continue;
    }
    out.push(lines[index]);
    index += 1;
  }
  return joinLines(out);
}

route(
  'POST',
  `${base}/:iid/train`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      await addToTrain(t, project, access, request, ctx.user.username);
      return {
        status: 201,
        body: { ...(await trainJson(t.sql, project.id, request.target)), seq: await seqOf(t, project.id) },
      };
    }),
  { write: true },
);

route(
  'DELETE',
  `${base}/:iid/train`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      await removeCar(t, project, request, `removed by ${ctx.user.username}`, true);
      return {
        status: 200,
        body: { ...(await trainJson(t.sql, project.id, request.target)), seq: await seqOf(t, project.id) },
      };
    }),
  { write: true },
);

route(
  'POST',
  `${base}/:iid/train/merge_now`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      await mergeNow(t, project, access, request, ctx.user.username);
      return {
        status: 200,
        body: { ...(await trainJson(t.sql, project.id, request.target)), seq: await seqOf(t, project.id) },
      };
    }),
  { write: true },
);

route('GET', '/api/projects/:id/train', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const target = ctx.url.searchParams.get('target') ?? project.default_branch;
  return { status: 200, body: await trainJson(db, project.id, target) };
});

route('GET', '/api/projects/:id/train/:iid/tree', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const request = await requireRequest(db, project.id, param(ctx, 'iid'));
  const { carOfRequest } = await import('./train');
  const car = await carOfRequest(db, request);
  if (car === null) throw errors.notFound();
  const commit = await (await import('./repo')).loadCommit(db, project.id, car.sha);
  const files = await filesOfCommit(db, project.id, car.sha);
  return {
    status: 200,
    body: { sha: car.sha, tree: commit.tree, files: Object.fromEntries(files) },
  };
});

route('GET', `${base}/:iid/reports`, async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const request = await requireRequest(db, project.id, param(ctx, 'iid'));
  return { status: 200, body: await requestReports(db, project, request) };
});

route(
  'PATCH',
  '/api/projects/:id/findings/:finding',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      const findingId = param(ctx, 'finding');
      const row = await t.sql.one<{ mr_id: string }>('select mr_id from findings where id = $1 and project_id = $2', [
        findingId,
        project.id,
      ]);
      if (row === null) throw errors.notFound();
      const request = await t.sql.one<{ iid: number }>('select iid from merge_requests where id = $1', [
        Number(row.mr_id),
      ]);
      if (request === null) throw errors.notFound();
      const full = await requireRequest(t.sql, project.id, Number(request.iid));
      const state = text(ctx.body, 'state') ?? '';
      if (state === 'dismissed' && access.level < roleLevels.maintainer && !access.permissions.includes('dismiss_finding')) {
        throw errors.forbidden();
      }
      const finding = await changeFinding(
        t,
        project,
        full,
        findingId,
        state,
        text(ctx.body, 'reason'),
        ctx.user.username,
      );
      return { status: 200, body: { ...finding, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  `${base}/:iid/notes`,
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'reporter');
      const request = await requireRequest(t.sql, project.id, param(ctx, 'iid'));
      const body = text(ctx.body, 'body') ?? '';
      const closes = closingIids(body);
      void closes;
      const results: string[] = [];
      const allowed = ['assign', 'unassign', 'label', 'unlabel', 'milestone', 'close', 'reopen', 'title'];
      const actionLines = body
        .split('\n')
        .filter((line) => /^\/(\w+)/.test(line.trim()))
        .map((line) => line.trim());
      let remaining = body;
      if (actionLines.length > 0) {
        remaining = body
          .split('\n')
          .filter((line) => !actionLines.includes(line.trim()))
          .join('\n')
          .trim();
        for (const line of actionLines) {
          const match = /^\/(\w+)\s*(.*)$/.exec(line);
          if (match === null) continue;
          const action = match[1];
          if (!allowed.includes(action)) continue;
          const result = await runRequestAction(t, project, request, ctx.user.username, action, match[2].trim());
          if (result !== null) results.push(result);
        }
      }
      if (remaining !== '') {
        await addNote(t, request, ctx.user.username, remaining);
      }
      await emit(t, project.id, 'merge_request', { iid: request.iid });
      return { status: 201, body: { results, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

async function runRequestAction(
  t: import('./live').Tx,
  project: import('./access').ProjectRow,
  request: MergeRequestRow,
  actor: string,
  action: string,
  argument: string,
): Promise<string | null> {
  if (action === 'assign' || action === 'unassign') {
    const username = argument.replace('@', '');
    const user = await t.sql.one<{ id: string }>('select id from users where username = $1', [username]);
    if (user === null) return `Could not apply /${action}: user @${username} doesn't exist.`;
    const next =
      action === 'assign'
        ? [...new Set([...request.assignees, username])]
        : request.assignees.filter((item) => item !== username);
    await t.sql.query('update merge_requests set assignees = $2 where id = $1', [request.id, JSON.stringify(next)]);
    const text2 = action === 'assign' ? `Assigned @${username}.` : `Unassigned @${username}.`;
    await systemNote(t, request, actor, text2);
    return text2;
  }
  if (action === 'close') {
    await t.sql.query("update merge_requests set state = 'closed' where id = $1", [request.id]);
    await systemNote(t, request, actor, 'Closed.');
    return 'Closed.';
  }
  if (action === 'reopen') {
    await t.sql.query("update merge_requests set state = 'opened' where id = $1", [request.id]);
    await systemNote(t, request, actor, 'Reopened.');
    return 'Reopened.';
  }
  if (action === 'title') {
    await t.sql.query('update merge_requests set title = $2 where id = $1', [request.id, argument]);
    const text2 = `Changed title to ${argument}.`;
    await systemNote(t, request, actor, text2);
    return text2;
  }
  return null;
}

route('GET', `${base}/:iid/checks`, async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const request = await requireRequest(db, project.id, param(ctx, 'iid'));
  const checks = await mergeChecks(db, project, request);
  const failed = firstFailedCheck(checks);
  return {
    status: 200,
    body: { checks, first_failed: failed, unresolved: await unresolvedCount(db, request.id) },
  };
});

