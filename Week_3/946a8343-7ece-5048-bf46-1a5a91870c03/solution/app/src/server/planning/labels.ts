// Labels: a project sees its own and every ancestor group's. A project label with the same name wins, then the nearest group.
import type { Queryable } from "../db.ts";
import { groupScope, projectScope, requireAction, type ProjectRow } from "../access.ts";
import { withTx, db } from "../db.ts";
import { now } from "../clock.ts";
import { conflict, FieldErrors } from "../errors.ts";
import { intParam, json, type Router } from "../http.ts";
import { bodyOf, compareText, groupPathOfProject } from "./util.ts";

export interface LabelInfo {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly source: "project" | "group";
  readonly group: string | null;
}

interface LabelRow {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly project_id: number | null;
  readonly group_path: string | null;
}

function resolve(rows: readonly LabelRow[]): LabelInfo[] {
  const byName = new Map<string, LabelRow>();
  for (const row of rows) {
    const known = byName.get(row.name);
    const better =
      known === undefined ||
      (row.project_id !== null && known.project_id === null) ||
      (row.project_id === null && known.project_id === null && (row.group_path?.length ?? 0) > (known.group_path?.length ?? 0));
    if (better) byName.set(row.name, row);
  }
  return [...byName.values()]
    .map((row): LabelInfo => ({
      id: row.id,
      name: row.name,
      description: row.description,
      source: row.project_id === null ? "group" : "project",
      group: row.project_id === null ? row.group_path : null,
    }))
    .sort((a, b) => compareText(a.name, b.name));
}

const GROUP_LABELS = `l.group_id IS NOT NULL AND ($1 = g.path OR $1 LIKE g.path || '/%')`;

export async function labelsOfProject(q: Queryable, project: ProjectRow): Promise<LabelInfo[]> {
  const rows = await q.q<LabelRow>(
    `SELECT l.id, l.name, l.description, l.project_id, g.path AS group_path FROM labels l LEFT JOIN groups g ON g.id = l.group_id
      WHERE l.project_id = $2 OR (${GROUP_LABELS})`,
    [groupPathOfProject(project.path), project.id],
  );
  return resolve(rows);
}

export async function labelsOfGroup(q: Queryable, groupPath: string): Promise<LabelInfo[]> {
  const rows = await q.q<LabelRow>(
    `SELECT l.id, l.name, l.description, l.project_id, g.path AS group_path FROM labels l JOIN groups g ON g.id = l.group_id
      WHERE ${GROUP_LABELS}`,
    [groupPath],
  );
  return resolve(rows);
}

function labelNameProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return "Name can't be blank.";
  if (/[\t\n\r]/u.test(value)) return "Name can't contain a tab or a line break.";
  if (Array.from(value.trim()).length > 255) return "Name is too long (255 characters at most).";
  return null;
}

export function registerLabelRoutes(router: Router): void {
  router.get("/api/projects/:id/labels", async (ctx) => {
    const { project } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    return json(200, { labels: await labelsOfProject(db, project) });
  });

  router.get("/api/groups/:id/labels", async (ctx) => {
    const { group } = await groupScope(db, ctx.user, intParam(ctx, "id"));
    return json(200, { labels: await labelsOfGroup(db, group.path) });
  });

  router.post("/api/projects/:id/labels", async (ctx) =>
    withTx(async (tx) => {
      const { project, access } = await projectScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "settings");
      await tx.lockProject(project.id);
      const body = bodyOf(ctx);
      const errors = new FieldErrors();
      const problem = labelNameProblem(body["name"]);
      if (problem !== null) errors.add("name", problem);
      if (body["description"] !== undefined && typeof body["description"] !== "string") errors.add("description", "Description must be text.");
      const name = typeof body["name"] === "string" ? body["name"].trim() : "";
      if (problem === null) {
        const taken = await tx.maybe("SELECT 1 FROM labels WHERE project_id = $1 AND name = $2", [project.id, name]);
        if (taken !== undefined) throw conflict("label_taken", "A label with that name already exists.");
      }
      errors.throwIfAny();
      const description = typeof body["description"] === "string" ? body["description"] : "";
      const created = await tx.one<{ id: number }>(
        "INSERT INTO labels (project_id, name, description, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
        [project.id, name, description, now()],
      );
      return json(201, { id: created.id, seq: await tx.currentSeq(project.id) });
    }),
  );

  router.post("/api/groups/:id/labels", async (ctx) =>
    withTx(async (tx) => {
      const { group, access } = await groupScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "settings");
      await tx.q("SELECT 1 FROM groups WHERE id = $1 FOR UPDATE", [group.id]);
      const body = bodyOf(ctx);
      const errors = new FieldErrors();
      const problem = labelNameProblem(body["name"]);
      if (problem !== null) errors.add("name", problem);
      if (body["description"] !== undefined && typeof body["description"] !== "string") errors.add("description", "Description must be text.");
      const name = typeof body["name"] === "string" ? body["name"].trim() : "";
      if (problem === null) {
        const taken = await tx.maybe("SELECT 1 FROM labels WHERE group_id = $1 AND name = $2", [group.id, name]);
        if (taken !== undefined) throw conflict("label_taken", "A label with that name already exists.");
      }
      errors.throwIfAny();
      const description = typeof body["description"] === "string" ? body["description"] : "";
      const created = await tx.one<{ id: number }>(
        "INSERT INTO labels (group_id, name, description, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
        [group.id, name, description, now()],
      );
      return json(201, { id: created.id });
    }),
  );
}
