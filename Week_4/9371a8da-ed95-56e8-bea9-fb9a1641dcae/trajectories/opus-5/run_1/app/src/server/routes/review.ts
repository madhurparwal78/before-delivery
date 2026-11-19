import { one, transaction, Tx } from '../db.js';
import { applyAcceptedSuggestion, liveFileById } from '../domain/files.js';
import { newId } from '../domain/ids.js';
import { attemptNow, recordMentionEmails } from '../domain/mentions.js';
import { loadReview } from '../domain/review.js';
import { fileShape, FileRow, iso, personView, Suggestion } from '../domain/shapes.js';
import { allowedKeys, FieldCheck } from '../domain/validation.js';
import { Ctx, Reply, requireProject } from '../http/context.js';
import { ApiError, conflict, invalid, notFound } from '../http/errors.js';
import { Route } from '../http/router.js';
import { actorOf } from './files.js';

interface SuggestionRow {
  id: string;
  project_id: string;
  file_id: string;
  from_pos: number | null;
  to_pos: number | null;
  deleted_text: string;
  inserted: string;
  status: 'open' | 'accepted' | 'rejected' | 'orphaned';
  author_id: string;
  created_at: Date;
  resolved_by: string | null;
  resolved_at: Date | null;
  orphaned_at: Date | null;
}

interface ThreadRow {
  id: string;
  project_id: string;
  file_id: string;
  from_pos: number | null;
  to_pos: number | null;
  quote: string;
  status: 'open' | 'resolved';
  orphaned_at: Date | null;
  resolved_by: string | null;
  created_at: Date;
}

async function readReview(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'read');
  const review = await loadReview(access.project.id, 'member');
  return { status: 200, body: review };
}

interface SuggestionJoinRow {
  id: string;
  file_id: string;
  from_pos: number | null;
  to_pos: number | null;
  deleted_text: string;
  inserted: string;
  status: Suggestion['status'];
  created_at: Date;
  resolved_at: Date | null;
  author_id: string;
  author_display_name: string;
  author_handle: string;
  author_email: string;
  resolver_id: string | null;
  resolver_display_name: string | null;
  resolver_handle: string | null;
  resolver_email: string | null;
}

async function suggestionShape(tx: Tx, id: string): Promise<Suggestion> {
  const row = (await tx.one<SuggestionJoinRow>(
    `select s.id, s.file_id, s.from_pos, s.to_pos, s.deleted_text, s.inserted, s.status,
            s.created_at, s.resolved_at,
            a.id as author_id, a.display_name as author_display_name,
            a.handle as author_handle, a.email as author_email,
            r.id as resolver_id, r.display_name as resolver_display_name,
            r.handle as resolver_handle, r.email as resolver_email
       from suggestions s
       join users a on a.id = s.author_id
       left join users r on r.id = s.resolved_by
      where s.id = $1`,
    [id],
  )) as SuggestionJoinRow;
  return {
    id: row.id,
    fileId: row.file_id,
    from: row.from_pos,
    to: row.to_pos,
    deleted: row.deleted_text,
    inserted: row.inserted,
    status: row.status,
    author: personView.person({
      id: row.author_id,
      display_name: row.author_display_name,
      handle: row.author_handle,
      email: row.author_email,
    }),
    createdAt: iso(row.created_at),
    resolvedBy:
      row.resolver_id === null
        ? null
        : personView.person({
            id: row.resolver_id,
            display_name: row.resolver_display_name as string,
            handle: row.resolver_handle as string,
            email: row.resolver_email as string,
          }),
    resolvedAt: row.resolved_at === null ? null : iso(row.resolved_at),
  };
}

async function threadShape(tx: Tx, id: string): Promise<unknown> {
  const row = (await tx.one<ThreadRow>(`select * from threads where id = $1`, [id])) as ThreadRow;
  const comments = await tx.query<{
    id: string;
    body: string;
    created_at: Date;
    author_id: string;
    display_name: string;
    handle: string;
    email: string;
  }>(
    `select c.id, c.body, c.created_at, u.id as author_id, u.display_name, u.handle, u.email
       from comments c join users u on u.id = c.author_id
      where c.thread_id = $1 order by c.created_at, c.id`,
    [id],
  );
  const resolver =
    row.resolved_by === null
      ? null
      : await tx.one<{ id: string; display_name: string; handle: string; email: string }>(
          `select id, display_name, handle, email from users where id = $1`,
          [row.resolved_by],
        );
  return {
    id: row.id,
    fileId: row.file_id,
    from: row.from_pos,
    to: row.to_pos,
    quote: row.quote,
    status: row.status,
    orphaned: row.orphaned_at !== null,
    comments: comments.map((comment) => ({
      id: comment.id,
      author: personView.person({
        id: comment.author_id,
        display_name: comment.display_name,
        handle: comment.handle,
        email: comment.email,
      }),
      body: comment.body,
      createdAt: iso(comment.created_at),
    })),
    resolvedBy: resolver === null ? null : personView.person(resolver),
  };
}

