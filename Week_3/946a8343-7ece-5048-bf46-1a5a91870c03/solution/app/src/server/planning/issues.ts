// Issue routes (create, read, edit, comment with quick actions, link) and the issue functions other modules call.
import type { Queryable, Tx } from "../db.ts";
import { db, withTx } from "../db.ts";
import {
  can, projectAccess, projectScope, requireAction,
  type Access, type ProjectRow,
} from "../access.ts";
import { iso } from "../clock.ts";
import { FieldErrors, forbidden, notFound, validation } from "../errors.ts";
import { intParam, json, type Ctx, type Router } from "../http.ts";
import type { Person } from "../repo/types.ts";
import { parseCommentBody, parseDuration, isValidWeight, WEIGHT_MESSAGE } from "../lib/quick-actions.ts";
import { isDate } from "./burndown.ts";
import {
  announce, diffStates, findIssue, insertIssue, issueView, linkIssues, loadState, Resolver, saveIssue,
  type IssueRow, type LinkView,
} from "./issues-core.ts";
import {
  changeAssignees, changeLabels, copyState, setConfidential, setDueDate, setEstimate, setIssueState, setMilestone, setTitle, setWeight,
  type IssueState,
} from "./issue-state.ts";
import { runQuickActions } from "./quick.ts";
import { mayRead, viewerOf, visibleSql, type Viewer } from "./visibility.ts";
import { bodyOf, has, noteView, stringList, titleProblem, type Body, type NoteRow } from "./util.ts";

interface IssueScope {
  readonly project: ProjectRow;
  readonly access: Access;
  readonly viewer: Viewer;
  readonly row: IssueRow;
}

/** The issue of a request, or 404 when the project is unreadable or the issue is confidential to the viewer. */
async function scopedIssue(q: Queryable, ctx: Ctx, lock = false): Promise<IssueScope> {
  const { project, access } = await projectScope(q, ctx.user, intParam(ctx, "id"));
  const row = await findIssue(q, project.id, intParam(ctx, "iid"), lock);
  const viewer = viewerOf(ctx.user.id, access);
  if (row === undefined || !(await mayRead(q, viewer, row))) throw notFound();
  return { project, access, viewer, row };
}

function emptyState(): IssueState {
  return {
    title: "", description: "", state: "opened", labels: [], assignees: [], milestone: null, weight: null, dueDate: null,
    estimate: null, spent: 0, confidential: false, epicId: null,
  };
}

async function milestoneFrom(resolver: Resolver, value: unknown): Promise<{ id: number; title: string } | null | undefined> {
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value)) return resolver.milestoneById(value);
  if (typeof value === "string") return resolver.milestoneByTitle(value);
  return undefined;
}

interface Fields {
  readonly errors: FieldErrors;
  readonly resolver: Resolver;
  readonly body: Body;
}

async function checkedLabels(fields: Fields, key: string): Promise<string[]> {
  const names = stringList(fields.body[key]);
  if (names === null) {
    fields.errors.add(key, "Labels must be a list of names.");
    return [];
  }
  for (const name of names) {
    if (!(await fields.resolver.hasLabel(name))) fields.errors.add(key, `Label ~${name} doesn't exist.`);
  }
  return names;
}

async function checkedAssignees(fields: Fields): Promise<string[]> {
  const names = stringList(fields.body["assignees"]);
  if (names === null) {
    fields.errors.add("assignees", "Assignees must be a list of usernames.");
    return [];
  }
  for (const name of names) {
    if (!(await fields.resolver.userExists(name))) fields.errors.add("assignees", `User @${name} doesn't exist.`);
  }
  return names;
}

async function checkedMilestone(fields: Fields): Promise<{ id: number; title: string } | null | undefined> {
  const milestone = await milestoneFrom(fields.resolver, fields.body["milestone"]);
  if (milestone === undefined) fields.errors.add("milestone", "Milestone doesn't exist.");
  return milestone;
}

function checkedWeight(fields: Fields): number | null | undefined {
  const weight = fields.body["weight"];
  if (weight === null) return null;
  if (typeof weight === "number" && isValidWeight(weight)) return weight;
  fields.errors.add("weight", WEIGHT_MESSAGE);
  return undefined;
}

