// Epics: group-level containers of issues, one level of nesting, with dates taken from the issues' milestones.
import type { Queryable, Tx } from "../db.ts";
import { db, withTx } from "../db.ts";
import {
  can, findProject, groupScope, projectAccess, requireAction,
  type Access, type GroupRow, type ProjectRow,
} from "../access.ts";
import { iso, now } from "../clock.ts";
import { ApiError, FieldErrors, fieldError, notFound, validationOne } from "../errors.ts";
import { intParam, json, type Ctx, type Router } from "../http.ts";
import { labelsOfProject } from "./labels.ts";
import { copyState } from "./issue-state.ts";
import { findIssueById, loadState, saveIssue, type Actor, type IssueRow } from "./issues-core.ts";
import { mayRead, readableWithoutAssignment, viewerOf } from "./visibility.ts";
import { bodyOf, has, noteView, titleProblem, type NoteRow } from "./util.ts";

interface EpicRow {
  readonly id: number;
  readonly group_id: number;
  readonly iid: number;
  readonly title: string;
  readonly description: string;
  readonly author_id: number;
  readonly state: "opened" | "closed";
  readonly confidential: boolean;
  readonly parent_id: number | null;
  readonly labels: string[];
  readonly created_at: number;
}

const DEPTH_MESSAGE = "Epics can only nest one level.";

const depthError = (): ApiError => fieldError("epic_depth", "parent", DEPTH_MESSAGE);

async function nextEpicIid(tx: Tx, groupId: number): Promise<number> {
  const row = await tx.one<{ iid: number }>("UPDATE groups SET next_epic_iid = next_epic_iid + 1 WHERE id = $1 RETURNING next_epic_iid - 1 AS iid", [groupId]);
  return row.iid;
}

async function findEpic(q: Queryable, groupId: number, iid: number, lock = false): Promise<EpicRow | undefined> {
  return q.maybe<EpicRow>(`SELECT * FROM epics WHERE group_id = $1 AND iid = $2${lock ? " FOR UPDATE" : ""}`, [groupId, iid]);
}

function epicReadable(access: Access, userId: number, epic: { confidential: boolean; author_id: number }): boolean {
  return readableWithoutAssignment(viewerOf(userId, access), epic);
}

