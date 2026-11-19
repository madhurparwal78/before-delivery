// Suggestions, threads and comments; the suggestion state machine; anchors following every change.
import type pg from "pg";
import { moveSuggestionAnchor, moveThreadAnchor, spanFor, type ReplacedSpan } from "../shared/anchors.ts";
import type { Comment, Person, Review, Suggestion, Thread } from "../shared/api.ts";
import { membership, personShape, requireRole } from "./access.ts";
import { signedIn } from "./auth.ts";
import { one, pool, query, transaction, type Db } from "./db.ts";
import { fail, ok, type Context, type Reply } from "./http.ts";
import { deliverMentions, queueMentions } from "./mail.ts";
import { commitRevision, currentFile, fileShape, lockProject, newId, textFileShape, textOf } from "./projects.ts";
import { Fields, onlyKeys } from "./validate.ts";

interface SuggestionRow {
  id: string;
  file_id: string;
  from_pos: number | null;
  to_pos: number | null;
  deleted: string;
  inserted: string;
  status: Suggestion["status"];
  author_id: string;
  author_name: string;
  author_handle: string;
  created_at: Date;
  resolved_by: string | null;
  resolver_name: string | null;
  resolver_handle: string | null;
  resolved_at: Date | null;
}

interface ThreadRow {
  id: string;
  file_id: string;
  from_pos: number | null;
  to_pos: number | null;
  quote: string;
  status: Thread["status"];
  orphaned: boolean;
  resolved_by: string | null;
  resolver_name: string | null;
  resolver_handle: string | null;
}

interface CommentRow {
  id: string;
  thread_id: string;
  author_id: string;
  author_name: string;
  author_handle: string;
  body: string;
  created_at: Date;
}

const resolver = (row: { resolved_by: string | null; resolver_name: string | null; resolver_handle: string | null }): Person | null =>
  row.resolved_by ? personShape({ id: row.resolved_by, display_name: row.resolver_name ?? "", handle: row.resolver_handle ?? "" }) : null;

function suggestionShape(row: SuggestionRow): Suggestion {
  return {
    id: row.id,
    fileId: row.file_id,
    from: row.from_pos,
    to: row.to_pos,
    deleted: row.deleted,
    inserted: row.inserted,
    status: row.status,
    author: personShape({ id: row.author_id, display_name: row.author_name, handle: row.author_handle }),
    createdAt: row.created_at.toISOString(),
    resolvedBy: resolver(row),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  };
}

function commentShape(row: CommentRow): Comment {
  return {
    id: row.id,
    author: personShape({ id: row.author_id, display_name: row.author_name, handle: row.author_handle }),
    body: row.body,
    createdAt: row.created_at.toISOString(),
  };
}

function threadShape(row: ThreadRow, comments: CommentRow[]): Thread {
  return {
    id: row.id,
    fileId: row.file_id,
    from: row.from_pos,
    to: row.to_pos,
    quote: row.quote,
    status: row.status,
    orphaned: row.orphaned,
    comments: comments.map(commentShape),
    resolvedBy: resolver(row),
  };
}

const SUGGESTION_SELECT = `
  SELECT s.*, a.display_name AS author_name, a.handle AS author_handle,
         r.display_name AS resolver_name, r.handle AS resolver_handle
    FROM suggestions s JOIN users a ON a.id = s.author_id LEFT JOIN users r ON r.id = s.resolved_by`;
const THREAD_SELECT = `
  SELECT t.*, r.display_name AS resolver_name, r.handle AS resolver_handle
    FROM threads t LEFT JOIN users r ON r.id = t.resolved_by`;
const COMMENT_SELECT = `
  SELECT c.*, a.display_name AS author_name, a.handle AS author_handle
    FROM comments c JOIN users a ON a.id = c.author_id`;

async function suggestionById(db: Db, projectId: string, id: string): Promise<SuggestionRow> {
  const row = await one<SuggestionRow>(db, `${SUGGESTION_SELECT} WHERE s.project_id = $1 AND s.id = $2`, [projectId, id]);
  if (!row) throw fail.notFound();
  return row;
}

