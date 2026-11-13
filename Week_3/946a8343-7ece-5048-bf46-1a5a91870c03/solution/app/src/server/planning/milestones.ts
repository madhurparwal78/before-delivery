// Milestones and their burndown.
import type { Queryable } from "../db.ts";
import { db, withTx } from "../db.ts";
import { projectScope, requireAction, type ProjectRow } from "../access.ts";
import { now } from "../clock.ts";
import { conflict, FieldErrors, notFound } from "../errors.ts";
import { intParam, json, type Ctx, type Router } from "../http.ts";
import { isTimeZone } from "../../shared/zone.ts";
import { burndown, type HistoryEvent } from "./burndown.ts";
import { viewerOf, visibleSql, type Viewer } from "./visibility.ts";
import { bodyOf, dateField, titleProblem } from "./util.ts";

interface MilestoneRow {
  readonly id: number;
  readonly project_id: number;
  readonly title: string;
  readonly start_date: string;
  readonly due_date: string;
  readonly time_zone: string;
  readonly state: "active" | "closed";
}

async function milestoneOf(q: Queryable, ctx: Ctx, project: ProjectRow): Promise<MilestoneRow> {
  const row = await q.maybe<MilestoneRow>("SELECT * FROM milestones WHERE project_id = $1 AND id = $2", [project.id, intParam(ctx, "mid")]);
  if (row === undefined) throw notFound();
  return row;
}

function view(row: MilestoneRow, counts: { opened: number; closed: number }): Record<string, unknown> {
  return { id: row.id, title: row.title, start: row.start_date, due: row.due_date, time_zone: row.time_zone, state: row.state, issues: counts };
}

async function counts(q: Queryable, milestoneIds: readonly number[], viewer: Viewer): Promise<Map<number, { opened: number; closed: number }>> {
  const rows = await q.q<{ milestone_id: number; state: "opened" | "closed"; count: number }>(
    `SELECT i.milestone_id, i.state, count(*)::int AS count FROM issues i
      WHERE i.milestone_id = ANY($1) AND ${visibleSql("i", "$2", "$3")} GROUP BY i.milestone_id, i.state`,
    [milestoneIds, viewer.userId, viewer.full],
  );
  const byId = new Map<number, { opened: number; closed: number }>();
  for (const id of milestoneIds) byId.set(id, { opened: 0, closed: 0 });
  for (const row of rows) {
    const entry = byId.get(row.milestone_id);
    if (entry !== undefined) entry[row.state === "opened" ? "opened" : "closed"] = row.count;
  }
  return byId;
}

export function registerMilestoneRoutes(router: Router): void {
  router.get("/api/projects/:id/milestones", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "milestone.read");
    const rows = await db.q<MilestoneRow>("SELECT * FROM milestones WHERE project_id = $1 ORDER BY start_date, id", [project.id]);
    const byId = await counts(db, rows.map((row) => row.id), viewerOf(ctx.user.id, access));
    return json(200, { milestones: rows.map((row) => view(row, byId.get(row.id) ?? { opened: 0, closed: 0 })) });
  });

  router.get("/api/projects/:id/milestones/:mid", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "milestone.read");
    const row = await milestoneOf(db, ctx, project);
    const byId = await counts(db, [row.id], viewerOf(ctx.user.id, access));
    return json(200, view(row, byId.get(row.id) ?? { opened: 0, closed: 0 }));
  });

  router.post("/api/projects/:id/milestones", async (ctx) =>
    withTx(async (tx) => {
      const { project, access } = await projectScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "issue.edit");
      await tx.lockProject(project.id);
      const body = bodyOf(ctx);
      const errors = new FieldErrors();
      const problem = titleProblem(body["title"]);
      if (problem !== null) errors.add("title", problem);
      const start = dateField(errors, body, "start", "Start must be a date: YYYY-MM-DD.");
      const due = dateField(errors, body, "due", "Due must be a date: YYYY-MM-DD.");
      const zone = body["time_zone"] === undefined ? "UTC" : body["time_zone"];
      if (!isTimeZone(zone)) errors.add("time_zone", `Unknown time zone ${typeof zone === "string" ? zone : ""}.`);
      if (start !== "" && due !== "" && start > due) errors.add("due", "Due can't be before the start.");
      const title = typeof body["title"] === "string" ? body["title"].trim() : "";
      if (problem === null && (await tx.maybe("SELECT 1 FROM milestones WHERE project_id = $1 AND title = $2", [project.id, title])) !== undefined) {
        throw conflict("milestone_taken", "A milestone with that title already exists.");
      }
      errors.throwIfAny();
      const created = await tx.one<MilestoneRow>(
        "INSERT INTO milestones (project_id, title, start_date, due_date, time_zone, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [project.id, title, start, due, isTimeZone(zone) ? zone : "UTC", now()],
      );
      const seq = await tx.emit(project.id, "milestone", { id: created.id });
      return json(201, { ...view(created, { opened: 0, closed: 0 }), seq });
    }),
  );

  router.get("/api/projects/:id/milestones/:mid/burndown", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "milestone.read");
    const row = await milestoneOf(db, ctx, project);
    const viewer = viewerOf(ctx.user.id, access);
    const events = await db.q<{ issue_id: number; at: number; weight: number | null; state: "opened" | "closed" }>(
      `SELECT h.issue_id, h.at, h.weight, h.state FROM issue_history h JOIN issues i ON i.id = h.issue_id
        WHERE i.milestone_id = $1 AND ${visibleSql("i", "$2", "$3")} ORDER BY h.issue_id, h.at, h.id`,
      [row.id, viewer.userId, viewer.full],
    );
    const histories = new Map<number, HistoryEvent[]>();
    for (const event of events) {
      const list = histories.get(event.issue_id) ?? [];
      list.push({ at: event.at, weight: event.weight, state: event.state });
      histories.set(event.issue_id, list);
    }
    return json(200, { points: burndown({ start: row.start_date, due: row.due_date, zone: row.time_zone }, histories, now()) });
  });
}