export async function insertEpic(
  tx: Tx,
  input: { groupId: number; title: string; description: string; authorId: number; confidential: boolean; parentId: number | null; labels: readonly string[]; at?: number },
): Promise<EpicRow> {
  const iid = await nextEpicIid(tx, input.groupId);
  return tx.one<EpicRow>(
    `INSERT INTO epics (group_id, iid, title, description, author_id, confidential, parent_id, labels, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [input.groupId, iid, input.title, input.description, input.authorId, input.confidential, input.parentId, input.labels, input.at ?? now()],
  );
}

/** Creates the epic of a promoted issue: title, description, author, confidentiality and group labels are copied, then the
 *  issue's comments and the published system notes. The caller's state is closed and linked to the epic. */
export async function promoteIssue(tx: Tx, project: ProjectRow, row: IssueRow, state: ReturnType<typeof copyState>, actor: Actor): Promise<EpicRow> {
  const known = await labelsOfProject(tx, project);
  const groupLabels = new Set(known.filter((label) => label.source === "group").map((label) => label.name));
  const kept = state.labels.filter((name) => groupLabels.has(name));
  const dropped = state.labels.filter((name) => !groupLabels.has(name));
  const epic = await insertEpic(tx, {
    groupId: project.group_id, title: state.title, description: state.description, authorId: row.author_id,
    confidential: state.confidential, parentId: null, labels: kept,
  });
  const comments = await tx.q<{ author: string; body: string; created_at: number }>(
    "SELECT author, body, created_at FROM issue_notes WHERE issue_id = $1 AND NOT system ORDER BY id",
    [row.id],
  );
  const write = async (author: string, body: string, system: boolean, at: number): Promise<void> => {
    await tx.q("INSERT INTO epic_notes (epic_id, author, body, system, created_at) VALUES ($1, $2, $3, $4, $5)", [epic.id, author, body, system, at]);
  };
  for (const comment of comments) await write(comment.author, comment.body, false, comment.created_at);
  await write(actor.username, `Copied from #${row.iid}.`, true, now());
  if (dropped.length > 0) await write(actor.username, `Dropped labels: ${dropped.map((name) => `~${name}`).join(", ")}.`, true, now());
  state.state = "closed";
  state.epicId = epic.id;
  return epic;
}

interface MemberIssue {
  readonly id: number;
  readonly iid: number;
  readonly title: string;
  readonly confidential: boolean;
  readonly author_id: number;
  readonly project_id: number;
  readonly project: string;
  readonly milestone: string | null;
  readonly start_date: string | null;
  readonly due_date: string | null;
}

async function epicView(q: Queryable, access: Access, userId: number, epic: EpicRow): Promise<Record<string, unknown>> {
  const author = await q.one<{ username: string }>("SELECT username FROM users WHERE id = $1", [epic.author_id]);
  const parent = epic.parent_id === null ? null : await q.maybe<{ iid: number }>("SELECT iid FROM epics WHERE id = $1", [epic.parent_id]);
  const children = (await q.q<EpicRow>("SELECT * FROM epics WHERE parent_id = $1 ORDER BY iid", [epic.id]))
    .filter((child) => epicReadable(access, userId, child))
    .map((child) => ({ iid: child.iid, title: child.title }));
  const members = await q.q<MemberIssue>(
    `SELECT i.id, i.iid, i.title, i.confidential, i.author_id, i.project_id, p.path AS project, m.title AS milestone, m.start_date, m.due_date
       FROM issues i JOIN projects p ON p.id = i.project_id LEFT JOIN milestones m ON m.id = i.milestone_id
      WHERE i.epic_id = $1 ORDER BY p.path, i.iid`,
    [epic.id],
  );
  const starts = members.flatMap((issue) => issue.start_date ?? []).sort();
  const dues = members.flatMap((issue) => issue.due_date ?? []).sort();
  const rights = new Map<number, Access | undefined>();
  const issues: Record<string, unknown>[] = [];
  for (const issue of members) {
    if (!rights.has(issue.project_id)) {
      const project = await findProject(q, issue.project_id);
      rights.set(issue.project_id, project === undefined ? undefined : await projectAccess(q, userId, project));
    }
    const issueRights = rights.get(issue.project_id);
    if (issueRights === undefined || !can(issueRights, "issue.read")) continue;
    if (!(await mayRead(q, viewerOf(userId, issueRights), issue))) continue;
    issues.push({ project: issue.project, iid: issue.iid, title: issue.title, milestone: issue.milestone });
  }
  const notes = await q.q<NoteRow>("SELECT id, author, body, system, created_at FROM epic_notes WHERE epic_id = $1 ORDER BY id", [epic.id]);
  return {
    iid: epic.iid,
    title: epic.title,
    description: epic.description,
    author: author.username,
    state: epic.state,
    confidential: epic.confidential,
    parent: parent?.iid ?? null,
    children,
    issues,
    labels: epic.labels,
    start_date: starts[0] ?? null,
    due_date: dues[dues.length - 1] ?? null,
    notes: notes.map(noteView),
  };
}

async function scopedEpic(q: Queryable, ctx: Ctx): Promise<{ group: GroupRow; access: Access; epic: EpicRow }> {
  const { group, access } = await groupScope(q, ctx.user, intParam(ctx, "id"));
  requireAction(access, "epic.read");
  const epic = await findEpic(q, group.id, intParam(ctx, "iid"));
  if (epic === undefined || !epicReadable(access, ctx.user.id, epic)) throw notFound();
  return { group, access, epic };
}

async function parentFor(tx: Tx, groupId: number, value: unknown, selfId: number | null, errors: FieldErrors): Promise<number | null | undefined> {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.add("parent", "Parent must be an epic number.");
    return undefined;
  }
  const parent = await findEpic(tx, groupId, value);
  if (parent === undefined || parent.id === selfId) {
    errors.add("parent", "Parent epic doesn't exist.");
    return undefined;
  }
  if (parent.parent_id !== null) throw depthError();
  if (selfId !== null && (await tx.maybe("SELECT 1 FROM epics WHERE parent_id = $1", [selfId])) !== undefined) throw depthError();
  return parent.id;
}

