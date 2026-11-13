// Threads, notes, review submission, moving threads to an issue and applying suggestions.
import { intParam, json, noContent, type Router } from "../http.ts";
import { db, withTx, type Tx } from "../db.ts";
import { FieldErrors, conflict, notFound, validation, wrongState } from "../errors.ts";
import type { UserRow } from "../access.ts";
import { now } from "../clock.ts";
import { createIssue } from "../planning/index.ts";
import * as repo from "../repo/index.ts";
import { refreshRequest } from "./engine.ts";
import { emitRequest } from "./notify.ts";
import { bodyRecord, optionalBoolean, optionalString, positiveInteger } from "./input.ts";
import { VersionMapper } from "./mapper.ts";
import { applyMessage, applySuggestions, findOverlap, type PlannedSuggestion } from "./suggestions.ts";
import { ALREADY_MERGED, insertSystemNote, lockedRequest, openRequest, sayOnRequest, unresolvedLeft, unresolvedThreadCount, versionsOf, type MrRow, type Opened, type ThreadRow } from "./store.ts";
import { insertThread, insertThreadNote, noteView, threadViewOf, threadViews, type NewPosition, type SuggestionRow } from "./threads.ts";

const FILTERS = ["all", "comments", "history"] as const;
type Filter = (typeof FILTERS)[number];

function isFilter(value: string): value is Filter {
  return FILTERS.some((filter) => filter === value);
}

const COMMENT_BLANK = "Comment can't be blank.";
const POSITION_INVALID = "Position isn't valid.";

function readPosition(value: unknown, versions: ReadonlySet<number>): NewPosition | "invalid" {
  const record = bodyRecord(value);
  const path = record["path"];
  const oldLine = record["old_line"] ?? null;
  const newLine = record["new_line"] ?? null;
  const endLine = record["end_line"] ?? null;
  const version = positiveInteger(record["version"]);
  if (typeof path !== "string" || path === "" || version === null || !versions.has(version)) return "invalid";
  const old = oldLine === null ? null : positiveInteger(oldLine);
  const fresh = newLine === null ? null : positiveInteger(newLine);
  if ((old === null) === (fresh === null)) return "invalid";
  const start = old ?? fresh ?? 0;
  const end = endLine === null ? null : positiveInteger(endLine);
  if (endLine !== null && (end === null || end <= start)) return "invalid";
  return { path, old_line: old, new_line: fresh, end_line: end, version };
}

async function threadOf(tx: Pick<Tx, "maybe">, mr: MrRow, threadId: number, user: UserRow): Promise<ThreadRow> {
  const thread = await tx.maybe<ThreadRow>("SELECT * FROM mr_threads WHERE id = $1 AND mr_id = $2", [threadId, mr.id]);
  if (thread === undefined || (thread.pending && thread.author_id !== user.id)) throw notFound();
  return thread;
}

function threadMessage(tx: Tx, projectId: number, mr: MrRow, thread: Pick<ThreadRow, "id" | "pending" | "author_id">, texts: readonly string[] = []): Promise<number> {
  return tx.emit(projectId, "thread", { iid: mr.iid, thread_id: thread.id }, {
    ...(texts.length === 0 ? {} : { say: texts.map((text) => sayOnRequest(mr.iid, text)) }),
    ...(thread.pending ? { restrictUser: thread.author_id } : {}),
  });
}

function quoted(text: string): string {
  return text.split("\n").map((line) => `> ${line}`).join("\n");
}

function whereOf(thread: ThreadRow): string {
  if (thread.path === null) return "Merge request";
  const first = thread.new_line ?? thread.old_line ?? 0;
  return thread.end_line === null ? `${thread.path} line ${first}` : `${thread.path} lines ${first}-${thread.end_line}`;
}

interface SuggestionContext extends SuggestionRow {
  readonly path: string;
  readonly thread_resolved: boolean;
  readonly thread_outdated: boolean;
  readonly thread_pending: boolean;
  readonly thread_author: number;
}