function checkedDue(fields: Fields): string | null | undefined {
  const due = fields.body["due_date"];
  if (due === null) return null;
  if (isDate(due)) return due;
  fields.errors.add("due_date", "Due date must be a date: YYYY-MM-DD.");
  return undefined;
}

function checkedEstimate(fields: Fields): number | null | undefined {
  const estimate = fields.body["estimate"];
  if (estimate === null) return null;
  const minutes = typeof estimate === "string" ? parseDuration(estimate) : null;
  if (minutes === null) {
    fields.errors.add("estimate", `Invalid duration: ${typeof estimate === "string" ? estimate : String(estimate)}.`);
    return undefined;
  }
  return minutes;
}

function checkedFlag(fields: Fields, key: string): boolean | undefined {
  const value = fields.body[key];
  if (typeof value === "boolean") return value;
  fields.errors.add(key, "Must be true or false.");
  return undefined;
}

function checkedText(fields: Fields, key: string): string | undefined {
  const value = fields.body[key];
  if (typeof value === "string") return value;
  fields.errors.add(key, "Must be text.");
  return undefined;
}

async function createFromBody(tx: Tx, ctx: Ctx, project: ProjectRow, access: Access): Promise<{ iid: number; id: number; seq: number }> {
  const body = bodyOf(ctx);
  const nonEmpty = (key: string): boolean => {
    const value = body[key];
    return has(body, key) && value !== null && !(Array.isArray(value) && value.length === 0);
  };
  if (!can(access, "issue.edit") && (nonEmpty("labels") || nonEmpty("assignees") || nonEmpty("milestone") || nonEmpty("weight"))) throw forbidden();
  await tx.lockProject(project.id);
  const fields: Fields = { errors: new FieldErrors(), resolver: new Resolver(tx, project), body };
  const state = emptyState();
  const problem = titleProblem(body["title"]);
  if (problem !== null) fields.errors.add("title", problem);
  else state.title = String(body["title"]).trim();
  if (has(body, "description")) state.description = checkedText(fields, "description") ?? "";
  if (has(body, "labels")) state.labels = await checkedLabels(fields, "labels");
  if (has(body, "assignees")) state.assignees = await checkedAssignees(fields);
  if (has(body, "milestone")) state.milestone = (await checkedMilestone(fields)) ?? null;
  if (has(body, "weight")) state.weight = checkedWeight(fields) ?? null;
  if (has(body, "due_date")) state.dueDate = checkedDue(fields) ?? null;
  if (has(body, "confidential")) state.confidential = checkedFlag(fields, "confidential") ?? false;
  fields.errors.throwIfAny();
  state.labels = [...new Set(state.labels)];
  state.assignees = [...new Set(state.assignees)];
  const row = await insertIssue(tx, project, { author: ctx.user, state });
  const seq = await announce(tx, {
    project, issue: { id: row.id, iid: row.iid, epicId: null }, before: null, after: state,
    change: diffStates(emptyState(), state), notes: [], commented: false, cardMoved: false,
  });
  return { iid: row.iid, id: row.id, seq: seq ?? (await tx.currentSeq(project.id)) };
}

