// Reading audit events: owners and people with `read_audit`, newest first. Only GET exists, so any other method is 405.
import { iso } from "../clock.ts";
import { db, type Queryable } from "../db.ts";
import { groupScope, projectScope, requireAction } from "../access.ts";
import { intParam, json, type Router } from "../http.ts";

const PAGE = 1000;

interface EventRow {
  readonly id: number;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly before: object | null;
  readonly after: object | null;
  readonly at: number;
}

async function events(q: Queryable, column: "project_id" | "group_id", id: number): Promise<object[]> {
  const rows = await q.q<EventRow>(
    `SELECT id, actor, action, target, before, after, at FROM audit_events WHERE ${column} = $1 ORDER BY id DESC LIMIT ${PAGE}`,
    [id],
  );
  return rows.map((row) => ({ ...row, at: iso(row.at) }));
}

export function registerAuditRoutes(router: Router): void {
  router.get("/api/projects/:id/audit", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "audit.read");
    return json(200, { events: await events(db, "project_id", project.id) });
  });

  router.get("/api/groups/:id/audit", async (ctx) => {
    const { group, access } = await groupScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "audit.read");
    return json(200, { events: await events(db, "group_id", group.id) });
  });
}