async function threadById(db: Db, projectId: string, id: string): Promise<Thread> {
  const row = await one<ThreadRow>(db, `${THREAD_SELECT} WHERE t.project_id = $1 AND t.id = $2`, [projectId, id]);
  if (!row) throw fail.notFound();
  const comments = await query<CommentRow>(db, `${COMMENT_SELECT} WHERE c.thread_id = $1 ORDER BY c.seq`, [id]);
  return threadShape(row, comments);
}

async function openSuggestions(db: Db, projectId: string): Promise<number> {
  const row = await one<{ count: number }>(db, "SELECT count(*)::int AS count FROM suggestions WHERE project_id = $1 AND status = 'open'", [
    projectId,
  ]);
  return row?.count ?? 0;
}

/**
 * Review order: items that are not orphaned by file path, then `from`, then creation time, then id; orphaned items
 * after them by the moment they became orphaned, then id. A file's path is its latest one, so deleted files sort too.
 */
export async function reviewOf(db: Db, projectId: string): Promise<Review> {
  const path = (alias: string) =>
    `(SELECT p.path FROM tree p WHERE p.file_id = ${alias}.file_id ORDER BY p.project_revision DESC LIMIT 1) COLLATE "C"`;
  const suggestions = await query<SuggestionRow>(
    db,
    `${SUGGESTION_SELECT} WHERE s.project_id = $1
     ORDER BY s.status = 'orphaned', CASE WHEN s.status <> 'orphaned' THEN ${path("s")} END, s.from_pos, s.orphaned_at, CASE WHEN s.status <> 'orphaned' THEN s.created_at END, s.id COLLATE "C"`,
    [projectId],
  );
  const threads = await query<ThreadRow>(
    db,
    `${THREAD_SELECT} WHERE t.project_id = $1
     ORDER BY t.orphaned, CASE WHEN NOT t.orphaned THEN ${path("t")} END, t.from_pos, t.orphaned_at, CASE WHEN NOT t.orphaned THEN t.created_at END, t.id COLLATE "C"`,
    [projectId],
  );
  const comments = await query<CommentRow>(
    db,
    `${COMMENT_SELECT} JOIN threads t ON t.id = c.thread_id WHERE t.project_id = $1 ORDER BY c.seq`,
    [projectId],
  );
  return {
    suggestions: suggestions.map(suggestionShape),
    threads: threads.map((thread) => threadShape(thread, comments.filter((comment) => comment.thread_id === thread.id))),
    openSuggestions: suggestions.filter((row) => row.status === "open").length,
  };
}

/** Move every open suggestion and live thread of a file through one replaced span. */
export async function moveAnchors(client: pg.PoolClient, fileId: string, span: ReplacedSpan, except?: string): Promise<void> {
  if (span.a === span.b && span.n === 0) return;
  const suggestions = await client.query<{ id: string; from_pos: number; to_pos: number }>(
    "SELECT id, from_pos, to_pos FROM suggestions WHERE file_id = $1 AND status = 'open' AND id <> $2",
    [fileId, except ?? ""],
  );
  for (const row of suggestions.rows) {
    const moved = moveSuggestionAnchor({ from: row.from_pos, to: row.to_pos }, span);
    if (moved) await client.query("UPDATE suggestions SET from_pos = $2, to_pos = $3 WHERE id = $1", [row.id, moved.from, moved.to]);
    else await client.query("UPDATE suggestions SET status = 'orphaned', from_pos = NULL, to_pos = NULL, orphaned_at = clock_timestamp() WHERE id = $1", [row.id]);
  }
  const threads = await client.query<{ id: string; from_pos: number; to_pos: number }>(
    "SELECT id, from_pos, to_pos FROM threads WHERE file_id = $1 AND NOT orphaned",
    [fileId],
  );
  for (const row of threads.rows) {
    const moved = moveThreadAnchor({ from: row.from_pos, to: row.to_pos }, span);
    if (moved) await client.query("UPDATE threads SET from_pos = $2, to_pos = $3 WHERE id = $1", [row.id, moved.from, moved.to]);
    else await client.query("UPDATE threads SET orphaned = true, from_pos = NULL, to_pos = NULL, orphaned_at = clock_timestamp() WHERE id = $1", [row.id]);
  }
}