async function patchFromBody(tx: Tx, ctx: Ctx, scope: IssueScope): Promise<{ notes: string[]; seq: number | null }> {
  const { project, row } = scope;
  const body = bodyOf(ctx);
  const fields: Fields = { errors: new FieldErrors(), resolver: new Resolver(tx, project), body };
  const before = await loadState(tx, row);
  const after = copyState(before);
  const notes: string[] = [];
  if (has(body, "title")) {
    const problem = titleProblem(body["title"]);
    if (problem !== null) fields.errors.add("title", problem);
    else if (String(body["title"]).trim() !== before.title) notes.push(...setTitle(after, String(body["title"]).trim()));
  }
  if (has(body, "description")) after.description = checkedText(fields, "description") ?? after.description;
  const add: string[] = [];
  const remove: string[] = [];
  if (has(body, "labels")) {
    const wanted = await checkedLabels(fields, "labels");
    add.push(...wanted.filter((name) => !before.labels.includes(name)));
    remove.push(...before.labels.filter((name) => !wanted.includes(name)));
  }
  if (has(body, "add_labels")) add.push(...(await checkedLabels(fields, "add_labels")));
  if (has(body, "remove_labels")) {
    const names = stringList(body["remove_labels"]);
    if (names === null) fields.errors.add("remove_labels", "Labels must be a list of names.");
    else remove.push(...names);
  }
  let people: string[] | null = null;
  if (has(body, "assignees")) people = await checkedAssignees(fields);
  const milestone = has(body, "milestone") ? await checkedMilestone(fields) : undefined;
  const weight = has(body, "weight") ? checkedWeight(fields) : undefined;
  const estimate = has(body, "estimate") ? checkedEstimate(fields) : undefined;
  const due = has(body, "due_date") ? checkedDue(fields) : undefined;
  const confidential = has(body, "confidential") ? checkedFlag(fields, "confidential") : undefined;
  let next: "opened" | "closed" | undefined;
  if (has(body, "state_event")) {
    if (body["state_event"] === "close") next = "closed";
    else if (body["state_event"] === "reopen") next = "opened";
    else fields.errors.add("state_event", "State event must be close or reopen.");
  }
  fields.errors.throwIfAny();
  if (add.length > 0 || remove.length > 0) notes.push(...changeLabels(after, add, remove));
  if (people !== null) {
    notes.push(...changeAssignees(after, people.filter((name) => !before.assignees.includes(name)), before.assignees.filter((name) => !people.includes(name))));
  }
  if (milestone !== undefined && milestone?.id !== before.milestone?.id) notes.push(...setMilestone(after, milestone));
  if (weight !== undefined && weight !== before.weight) notes.push(...setWeight(after, weight));
  if (estimate !== undefined && estimate !== before.estimate) notes.push(...setEstimate(after, estimate));
  if (due !== undefined && due !== before.dueDate) notes.push(...setDueDate(after, due));
  if (confidential !== undefined) notes.push(...setConfidential(after, confidential));
  if (next !== undefined) notes.push(...setIssueState(after, next));
  const saved = await saveIssue(tx, { project, row, before, after, actor: ctx.user.username, notes });
  return { notes, seq: saved.seq };
}

async function postNote(tx: Tx, ctx: Ctx): Promise<{ note: unknown; results: string[]; seq: number }> {
  const first = await scopedIssue(tx, ctx);
  requireAction(first.access, "issue.comment");
  const body = bodyOf(ctx)["body"];
  await tx.lockProject(first.project.id);
  const row = (await findIssue(tx, first.project.id, first.row.iid, true)) ?? first.row;
  const parsed = typeof body !== "string" ? undefined : can(first.access, "issue.edit") ? parseCommentBody(body) : { text: body.trimEnd(), actions: [] };
  if (parsed === undefined || (parsed.text.trim() === "" && parsed.actions.length === 0)) {
    throw validation({ body: "Comment can't be blank." });
  }
  const text = parsed.text;
  const before = await loadState(tx, row);
  const after = copyState(before);
  const results = await runQuickActions(
    { tx, project: first.project, row, state: after, actor: ctx.user, viewer: first.viewer, resolver: new Resolver(tx, first.project) },
    parsed.actions,
  );
  const saved = await saveIssue(tx, {
    project: first.project, row, before, after, actor: ctx.user.username, notes: results, ...(text.trim() === "" ? {} : { comment: text }),
  });
  return { note: saved.comment, results, seq: saved.seq ?? (await tx.currentSeq(first.project.id)) };
}

interface ListRow {
  readonly id: number;
  readonly iid: number;
  readonly title: string;
  readonly state: "opened" | "closed";
  readonly author: string;
  readonly labels: string[];
  readonly assignees: string[];
  readonly milestone: string | null;
  readonly weight: number | null;
  readonly confidential: boolean;
  readonly created_at: number;
}

