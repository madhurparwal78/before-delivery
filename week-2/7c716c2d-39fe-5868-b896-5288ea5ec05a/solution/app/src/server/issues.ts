// Issues: keys, the status flow, planning, due dates on working days.
import { randomUUID } from "node:crypto";
import { canSeeProject, projectAudience, visibleProjectIds, type Viewer } from "./access.js";
import { attachmentsOf } from "./attachments.js";
import { loadCalendar, type WorkspaceCalendar } from "./calendar.js";
import { cycleIssues, recordFinishedCycles, reportedCycle } from "./cycles.js";
import { tx, type Db } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { emit } from "./events.js";
import { route } from "./router.js";
import { textWithin } from "../shared/text.js";
import { isRealDate, nowMs } from "./time.js";
import { EDGES, STATUSES, isClosed, isStatus, type IssueStatus } from "../shared/status-edges.js";

export interface IssueRow {
  id: string;
  key: string;
  project_id: string;
  project_key: string;
  number: number;
  title: string;
  description: string;
  status: IssueStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_active: boolean;
  parent_id: string | null;
  parent_key: string | null;
  planned_cycle: number | null;
  due_date: string | null;
  closed_at: number | null;
  updated_at: number;
}

const ISSUE_SELECT = `
  SELECT i.id, i.key, i.project_id, p.key AS project_key, i.number, i.title, i.description, i.status,
         i.assignee_id, a.name AS assignee_name, (a.workspace_id IS NOT DISTINCT FROM i.workspace_id) AS assignee_active,
         i.parent_id, parent.key AS parent_key, i.planned_cycle, i.due_date, i.closed_at, i.updated_at
  FROM issues i
  JOIN projects p ON p.id = i.project_id
  LEFT JOIN people a ON a.id = i.assignee_id
  LEFT JOIN issues parent ON parent.id = i.parent_id`;

function listOrder(a: IssueRow, b: IssueRow): number {
  return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.project_key.localeCompare(b.project_key) || a.number - b.number;
}

/** Every issue the viewer can see, in the Issues list order. */
export async function visibleIssueRows(db: Db, viewer: Viewer): Promise<IssueRow[]> {
  const projects = await visibleProjectIds(db, viewer);
  const { rows } = await db.query<IssueRow>(`${ISSUE_SELECT} WHERE i.workspace_id = $1 AND i.project_id = ANY($2)`, [viewer.workspaceId, projects]);
  return rows.sort(listOrder);
}

async function findIssue(db: Db, viewer: Viewer, key: string, lock = false): Promise<IssueRow> {
  const projects = await visibleProjectIds(db, viewer);
  const { rows } = await db.query<IssueRow>(`${ISSUE_SELECT} WHERE i.workspace_id = $1 AND i.key = $2 AND i.project_id = ANY($3)${lock ? " FOR UPDATE OF i" : ""}`, [
    viewer.workspaceId,
    key,
    projects,
  ]);
  if (!rows[0]) throw new ApiError("not_found");
  return rows[0];
}

async function issueJson(db: Db, cal: WorkspaceCalendar, rows: IssueRow[]): Promise<Record<string, unknown>[]> {
  const ids = rows.map((r) => r.id);
  const { rows: subs } = await db.query<{ parent_id: string; key: string }>("SELECT parent_id, key FROM issues WHERE parent_id = ANY($1) ORDER BY number", [ids]);
  const attachments = await attachmentsOf(db, "issue", ids);
  return rows.map((row) => ({
    key: row.key,
    project_id: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    assignee_id: row.assignee_id,
    assignee_name: row.assignee_name === null ? null : row.assignee_active ? row.assignee_name : `${row.assignee_name} (removed)`,
    parent_key: row.parent_key,
    sub_issue_keys: subs.filter((s) => s.parent_id === row.id).map((s) => s.key),
    cycle_number: reportedCycle(cal, row),
    due_date: row.due_date,
    closed_at: row.closed_at === null ? null : cal.instant(row.closed_at),
    updated_at: cal.instant(row.updated_at),
    attachments: attachments.get(row.id) ?? [],
  }));
}

async function oneIssueJson(db: Db, viewer: Viewer, key: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const cal = await loadCalendar(db, viewer.workspaceId);
  const [json] = await issueJson(db, cal, [await findIssue(db, viewer, key)]);
  return { ...json, ...extra };
}