async function applySuggestionBatch(tx: Tx, user: UserRow, opened: Opened, rawIds: unknown): Promise<string> {
  const { project, access, mr } = opened;
  const requested = Array.isArray(rawIds) ? rawIds.map(positiveInteger) : [];
  const errors = new FieldErrors();
  if (requested.length === 0 || requested.some((id) => id === null)) errors.add("ids", "Choose at least one suggestion.");
  if (mr.state === "merged") throw wrongState(ALREADY_MERGED);
  errors.throwIfAny();
  const ids = [...new Set(requested.filter((id): id is number => id !== null))];
  const rows = await tx.q<SuggestionContext>(
    `SELECT s.*, t.path, t.resolved AS thread_resolved, t.outdated AS thread_outdated, t.pending AS thread_pending, t.author_id AS thread_author
       FROM mr_suggestions s JOIN mr_threads t ON t.id = s.thread_id WHERE s.mr_id = $1 AND s.id = ANY($2) ORDER BY s.id`,
    [mr.id, ids],
  );
  if (rows.length !== ids.length || rows.some((row) => row.thread_pending && row.thread_author !== user.id)) throw notFound();

  if (rows.some((row) => !row.applied && (row.outdated || row.thread_outdated))) {
    throw conflict("suggestion_outdated", "This suggestion is outdated: the lines changed.");
  }
  const planned: PlannedSuggestion[] = rows.map((row) => ({ path: row.path, start: row.start_line, end: row.end_line, lines: row.lines }));
  const overlap = findOverlap(planned);
  if (overlap !== null) throw conflict("suggestion_overlap", `These suggestions overlap: ${overlap.path} lines ${overlap.start}-${overlap.end}.`);
  if (rows.some((row) => row.applied)) throw conflict("suggestion_applied", "This suggestion was already applied.");
  if (rows.some((row) => row.thread_resolved)) throw conflict("thread_resolved", "This thread is resolved.");

  const head = await repo.branchHead(tx, project.id, mr.source);
  if (head === null) throw wrongState("The source branch no longer exists.");
  const byPath = new Map<string, PlannedSuggestion[]>();
  for (const item of planned) byPath.set(item.path, [...(byPath.get(item.path) ?? []), item]);
  const actions: { action: "update"; path: string; content: string }[] = [];
  for (const [path, group] of byPath) {
    const text = await repo.readFile(tx, project.id, head, path);
    const content = text === null ? null : applySuggestions(text, group);
    if (content === null) throw conflict("suggestion_outdated", "This suggestion is outdated: the lines changed.");
    actions.push({ action: "update", path, content });
  }

  await tx.q("UPDATE mr_suggestions SET applied = true WHERE id = ANY($1)", [ids]);
  const threadIds = [...new Set(rows.map((row) => row.thread_id))];
  for (const [index, threadId] of threadIds.entries()) {
    const thread = await tx.one<ThreadRow>("UPDATE mr_threads SET resolved = true WHERE id = $1 RETURNING *", [threadId]);
    const last = index === threadIds.length - 1;
    await threadMessage(tx, project.id, mr, thread, last ? [unresolvedLeft(await unresolvedThreadCount(tx, mr.id))] : []);
  }
  const committed = await repo.commitToBranch(tx, {
    project,
    access,
    actor: { id: user.id, username: user.username },
    branch: mr.source,
    baseCommit: head,
    message: applyMessage(rows.length, byPath.size, actions[0]?.path ?? ""),
    actions,
    source: "suggestion",
  });
  return committed.commit;
}