async function listIssues(q: Queryable, ctx: Ctx, project: ProjectRow, viewer: Viewer): Promise<ListRow[]> {
  const params: (string | number | boolean | readonly number[])[] = [project.id, viewer.userId, viewer.full];
  const where = ["i.project_id = $1", visibleSql("i", "$2", "$3")];
  const add = (sql: (placeholder: string) => string, value: string | readonly number[]): void => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };
  const state = ctx.query.get("state");
  if (state === "opened" || state === "closed") add((p) => `i.state = ${p}`, state);
  const label = ctx.query.get("label");
  if (label !== null && label !== "") add((p) => `${p} = ANY(i.labels)`, label);
  const assignee = ctx.query.get("assignee");
  if (assignee !== null && assignee !== "") {
    add((p) => `EXISTS (SELECT 1 FROM issue_assignees fa JOIN users fu ON fu.id = fa.user_id WHERE fa.issue_id = i.id AND fu.username = ${p})`, assignee);
  }
  const milestone = ctx.query.get("milestone");
  if (milestone !== null && milestone !== "") add((p) => `m.title = ${p}`, milestone);
  const search = ctx.query.get("search");
  if (search !== null && search !== "") add((p) => `(position(lower(${p}) in lower(i.title)) > 0 OR position(lower(${p}) in lower(i.description)) > 0)`, search);
  const iids = ctx.query.get("iids");
  if (iids !== null && iids !== "") {
    add((p) => `i.iid = ANY(${p}::int[])`, iids.split(",").map(Number).filter((n) => Number.isInteger(n)));
  }
  return q.q<ListRow>(
    `SELECT i.id, i.iid, i.title, i.state, u.username AS author, i.labels, m.title AS milestone, i.weight, i.confidential, i.created_at,
            COALESCE((SELECT array_agg(au.username ORDER BY au.username) FROM issue_assignees ia JOIN users au ON au.id = ia.user_id WHERE ia.issue_id = i.id), '{}') AS assignees
       FROM issues i JOIN users u ON u.id = i.author_id LEFT JOIN milestones m ON m.id = i.milestone_id
      WHERE ${where.join(" AND ")} ORDER BY i.iid DESC`,
    params,
  );
}

const LINK_KINDS: readonly LinkView["kind"][] = ["relates", "blocks", "blocked by"];

export function registerIssueRoutes(router: Router): void {
  router.get("/api/projects/:id/issues", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "issue.read");
    const rows = await listIssues(db, ctx, project, viewerOf(ctx.user.id, access));
    return json(200, { count: rows.length, issues: rows.map((row) => ({ ...row, created_at: iso(row.created_at) })) });
  });

  router.post("/api/projects/:id/issues", async (ctx) =>
    withTx(async (tx) => {
      const { project, access } = await projectScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "issue.create");
      return json(201, await createFromBody(tx, ctx, project, access));
    }),
  );

  router.get("/api/projects/:id/issues/:iid", async (ctx) => {
    const { project, viewer, row } = await scopedIssue(db, ctx);
    return json(200, await issueView(db, project, row, viewer));
  });

  router.patch("/api/projects/:id/issues/:iid", async (ctx) =>
    withTx(async (tx) => {
      const first = await scopedIssue(tx, ctx);
      requireAction(first.access, "issue.edit");
      await tx.lockProject(first.project.id);
      const row = (await findIssue(tx, first.project.id, first.row.iid, true)) ?? first.row;
      const { seq } = await patchFromBody(tx, ctx, { ...first, row });
      const latest = (await findIssue(tx, first.project.id, row.iid)) ?? row;
      return json(200, { ...(await issueView(tx, first.project, latest, first.viewer)), seq: seq ?? (await tx.currentSeq(first.project.id)) });
    }),
  );

  router.get("/api/projects/:id/issues/:iid/notes", async (ctx) => {
    const { row } = await scopedIssue(db, ctx);
    const notes = await db.q<NoteRow>("SELECT id, author, body, system, created_at FROM issue_notes WHERE issue_id = $1 ORDER BY id", [row.id]);
    return json(200, { notes: notes.map(noteView) });
  });

  router.post("/api/projects/:id/issues/:iid/notes", async (ctx) => withTx(async (tx) => json(201, await postNote(tx, ctx))));

  router.post("/api/projects/:id/issues/:iid/links", async (ctx) =>
    withTx(async (tx) => {
      const first = await scopedIssue(tx, ctx);
      requireAction(first.access, "issue.edit");
      await tx.lockProject(first.project.id);
      const row = (await findIssue(tx, first.project.id, first.row.iid, true)) ?? first.row;
      const body = bodyOf(ctx);
      const errors = new FieldErrors();
      const kind = LINK_KINDS.find((candidate) => candidate === body["kind"]);
      if (kind === undefined) errors.add("kind", "Kind must be relates, blocks or blocked by.");
      const wanted = typeof body["target"] === "string" ? /^#?(\d+)$/u.exec(body["target"].trim()) : null;
      const target = wanted === null ? undefined : await findIssue(tx, first.project.id, Number(wanted[1]));
      if (target === undefined || target.id === row.id || !(await mayRead(tx, first.viewer, target))) errors.add("target", "Target issue doesn't exist.");
      errors.throwIfAny();
      if (kind === undefined || target === undefined) throw notFound();
      const created = await linkIssues(tx, first.project, row, target, kind);
      const before = await loadState(tx, row);
      const notes = created ? [`Linked #${target.iid}.`] : [];
      const saved = await saveIssue(tx, { project: first.project, row, before, after: copyState(before), actor: ctx.user.username, notes });
      return json(201, { seq: saved.seq ?? (await tx.currentSeq(first.project.id)) });
    }),
  );
}