/** Files leaving the current tree orphan their open suggestions and live threads; nothing ever reattaches. */
export async function orphanAnchors(client: pg.PoolClient, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  await client.query(
    "UPDATE suggestions SET status = 'orphaned', from_pos = NULL, to_pos = NULL, orphaned_at = clock_timestamp() WHERE file_id = ANY($1) AND status = 'open'",
    [fileIds],
  );
  await client.query("UPDATE threads SET orphaned = true, from_pos = NULL, to_pos = NULL, orphaned_at = clock_timestamp() WHERE file_id = ANY($1) AND NOT orphaned", [
    fileIds,
  ]);
}

export async function readReview(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const { project } = await membership(pool, user.id, ctx.params.pid ?? "");
  return ok(await reviewOf(pool, project.id));
}

/** The anchored passage of a new suggestion or thread, judged against the file's current revision. */
async function anchorTarget(ctx: Context, client: pg.PoolClient, projectId: string, keys: string[]) {
  const project = await lockProject(client, projectId);
  const file = await currentFile(client, project.id, project.revision, ctx.params.fid ?? "");
  const base = ctx.body.baseRevision;
  if (file.kind === "text" && Number.isInteger(base) && base !== file.text_revision) {
    throw fail.stale(await textFileShape(client, file));
  }
  const content = file.kind === "text" ? await textOf(client, file.id, file.text_revision ?? 1) : "";
  const fields = new Fields(ctx.body, keys);
  fields.integer("baseRevision", "Name the revision this passage was read from.", (value) => value >= 1);
  const from = fields.integer("from", "Choose a passage inside the file.", (value) => value >= 0 && value <= content.length);
  const to = fields.integer("to", "Choose a passage inside the file.", (value) => value >= from && value <= content.length);
  if (file.kind === "asset") fields.reject("from", "Figures have no passages.");
  return { file, content, fields, from, to };
}

export async function createSuggestion(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  await currentFile(pool, access.project.id, access.project.revision, ctx.params.fid ?? "");
  requireRole(access, "review");
  return transaction(async (client) => {
    const { file, content, fields, from, to } = await anchorTarget(ctx, client, access.project.id, ["baseRevision", "from", "to", "inserted"]);
    const inserted = fields.string("inserted", "Write a replacement of at most 10,000 characters.", (value) => value.length <= 10000);
    if (from === to && inserted === "") fields.reject("inserted", "A suggestion must change something.");
    fields.check();
    const id = newId();
    await client.query(
      `INSERT INTO suggestions (id, project_id, file_id, from_pos, to_pos, deleted, inserted, status, author_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9)`,
      [id, access.project.id, file.id, from, to, content.slice(from, to), inserted, user.id, new Date()],
    );
    return ok({ suggestion: suggestionShape(await suggestionById(client, access.project.id, id)) }, 201);
  });
}

const COMMENT_MESSAGE = "Write a comment of 1 to 4,000 characters.";
const commentFits = (value: string): boolean => value.length >= 1 && value.length <= 4000;

export async function createThread(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  await currentFile(pool, access.project.id, access.project.revision, ctx.params.fid ?? "");
  requireRole(access, "review");
  const reply = await transaction(async (client) => {
    const { file, content, fields, from, to } = await anchorTarget(ctx, client, access.project.id, ["baseRevision", "from", "to", "body"]);
    if (from >= to) fields.reject("to", "Select a passage that is not empty.");
    const body = fields.string("body", COMMENT_MESSAGE, commentFits);
    fields.check();
    const id = newId();
    const quote = content.slice(from, to);
    const now = new Date();
    await client.query(
      `INSERT INTO threads (id, project_id, file_id, from_pos, to_pos, quote, status, orphaned, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', false, $7)`,
      [id, access.project.id, file.id, from, to, quote, now],
    );
    await client.query("INSERT INTO comments (id, thread_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5)", [
      newId(),
      id,
      user.id,
      body,
      now,
    ]);
    await queueMentions(client, { projectId: access.project.id, projectTitle: access.project.title, threadId: id, quote, body, author: user });
    return ok({ thread: await threadById(client, access.project.id, id) }, 201);
  });
  void deliverMentions();
  return reply;
}