function checkAnchor(
  ctx: Ctx,
  file: FileRow,
  options: { allowEmpty: boolean },
): { from: number; to: number } {
  const check = new FieldCheck(ctx.body);
  const from = check.integer('from', { min: 0 });
  const to = check.integer('to', { min: 0 });
  const length = (file.content ?? '').length;
  if (from !== null && from > length) check.fail('from', 'Out of range.');
  if (to !== null && to > length) check.fail('to', 'Out of range.');
  if (from !== null && to !== null && from > to) check.fail('to', 'Out of range.');
  if (!options.allowEmpty && from !== null && to !== null && from === to) {
    check.fail('to', 'Select a passage.');
  }
  check.done();
  return { from: from as number, to: to as number };
}

async function createSuggestion(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'review');
  const file = await one<FileRow>(
    `select * from files where project_id = $1 and id = $2 and deleted = false`,
    [access.project.id, ctx.params.fid],
  );
  if (file === null) throw notFound();

  allowedKeys(ctx.body, ['baseRevision', 'from', 'to', 'inserted']);
  const check = new FieldCheck(ctx.body);
  const baseRevision = check.integer('baseRevision', { min: 1 });
  const inserted = check.text('inserted', { min: 0, max: 10_000 });
  check.done();
  if (baseRevision !== file.revision) {
    throw new ApiError(412, 'stale_revision', { current: fileShape(file, true) });
  }
  const anchor = checkAnchor(ctx, file, { allowEmpty: true });
  const deleted = (file.content ?? '').slice(anchor.from, anchor.to);
  if (deleted === '' && inserted === '') {
    throw invalid({ inserted: 'Suggest a change.' });
  }

  return transaction(async (tx) => {
    const id = newId('s');
    await tx.query(
      `insert into suggestions
         (id, project_id, file_id, from_pos, to_pos, deleted_text, inserted, status, author_id)
       values ($1, $2, $3, $4, $5, $6, $7, 'open', $8)`,
      [
        id,
        access.project.id,
        file.id,
        anchor.from,
        anchor.to,
        deleted,
        inserted as string,
        access.user.id,
      ],
    );
    return { status: 201, body: { suggestion: await suggestionShape(tx, id) } };
  });
}

async function acceptSuggestion(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'resolve');
  const exists = await one<SuggestionRow>(
    `select * from suggestions where project_id = $1 and id = $2`,
    [access.project.id, ctx.params.sid],
  );
  if (exists === null) throw notFound();
  allowedKeys(ctx.body, []);

  return transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    const row = (await tx.one<SuggestionRow>(
      `select * from suggestions where id = $1 for update`,
      [ctx.params.sid],
    )) as SuggestionRow;
    if (row.status !== 'open') {
      throw conflict('suggestion_closed', { suggestion: await suggestionShape(tx, row.id) });
    }
    const file = await liveFileById(tx, access.project.id, row.file_id);
    if (file === null) throw notFound();
    await tx.query(
      `update suggestions set status = 'accepted', resolved_by = $2, resolved_at = now()
        where id = $1`,
      [row.id, access.user.id],
    );
    const applied = await applyAcceptedSuggestion(tx, {
      file,
      suggestionId: row.id,
      from: row.from_pos as number,
      to: row.to_pos as number,
      inserted: row.inserted,
      actor: actorOf(access.user),
    });
    const open = await tx.one<{ count: string }>(
      `select count(*)::text as count from suggestions
        where project_id = $1 and status = 'open'`,
      [access.project.id],
    );
    return {
      status: 200,
      body: {
        suggestion: await suggestionShape(tx, row.id),
        file: fileShape(applied.file, true),
        projectRevision: applied.projectRevision,
        openSuggestions: Number((open as { count: string }).count),
      },
    };
  });
}

async function rejectSuggestion(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'resolve');
  const exists = await one<SuggestionRow>(
    `select * from suggestions where project_id = $1 and id = $2`,
    [access.project.id, ctx.params.sid],
  );
  if (exists === null) throw notFound();
  allowedKeys(ctx.body, []);

  return transaction(async (tx) => {
    await tx.lockProject(access.project.id);
    const row = (await tx.one<SuggestionRow>(
      `select * from suggestions where id = $1 for update`,
      [ctx.params.sid],
    )) as SuggestionRow;
    if (row.status !== 'open') {
      throw conflict('suggestion_closed', { suggestion: await suggestionShape(tx, row.id) });
    }
    await tx.query(
      `update suggestions set status = 'rejected', resolved_by = $2, resolved_at = now()
        where id = $1`,
      [row.id, access.user.id],
    );
    const project = (await tx.one<{ project_revision: number }>(
      `select project_revision from projects where id = $1`,
      [access.project.id],
    )) as { project_revision: number };
    const open = (await tx.one<{ count: string }>(
      `select count(*)::text as count from suggestions
        where project_id = $1 and status = 'open'`,
      [access.project.id],
    )) as { count: string };
    return {
      status: 200,
      body: {
        suggestion: await suggestionShape(tx, row.id),
        projectRevision: project.project_revision,
        openSuggestions: Number(open.count),
      },
    };
  });
}