export function registerEpicRoutes(router: Router): void {
  router.get("/api/groups/:id/epics", async (ctx) => {
    const { group, access } = await groupScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "epic.read");
    const state = ctx.query.get("state");
    const rows = await db.q<EpicRow & { author: string; parent_iid: number | null; issue_count: number }>(
      `SELECT e.*, u.username AS author, pe.iid AS parent_iid, (SELECT count(*)::int FROM issues i WHERE i.epic_id = e.id) AS issue_count
         FROM epics e JOIN users u ON u.id = e.author_id LEFT JOIN epics pe ON pe.id = e.parent_id
        WHERE e.group_id = $1 AND ($2::text IS NULL OR $2 = 'all' OR e.state = $2) ORDER BY e.iid`,
      [group.id, state === "opened" || state === "closed" || state === "all" ? state : null],
    );
    const epics = rows
      .filter((epic) => epicReadable(access, ctx.user.id, epic))
      .map((epic) => ({ iid: epic.iid, title: epic.title, state: epic.state, confidential: epic.confidential, author: epic.author, parent: epic.parent_iid, labels: epic.labels, created_at: iso(epic.created_at) }));
    return json(200, { epics });
  });

  router.get("/api/groups/:id/epics/:iid", async (ctx) => {
    const { access, epic } = await scopedEpic(db, ctx);
    return json(200, await epicView(db, access, ctx.user.id, epic));
  });

  router.post("/api/groups/:id/epics", async (ctx) =>
    withTx(async (tx) => {
      const { group, access } = await groupScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "issue.edit");
      await tx.q("SELECT 1 FROM groups WHERE id = $1 FOR UPDATE", [group.id]);
      const body = bodyOf(ctx);
      const errors = new FieldErrors();
      const problem = titleProblem(body["title"]);
      if (problem !== null) errors.add("title", problem);
      if (has(body, "description") && typeof body["description"] !== "string") errors.add("description", "Description must be text.");
      const parentId = await parentFor(tx, group.id, body["parent"], null, errors);
      errors.throwIfAny();
      const epic = await insertEpic(tx, {
        groupId: group.id, title: String(body["title"]).trim(), description: typeof body["description"] === "string" ? body["description"] : "",
        authorId: ctx.user.id, confidential: body["confidential"] === true, parentId: parentId ?? null, labels: [],
      });
      return json(201, { id: epic.id, iid: epic.iid });
    }),
  );

  router.patch("/api/groups/:id/epics/:iid", async (ctx) =>
    withTx(async (tx) => {
      const { group, access, epic: found } = await scopedEpic(tx, ctx);
      requireAction(access, "issue.edit");
      await tx.q("SELECT 1 FROM groups WHERE id = $1 FOR UPDATE", [group.id]);
      const epic = (await findEpic(tx, group.id, found.iid, true)) ?? found;
      const body = bodyOf(ctx);
      const errors = new FieldErrors();
      let title = epic.title;
      let description = epic.description;
      let state = epic.state;
      let parentId = epic.parent_id;
      if (has(body, "title")) {
        const problem = titleProblem(body["title"]);
        if (problem !== null) errors.add("title", problem);
        else title = String(body["title"]).trim();
      }
      if (has(body, "description")) {
        if (typeof body["description"] === "string") description = body["description"];
        else errors.add("description", "Description must be text.");
      }
      if (has(body, "state_event")) {
        if (body["state_event"] === "close") state = "closed";
        else if (body["state_event"] === "reopen") state = "opened";
        else errors.add("state_event", "State event must be close or reopen.");
      }
      if (has(body, "parent")) {
        const next = await parentFor(tx, group.id, body["parent"], epic.id, errors);
        if (next !== undefined) parentId = next;
      }
      errors.throwIfAny();
      const updated = await tx.one<EpicRow>(
        "UPDATE epics SET title = $2, description = $3, state = $4, parent_id = $5 WHERE id = $1 RETURNING *",
        [epic.id, title, description, state, parentId],
      );
      return json(200, await epicView(tx, access, ctx.user.id, updated));
    }),
  );

  router.post("/api/groups/:id/epics/:iid/issues", async (ctx) =>
    withTx(async (tx) => {
      const { group, access, epic } = await scopedEpic(tx, ctx);
      requireAction(access, "issue.edit");
      const body = bodyOf(ctx);
      const wanted = body["issue"];
      const missing = validationOne("issue", "Issue doesn't exist.");
      if (typeof wanted !== "number" || !Number.isInteger(wanted)) throw missing;
      const found = await findIssueById(tx, wanted);
      const project = found === undefined ? undefined : await findProject(tx, found.project_id);
      if (found === undefined || project === undefined || !project.path.startsWith(`${group.path}/`)) throw missing;
      const projectAccessOfUser = await projectAccess(tx, ctx.user.id, project);
      if (!can(projectAccessOfUser, "issue.read") || !(await mayRead(tx, viewerOf(ctx.user.id, projectAccessOfUser), found))) throw missing;
      requireAction(projectAccessOfUser, "issue.edit");
      await tx.lockProject(project.id);
      const row = await findIssueById(tx, found.id, true);
      if (row === undefined) throw missing;
      const before = await loadState(tx, row);
      const after = copyState(before);
      after.epicId = epic.id;
      const saved = await saveIssue(tx, { project, row, before, after, actor: ctx.user.username, notes: [] });
      return json(201, { epic: epic.iid, issue: row.id, seq: saved.seq ?? (await tx.currentSeq(project.id)) });
    }),
  );
}