export function registerReviewRoutes(router: Router): void {
  router.get("/api/projects/:id/merge_requests/:iid/threads", async (ctx) => {
    const { mr } = await openRequest(db, ctx.user, intParam(ctx, "id"), intParam(ctx, "iid"), "mr.read");
    return json(200, { threads: await threadViews(db, mr.id, ctx.user.id) });
  });

  router.get("/api/projects/:id/merge_requests/:iid/notes", async (ctx) => {
    const { mr } = await openRequest(db, ctx.user, intParam(ctx, "id"), intParam(ctx, "iid"), "mr.read");
    const asked = ctx.query.get("filter") ?? "all";
    const errors = new FieldErrors();
    if (!isFilter(asked)) errors.add("filter", "Filter must be all, comments or history.");
    errors.throwIfAny();
    const rows = await db.q<{ id: number; thread_id: number | null; author: string; body: string; system: boolean; pending: boolean; created_at: number }>(
      `SELECT id, thread_id, author, body, system, pending, created_at FROM mr_notes
        WHERE mr_id = $1 AND (NOT pending OR user_id = $2) AND ($3 = 'all' OR ($3 = 'comments' AND NOT system) OR ($3 = 'history' AND system))
        ORDER BY id`,
      [mr.id, ctx.user.id, asked],
    );
    return json(200, { notes: rows.map(noteView) });
  });

  router.post("/api/projects/:id/merge_requests/:iid/threads", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "mr.comment");
      const body = bodyRecord(ctx.body);
      const errors = new FieldErrors();
      const text = optionalString(body, "body") ?? "";
      if (text.trim() === "") errors.add("body", COMMENT_BLANK);
      const versions = new Set((await versionsOf(tx, mr.id)).map((version) => version.number));
      let position: NewPosition | null = null;
      if (body["position"] !== null && body["position"] !== undefined) {
        const read = readPosition(body["position"], versions);
        if (read === "invalid") errors.add("position", POSITION_INVALID);
        else position = read;
      }
      errors.throwIfAny();
      const pending = optionalBoolean(body, "pending") ?? false;
      const thread = await insertThread(tx, mr, { userId: ctx.user.id, username: ctx.user.username, body: text, pending }, position);
      await threadMessage(tx, project.id, mr, thread);
      if (!pending) await refreshRequest(tx, project, mr.id, { autoMerge: false, rulesMessage: true });
      return json(201, { id: thread.id, seq: await tx.currentSeq(project.id) });
    });
  });

  router.post("/api/projects/:id/merge_requests/:iid/threads/move_to_issue", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "mr.write");
      const open = await tx.q<ThreadRow>("SELECT * FROM mr_threads WHERE mr_id = $1 AND NOT pending AND NOT resolved ORDER BY id", [mr.id]);
      if (open.length === 0) throw wrongState("There are no open threads to move.");
      const sections: string[] = [];
      for (const thread of open) {
        const notes = await tx.q<{ author: string; body: string }>("SELECT author, body FROM mr_notes WHERE thread_id = $1 AND NOT pending ORDER BY id", [thread.id]);
        sections.push([`### ${whereOf(thread)}`, ...notes.map((note) => quoted(`@${note.author}: ${note.body}`))].join("\n\n"));
      }
      const issueIid = await createIssue(tx, project, { id: ctx.user.id, username: ctx.user.username }, {
        title: `Open threads from !${mr.iid}`,
        description: sections.join("\n\n"),
      });
      for (const thread of open) {
        const resolved = await tx.one<ThreadRow>("UPDATE mr_threads SET resolved = true WHERE id = $1 RETURNING *", [thread.id]);
        await threadMessage(tx, project.id, mr, resolved);
      }
      const text = `Moved ${open.length} ${open.length === 1 ? "thread" : "threads"} to #${issueIid}.`;
      await insertSystemNote(tx, mr.id, ctx.user.username, text);
      await emitRequest(tx, project, mr.iid, "updated", [text]);
      await refreshRequest(tx, project, mr.id, { autoMerge: true, rulesMessage: true });
      return json(201, { issue_iid: issueIid, moved: open.length, seq: await tx.currentSeq(project.id) });
    });
  });

  router.post("/api/projects/:id/merge_requests/:iid/threads/:tid/notes", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    const threadId = intParam(ctx, "tid");
    return withTx(async (tx) => {
      const { project, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "mr.comment");
      const thread = await threadOf(tx, mr, threadId, ctx.user);
      const body = bodyRecord(ctx.body);
      const errors = new FieldErrors();
      const text = optionalString(body, "body") ?? "";
      if (text.trim() === "") errors.add("body", COMMENT_BLANK);
      errors.throwIfAny();
      const pending = thread.pending || (optionalBoolean(body, "pending") ?? false);
      const mapper = new VersionMapper(tx, mr.project_id, await versionsOf(tx, mr.id));
      const noteId = await insertThreadNote(tx, mr, thread, { userId: ctx.user.id, username: ctx.user.username, body: text, pending }, mapper);
      await threadMessage(tx, project.id, mr, { id: thread.id, pending, author_id: ctx.user.id });
      return json(201, { id: noteId, seq: await tx.currentSeq(project.id) });
    });
  });

  router.patch("/api/projects/:id/merge_requests/:iid/threads/:tid", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    const threadId = intParam(ctx, "tid");
    return withTx(async (tx) => {
      const { project, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "mr.comment");
      const thread = await threadOf(tx, mr, threadId, ctx.user);
      const resolved = optionalBoolean(bodyRecord(ctx.body), "resolved");
      if (resolved === undefined) throw validation({ resolved: "Resolved must be true or false." });
      if (thread.resolved !== resolved) {
        const changed = await tx.one<ThreadRow>("UPDATE mr_threads SET resolved = $2 WHERE id = $1 RETURNING *", [thread.id, resolved]);
        const text = resolved ? unresolvedLeft(await unresolvedThreadCount(tx, mr.id)) : "Thread reopened.";
        await threadMessage(tx, project.id, mr, changed, [text]);
        await refreshRequest(tx, project, mr.id, { autoMerge: true, rulesMessage: true });
      }
      const view = await threadViewOf(tx, mr.id, ctx.user.id, thread.id);
      return json(200, { ...view, seq: await tx.currentSeq(project.id) });
    });
  });

  router.post("/api/projects/:id/merge_requests/:iid/review", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "mr.comment");
      const count = (await tx.one<{ n: number }>("SELECT count(*) AS n FROM mr_notes WHERE mr_id = $1 AND user_id = $2 AND pending", [mr.id, ctx.user.id])).n;
      if (count > 0) {
        await tx.q("UPDATE mr_threads SET pending = false WHERE mr_id = $1 AND author_id = $2 AND pending", [mr.id, ctx.user.id]);
        await tx.q("UPDATE mr_notes SET pending = false WHERE mr_id = $1 AND user_id = $2 AND pending", [mr.id, ctx.user.id]);
        await tx.q("INSERT INTO mr_reviews (mr_id, user_id, summary, published, created_at) VALUES ($1, $2, $3, $4, $5)", [
          mr.id, ctx.user.id, optionalString(bodyRecord(ctx.body), "summary") ?? "", count, now(),
        ]);
        await tx.emit(project.id, "review", { iid: mr.iid, published: count }, {
          say: [sayOnRequest(mr.iid, `Review submitted: ${count} ${count === 1 ? "comment" : "comments"}`)],
        });
        await refreshRequest(tx, project, mr.id, { autoMerge: false, rulesMessage: true });
      }
      return json(200, { published: count, seq: await tx.currentSeq(project.id) });
    });
  });

  router.delete("/api/projects/:id/merge_requests/:iid/review", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "mr.comment");
      const threads = await tx.q("DELETE FROM mr_threads WHERE mr_id = $1 AND author_id = $2 AND pending RETURNING id", [mr.id, ctx.user.id]);
      const notes = await tx.q("DELETE FROM mr_notes WHERE mr_id = $1 AND user_id = $2 AND pending RETURNING id", [mr.id, ctx.user.id]);
      if (threads.length + notes.length > 0) await tx.emit(project.id, "review", { iid: mr.iid, published: 0 }, { restrictUser: ctx.user.id });
      return noContent();
    });
  });

  router.post("/api/projects/:id/merge_requests/:iid/suggestions/apply", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const opened = await lockedRequest(tx, ctx.user, projectId, iid, "suggestion.apply");
      const commit = await applySuggestionBatch(tx, ctx.user, opened, bodyRecord(ctx.body)["ids"]);
      return json(201, { commit, seq: await tx.currentSeq(opened.project.id) });
    });
  });
}