async function createThread(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'review');
  const file = await one<FileRow>(
    `select * from files where project_id = $1 and id = $2 and deleted = false`,
    [access.project.id, ctx.params.fid],
  );
  if (file === null) throw notFound();

  allowedKeys(ctx.body, ['baseRevision', 'from', 'to', 'body']);
  const check = new FieldCheck(ctx.body);
  const baseRevision = check.integer('baseRevision', { min: 1 });
  const body = check.text('body', { min: 1, max: 4_000 });
  check.done();
  if (baseRevision !== file.revision) {
    throw new ApiError(412, 'stale_revision', { current: fileShape(file, true) });
  }
  const anchor = checkAnchor(ctx, file, { allowEmpty: false });
  const quote = (file.content ?? '').slice(anchor.from, anchor.to);

  const result = await transaction(async (tx) => {
    const threadId = newId('t');
    await tx.query(
      `insert into threads (id, project_id, file_id, from_pos, to_pos, quote, status)
       values ($1, $2, $3, $4, $5, $6, 'open')`,
      [threadId, access.project.id, file.id, anchor.from, anchor.to, quote],
    );
    const commentId = newId('c');
    await tx.query(
      `insert into comments (id, thread_id, author_id, body) values ($1, $2, $3, $4)`,
      [commentId, threadId, access.user.id, body as string],
    );
    const mentions = await recordMentionEmails(tx, {
      projectId: access.project.id,
      threadId,
      commentId,
      authorId: access.user.id,
      body: body as string,
    });
    return { thread: await threadShape(tx, threadId), mentions };
  });
  attemptNow(result.mentions);
  return { status: 201, body: { thread: result.thread } };
}

async function createComment(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'review');
  const thread = await one<ThreadRow>(
    `select * from threads where project_id = $1 and id = $2`,
    [access.project.id, ctx.params.tid],
  );
  if (thread === null) throw notFound();
  if (thread.status === 'resolved') throw conflict('thread_resolved');
  allowedKeys(ctx.body, ['body']);
  const check = new FieldCheck(ctx.body);
  const body = check.text('body', { min: 1, max: 4_000 });
  check.done();

  const result = await transaction(async (tx) => {
    const commentId = newId('c');
    await tx.query(
      `insert into comments (id, thread_id, author_id, body) values ($1, $2, $3, $4)`,
      [commentId, thread.id, access.user.id, body as string],
    );
    const mentions = await recordMentionEmails(tx, {
      projectId: access.project.id,
      threadId: thread.id,
      commentId,
      authorId: access.user.id,
      body: body as string,
    });
    const comment = (await tx.one<{ id: string; body: string; created_at: Date }>(
      `select id, body, created_at from comments where id = $1`,
      [commentId],
    )) as { id: string; body: string; created_at: Date };
    return {
      comment: {
        id: comment.id,
        author: personView.person({
          id: access.user.id,
          display_name: access.user.display_name,
          handle: access.user.handle,
          email: access.user.email,
        }),
        body: comment.body,
        createdAt: iso(comment.created_at),
      },
      mentions,
    };
  });
  attemptNow(result.mentions);
  return { status: 201, body: { comment: result.comment } };
}

async function resolveThread(ctx: Ctx): Promise<Reply> {
  const access = await requireProject(ctx, 'resolve');
  const thread = await one<ThreadRow>(
    `select * from threads where project_id = $1 and id = $2`,
    [access.project.id, ctx.params.tid],
  );
  if (thread === null) throw notFound();
  if (thread.status === 'resolved') throw conflict('thread_resolved');
  allowedKeys(ctx.body, []);

  return transaction(async (tx) => {
    const row = (await tx.one<ThreadRow>(`select * from threads where id = $1 for update`, [
      thread.id,
    ])) as ThreadRow;
    if (row.status === 'resolved') throw conflict('thread_resolved');
    await tx.query(
      `update threads set status = 'resolved', resolved_by = $2, resolved_at = now()
        where id = $1`,
      [row.id, access.user.id],
    );
    return { status: 200, body: { thread: await threadShape(tx, row.id) } };
  });
}

export const reviewRoutes: Route[] = [
  { method: 'GET', path: '/api/projects/:pid/review', keys: [], handler: readReview },
  {
    method: 'POST',
    path: '/api/projects/:pid/files/:fid/suggestions',
    keys: ['baseRevision', 'from', 'to', 'inserted'],
    handler: createSuggestion,
  },
  {
    method: 'POST',
    path: '/api/projects/:pid/suggestions/:sid/accept',
    keys: [],
    handler: acceptSuggestion,
  },
  {
    method: 'POST',
    path: '/api/projects/:pid/suggestions/:sid/reject',
    keys: [],
    handler: rejectSuggestion,
  },
  {
    method: 'POST',
    path: '/api/projects/:pid/files/:fid/threads',
    keys: ['baseRevision', 'from', 'to', 'body'],
    handler: createThread,
  },
  {
    method: 'POST',
    path: '/api/projects/:pid/threads/:tid/comments',
    keys: ['body'],
    handler: createComment,
  },
  {
    method: 'POST',
    path: '/api/projects/:pid/threads/:tid/resolve',
    keys: [],
    handler: resolveThread,
  },
];