/** Closes issues named by a merged request's closing keywords (default branch only), writing `Closed by !<iid>.` on each,
 *  confidential ones included. */
export async function closeIssuesForMerge(tx: Tx, project: ProjectRow, issueIids: readonly number[], mrIid: number, by: Person): Promise<void> {
  for (const iid of issueIids) {
    const row = await findIssue(tx, project.id, iid, true);
    if (row === undefined || row.state === "closed") continue;
    const before = await loadState(tx, row);
    const after = copyState(before);
    after.state = "closed";
    await saveIssue(tx, { project, row, before, after, actor: by.username, notes: [`Closed by !${mrIid}.`] });
  }
}

/** The subset of `iids` the viewer may read (confidential issues are hidden from people without access). */
export async function readableIssueIids(q: Queryable, userId: number, project: ProjectRow, iids: readonly number[]): Promise<number[]> {
  if (iids.length === 0) return [];
  const access = await projectAccess(q, userId, project);
  if (!can(access, "issue.read")) return [];
  const viewer = viewerOf(userId, access);
  const rows = await q.q<{ iid: number }>(
    `SELECT i.iid FROM issues i WHERE i.project_id = $1 AND i.iid = ANY($2) AND ${visibleSql("i", "$3", "$4")}`,
    [project.id, iids, userId, viewer.full],
  );
  const readable = new Set(rows.map((row) => row.iid));
  return iids.filter((iid) => readable.has(iid));
}

/** Creates an issue authored by `author` (used by `Move to issue`). Returns its iid. */
export async function createIssue(tx: Tx, project: ProjectRow, author: Person, fields: { title: string; description: string }): Promise<number> {
  await tx.lockProject(project.id);
  const state = { ...emptyState(), title: fields.title, description: fields.description };
  const row = await insertIssue(tx, project, { author, state });
  await announce(tx, {
    project, issue: { id: row.id, iid: row.iid, epicId: null }, before: null, after: state,
    change: diffStates(emptyState(), state), notes: [], commented: false, cardMoved: false,
  });
  return row.iid;
}

/** Open issues the viewer may read, for the project home. */
export async function openIssueCount(q: Queryable, userId: number, project: ProjectRow): Promise<number> {
  const access = await projectAccess(q, userId, project);
  if (!can(access, "issue.read")) return 0;
  const row = await q.one<{ count: number }>(
    `SELECT count(*)::int AS count FROM issues i WHERE i.project_id = $1 AND i.state = 'opened' AND ${visibleSql("i", "$2", "$3")}`,
    [project.id, userId, viewerOf(userId, access).full],
  );
  return row.count;
}