export async function createComment(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  await threadById(pool, access.project.id, ctx.params.tid ?? "");
  requireRole(access, "review");
  const reply = await transaction(async (client) => {
    const thread = await client.query<{ status: string; quote: string }>("SELECT status, quote FROM threads WHERE id = $1 FOR UPDATE", [
      ctx.params.tid,
    ]);
    const row = thread.rows[0];
    if (!row) throw fail.notFound();
    if (row.status === "resolved") throw fail.conflict("thread_resolved");
    const fields = new Fields(ctx.body, ["body"]);
    const body = fields.string("body", COMMENT_MESSAGE, commentFits);
    fields.check();
    const id = newId();
    await client.query("INSERT INTO comments (id, thread_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5)", [
      id,
      ctx.params.tid,
      user.id,
      body,
      new Date(),
    ]);
    await queueMentions(client, {
      projectId: access.project.id,
      projectTitle: access.project.title,
      threadId: ctx.params.tid ?? "",
      quote: row.quote,
      body,
      author: user,
    });
    const comment = await one<CommentRow>(client, `${COMMENT_SELECT} WHERE c.id = $1`, [id]);
    return ok({ comment: commentShape(comment as CommentRow) }, 201);
  });
  void deliverMentions();
  return reply;
}

export async function resolveThread(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  await threadById(pool, access.project.id, ctx.params.tid ?? "");
  requireRole(access, "decide");
  return transaction(async (client) => {
    const thread = await client.query<{ status: string }>("SELECT status FROM threads WHERE id = $1 FOR UPDATE", [ctx.params.tid]);
    if (thread.rows[0]?.status === "resolved") throw fail.conflict("thread_resolved");
    onlyKeys(ctx.body, []);
    await client.query("UPDATE threads SET status = 'resolved', resolved_by = $2, resolved_at = $3 WHERE id = $1", [
      ctx.params.tid,
      user.id,
      new Date(),
    ]);
    return ok({ thread: await threadById(client, access.project.id, ctx.params.tid ?? "") });
  });
}

/** The suggestion state machine: open → accepted or rejected exactly once; everything else is closed. */
async function decide(ctx: Context, outcome: "accepted" | "rejected"): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  await suggestionById(pool, access.project.id, ctx.params.sid ?? "");
  requireRole(access, "decide");
  return transaction(async (client) => {
    const project = await lockProject(client, access.project.id);
    const suggestion = await suggestionById(client, project.id, ctx.params.sid ?? "");
    if (suggestion.status !== "open") throw fail.conflict("suggestion_closed", { suggestion: suggestionShape(suggestion) });
    onlyKeys(ctx.body, []);
    const now = new Date();
    await client.query("UPDATE suggestions SET status = $2, resolved_by = $3, resolved_at = $4 WHERE id = $1", [
      suggestion.id,
      outcome,
      user.id,
      now,
    ]);
    if (outcome === "rejected") {
      return ok({
        suggestion: suggestionShape(await suggestionById(client, project.id, suggestion.id)),
        projectRevision: project.revision,
        openSuggestions: await openSuggestions(client, project.id),
      });
    }
    const file = await currentFile(client, project.id, project.revision, suggestion.file_id);
    const before = await textOf(client, file.id, file.text_revision ?? 1);
    const range = { from: suggestion.from_pos ?? 0, to: suggestion.to_pos ?? 0 };
    const content = before.slice(0, range.from) + suggestion.inserted + before.slice(range.to);
    const revision = await commitRevision(client, project, { kind: "accept", summary: `Accepted a suggestion in ${file.path}` }, user, [
      { kind: "text", fileId: file.id, content },
    ]);
    await moveAnchors(client, file.id, spanFor(range, suggestion.inserted), suggestion.id);
    const saved = await currentFile(client, project.id, revision, file.id);
    return ok({
      suggestion: suggestionShape(await suggestionById(client, project.id, suggestion.id)),
      file: fileShape(saved, content),
      projectRevision: revision,
      openSuggestions: await openSuggestions(client, project.id),
    });
  });
}

export const acceptSuggestion = (ctx: Context): Promise<Reply> => decide(ctx, "accepted");
export const rejectSuggestion = (ctx: Context): Promise<Reply> => decide(ctx, "rejected");