/** Tells everyone who shares the project about a created or changed issue. */
export async function emitIssue(db: Db, workspaceId: string, key: string): Promise<void> {
  const cal = await loadCalendar(db, workspaceId);
  const { rows } = await db.query<IssueRow>(`${ISSUE_SELECT} WHERE i.workspace_id = $1 AND i.key = $2`, [workspaceId, key]);
  const [json] = await issueJson(db, cal, rows);
  await emit(db, workspaceId, "issue", json as Record<string, unknown>, { projectId: (rows[0] as IssueRow).project_id });
}

interface Planned {
  fields: Record<string, string>;
  values: Record<string, unknown>;
  snapped: boolean;
}

/** Validates the writable fields present in `body`; the cycle_closed check runs after validation. */
async function plan(db: Db, viewer: Viewer, cal: WorkspaceCalendar, projectId: string, body: Record<string, unknown>, creating: boolean): Promise<Planned & { closedCycle: number | null }> {
  const fields: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  let snapped = false;
  let closedCycle: number | null = null;
  if (creating || "title" in body) {
    if (!textWithin(body.title, 1, 200)) fields.title = "Give the issue a title.";
    else values.title = body.title;
  }
  if ("description" in body && body.description !== null) {
    if (!textWithin(body.description, 0, 20_000)) fields.description = "Descriptions can be up to 20,000 characters.";
    else values.description = body.description;
  }
  if ("assignee_id" in body) {
    const assignee = body.assignee_id;
    if (assignee === null) values.assignee_id = null;
    else if (typeof assignee !== "string" || !(await projectAudience(db, viewer.workspaceId, projectId)).some((p) => p.id === assignee)) fields.assignee_id = "Choose someone who can see this project.";
    else values.assignee_id = assignee;
  }
  if ("cycle_number" in body) {
    const cycle = body.cycle_number;
    if (cycle === null) values.planned_cycle = null;
    else if (typeof cycle !== "number" || !Number.isInteger(cycle) || cycle < 1 || cycle > 1000) fields.cycle_number = "Choose a cycle that exists.";
    else {
      values.planned_cycle = cycle;
      if (cal.isFinished(cycle)) closedCycle = cycle;
    }
  }
  if ("due_date" in body) {
    const due = body.due_date;
    if (due === null) values.due_date = null;
    else if (!isRealDate(due)) fields.due_date = "Enter a date as YYYY-MM-DD.";
    else {
      const result = cal.snap(due);
      values.due_date = result.date;
      snapped = result.snapped;
    }
  }
  return { fields, values, snapped, closedCycle };
}

route("GET", "/api/issues", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  const project = ctx.query.get("project");
  const cycle = ctx.query.get("cycle");
  const status = ctx.query.get("status");
  const fields: Record<string, string> = {};
  if (cycle !== null && cycle !== "current" && cycle !== "none" && !(/^[1-9]\d{0,3}$/.test(cycle) && Number(cycle) <= 1000)) fields.cycle = "Use a cycle number, current or none.";
  if (status !== null && !isStatus(status)) fields.status = "Use a status value.";
  if (Object.keys(fields).length) throw invalid(fields);
  return {
    status: 200,
    body: await tx(async (db) => {
      const cal = await loadCalendar(db, viewer.workspaceId);
      let rows: IssueRow[];
      if (cycle === null || cycle === "none") {
        rows = await visibleIssueRows(db, viewer);
        if (cycle === "none") rows = rows.filter((r) => r.planned_cycle === null);
      } else {
        rows = await cycleIssues(db, viewer, cal, cycle === "current" ? cal.currentNumber() : Number(cycle));
      }
      if (project !== null) rows = rows.filter((r) => r.project_id === project);
      if (status !== null) rows = rows.filter((r) => r.status === status);
      return { issues: await issueJson(db, cal, rows) };
    }),
  };
});

route("GET", "/api/issues/:key", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return { status: 200, body: await tx((db) => oneIssueJson(db, viewer, ctx.params.key ?? "")) };
});

route("POST", "/api/issues", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  const body = ctx.body;
  return tx(async (db) => {
    const projectId = body.project_id;
    if (typeof projectId !== "string" || !(await canSeeProject(db, viewer, projectId))) throw new ApiError("not_found");
    const cal = await loadCalendar(db, viewer.workspaceId);
    await recordFinishedCycles(db, viewer.workspaceId, cal);
    const planned = await plan(db, viewer, cal, projectId, body, true);
    let parentId: string | null = null;
    if (body.parent_key !== undefined && body.parent_key !== null) {
      const { rows } = await db.query<{ id: string; parent_id: string | null; project_id: string }>("SELECT id, parent_id, project_id FROM issues WHERE workspace_id = $1 AND key = $2 FOR UPDATE", [
        viewer.workspaceId,
        body.parent_key,
      ]);
      const parent = rows[0];
      if (!parent || parent.project_id !== projectId || parent.parent_id !== null) planned.fields.parent_key = "Choose a top-level issue in the same project.";
      else parentId = parent.id;
    }
    if (Object.keys(planned.fields).length) throw invalid(planned.fields);
    if (planned.closedCycle !== null) throw new ApiError("cycle_closed");
    const { rows } = await db.query<{ number: number; key: string }>(
      "UPDATE projects SET next_number = next_number + 1 WHERE id = $1 RETURNING next_number - 1 AS number, key",
      [projectId],
    );
    const counter = rows[0] as { number: number; key: string };
    const key = `${counter.key}-${counter.number}`;
    const now = nowMs();
    await db.query(
      `INSERT INTO issues (id, workspace_id, project_id, number, key, title, description, status, assignee_id, parent_id, planned_cycle, due_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'backlog', $8, $9, $10, $11, $12, $12)`,
      [randomUUID(), viewer.workspaceId, projectId, counter.number, key, planned.values.title, planned.values.description ?? "", planned.values.assignee_id ?? null, parentId, planned.values.planned_cycle ?? null, planned.values.due_date ?? null, now],
    );
    await emitIssue(db, viewer.workspaceId, key);
    if (typeof body.parent_key === "string") await emitIssue(db, viewer.workspaceId, body.parent_key);
    return { status: 201, body: await oneIssueJson(db, viewer, key, { due_date_snapped: planned.snapped }) };
  });
});

const COLUMNS: Record<string, string> = { title: "title", description: "description", assignee_id: "assignee_id", planned_cycle: "planned_cycle", due_date: "due_date" };

route("PATCH", "/api/issues/:key", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return tx(async (db) => {
    const issue = await findIssue(db, viewer, ctx.params.key ?? "", true);
    const cal = await loadCalendar(db, viewer.workspaceId);
    await recordFinishedCycles(db, viewer.workspaceId, cal);
    const planned = await plan(db, viewer, cal, issue.project_id, ctx.body, false);
    if (Object.keys(planned.fields).length) throw invalid(planned.fields);
    if (planned.closedCycle !== null) throw new ApiError("cycle_closed");
    const entries = Object.entries(planned.values);
    if (entries.length) {
      const sets = entries.map(([name], i) => `${COLUMNS[name]} = $${i + 2}`).join(", ");
      await db.query(`UPDATE issues SET ${sets}, updated_at = $${entries.length + 2} WHERE id = $1`, [issue.id, ...entries.map(([, v]) => v), nowMs()]);
      await emitIssue(db, viewer.workspaceId, issue.key);
    }
    return { status: 200, body: await oneIssueJson(db, viewer, issue.key, { due_date_snapped: planned.snapped }) };
  });
});

route("POST", "/api/issues/:key/transition", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return tx(async (db) => {
    const issue = await findIssue(db, viewer, ctx.params.key ?? "", true);
    if (issue.parent_id) await db.query("SELECT 1 FROM issues WHERE id = $1 FOR UPDATE", [issue.parent_id]);
    const to = ctx.body.to;
    if (!isStatus(to)) throw invalid({ to: "Choose a status." });
    if (!EDGES[issue.status].includes(to)) throw new ApiError("illegal_transition");
    if (to === "done") {
      const { rows } = await db.query("SELECT 1 FROM issues WHERE parent_id = $1 AND status NOT IN ('done', 'cancelled')", [issue.id]);
      if (rows.length) throw new ApiError("open_sub_issues");
    }
    const cal = await loadCalendar(db, viewer.workspaceId);
    await recordFinishedCycles(db, viewer.workspaceId, cal);
    const now = nowMs();
    await db.query("UPDATE issues SET status = $2, closed_at = $3, updated_at = $4 WHERE id = $1", [issue.id, to, isClosed(to) ? now : null, now]);
    await emitIssue(db, viewer.workspaceId, issue.key);
    return { status: 200, body: await oneIssueJson(db, viewer, issue.key) };
  });
});
