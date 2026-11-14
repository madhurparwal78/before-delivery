import { isDialect, exportDdl } from "../shared/ddl-export.js";
import { arrangeLayout, emptyLayout, isColour, isGridPosition, type Layout } from "../shared/layout.js";
import { utf8Length } from "../shared/mortise.js";
import { isTemplateId, TEMPLATES } from "../shared/templates.js";
import { changedUnits, mergeUnits } from "../shared/units.js";
import { planGroup, planLink, planRename, planUngroup } from "../shared/writes.js";
import { requireUser, type User } from "./auth.js";
import { config, parseLimits } from "./config.js";
import { query, transaction, type Queryable } from "./db.js";
import { FIELD, fail, type Fields } from "./errors.js";
import { baseRevisionOf, deny, isWholeNumber, requireLatestValid } from "./guard.js";
import { json, parseJson, type Context, type Router } from "./http.js";
import { live } from "./live.js";
import {
  commitText,
  insertProject,
  loadProject,
  parseText,
  projectAccess,
  projectJson,
  saveLayout,
  type Committed,
  type ProjectRow,
} from "./project-store.js";

function validProjectName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 80;
}

function summary(project: ProjectRow, role: string) {
  return {
    id: project.id,
    name: project.name,
    role,
    revision: project.revision,
    entityCount: Object.keys(project.layout.entities).length,
    updatedAt: project.updated_at.toISOString(),
  };
}

interface Outcome<T> {
  reply: T;
  committed: Committed | null;
  user: User;
}

/** Fans an accepted change out to every open live channel; group and rename writes always carry their layout. */
function announce<T>(projectId: string, outcome: Outcome<T>, withLayout = false): void {
  const { committed, user } = outcome;
  if (!committed) return;
  live.revision(projectId, committed.revision, committed.text, user);
  if (withLayout || committed.layoutChanged) live.layout(projectId, committed.layout, user);
}

/** The display name of the author of the latest accepted edit after `base` that changed the unit. */
async function conflictAuthor(db: Queryable, projectId: string, base: number, unit: string): Promise<string> {
  const rows = await db.query<{ revision: number; text: string; display_name: string }>(
    `SELECT e.revision, e.text, u.display_name FROM edits e JOIN users u ON u.id = e.author_id
     WHERE e.project_id = $1 AND e.revision >= $2 ORDER BY e.revision DESC`,
    [projectId, base],
  );
  const list = rows.rows;
  for (let i = 0; i < list.length - 1; i++) {
    if (changedUnits(list[i + 1]!.text, list[i]!.text).includes(unit)) return list[i]!.display_name;
  }
  return list[0]!.display_name;
}

export async function withProject<T>(
  ctx: Context,
  permission: "read" | "write" | "manage",
  work: (db: Queryable, project: ProjectRow, user: User) => Promise<T>,
): Promise<T> {
  const user = await requireUser(ctx);
  return transaction(async (db) => {
    const { project, role } = await projectAccess(db, ctx.params.id!, user, permission !== "read");
    deny(role, permission);
    return work(db, project, user);
  });
}

export function registerProjectRoutes(router: Router): void {
  router.add("GET", "/api/projects", async (ctx) => {
    const user = await requireUser(ctx);
    const owned = await query<ProjectRow>(
      `SELECT p.*, u.display_name AS owner_name FROM projects p JOIN users u ON u.id = p.owner_id
       WHERE p.owner_id = $1 ORDER BY p.updated_at DESC`,
      [user.id],
    );
    const shared = await query<ProjectRow & { role: string }>(
      `SELECT p.*, u.display_name AS owner_name, m.role FROM projects p JOIN users u ON u.id = p.owner_id
       JOIN members m ON m.project_id = p.id WHERE m.user_id = $1 AND m.role IN ('editor', 'viewer') ORDER BY p.updated_at DESC`,
      [user.id],
    );
    return json(200, { owned: owned.map((p) => summary(p, "owner")), shared: shared.map((p) => summary(p, p.role)) });
  });

  router.add("POST", "/api/projects", async (ctx) => {
    const user = await requireUser(ctx);
    const body = parseJson(ctx.body);
    const fields: Fields = {};
    if (!validProjectName(body.name)) fields.name = FIELD.projectName;
    if (body.templateId !== undefined && !isTemplateId(body.templateId)) fields.templateId = FIELD.template;
    if (Object.keys(fields).length) throw fail.invalid(fields);
    const template = TEMPLATES.find((t) => t.id === body.templateId);
    const project = await transaction(async (db) => {
      const id = await insertProject(db, user, (body.name as string).trim(), template?.text ?? "", emptyLayout());
      return (await loadProject(db, id))!;
    });
    return json(201, projectJson(project, "owner"));
  });

  router.add("GET", "/api/projects/:id", async (ctx) => {
    const user = await requireUser(ctx);
    const { project, role } = await transaction((db) => projectAccess(db, ctx.params.id!, user));
    return json(200, projectJson(project, role));
  });

  router.add("PATCH", "/api/projects/:id", async (ctx) => {
    const user = await requireUser(ctx);
    const result = await transaction(async (db) => {
      const { project, role } = await projectAccess(db, ctx.params.id!, user, true);
      deny(role, "write");
      const body = parseJson(ctx.body);
      if (!validProjectName(body.name)) throw fail.invalid({ name: FIELD.projectName });
      const now = new Date();
      await db.query("UPDATE projects SET name = $2, updated_at = $3 WHERE id = $1", [project.id, body.name.trim(), now]);
      project.name = body.name.trim();
      project.updated_at = now;
      return projectJson(project, role);
    });
    return json(200, result);
  });

  router.add("POST", "/api/projects/:id/edits", async (ctx) => {
    const outcome = await withProject(ctx, "write", async (db, project, user): Promise<Outcome<unknown>> => {
      const body = parseJson(ctx.body);
      const fields: Fields = {};
      const base = body.baseRevision;
      if (!isWholeNumber(base) || base < 1 || base > project.revision) fields.baseRevision = FIELD.baseRevision;
      if (typeof body.text !== "string") fields.text = FIELD.text;
      if (Object.keys(fields).length) throw fail.invalid(fields);
      const text = body.text as string;
      const baseRevision = base as number;
      const unchanged = (merged: boolean) => ({ reply: { revision: project.revision, text: project.text, merged }, committed: null, user });
      if (text === project.text) return unchanged(false);
      let next = text;
      const merged = baseRevision !== project.revision;
      if (merged) {
        const baseRows = await db.query<{ text: string }>("SELECT text FROM edits WHERE project_id = $1 AND revision = $2", [
          project.id,
          baseRevision,
        ]);
        const result = mergeUnits(baseRows.rows[0]!.text, text, project.text);
        if (!result.ok) {
          const by = await conflictAuthor(db, project.id, baseRevision, result.unit);
          throw fail.editConflict(result.unit, by, project.revision, project.text);
        }
        next = result.text;
      }
      if (utf8Length(text) > config.textLimitBytes || utf8Length(next) > config.textLimitBytes)
        throw fail.textTooLarge(config.textLimitBytes);
      if (next === project.text) return unchanged(merged);
      const committed = await commitText(db, project, next, user);
      return { reply: { revision: committed.revision, text: committed.text, merged }, committed, user };
    });
    announce(ctx.params.id!, outcome);
    return json(200, outcome.reply);
  });

  router.add("PATCH", "/api/projects/:id/layout", async (ctx) => {
    const outcome = await withProject(ctx, "write", async (db, project, user) => {
      const body = parseJson(ctx.body);
      const fields: Fields = {};
      const next: Layout = structuredClone(project.layout);
      const entities = body.entities ?? {};
      const groups = body.groups ?? {};
      if (typeof entities !== "object" || entities === null || Array.isArray(entities)) fields.entities = FIELD.pickEntity;
      else {
        for (const [name, raw] of Object.entries(entities as Record<string, unknown>)) {
          const target = next.entities[name];
          if (!target || typeof raw !== "object" || raw === null) {
            fields[`entities.${name}`] = FIELD.noEntity(name);
            continue;
          }
          const change = raw as Record<string, unknown>;
          if (change.x !== undefined) {
            if (isGridPosition(change.x)) target.x = change.x;
            else fields[`entities.${name}.x`] = FIELD.position;
          }
          if (change.y !== undefined) {
            if (isGridPosition(change.y)) target.y = change.y;
            else fields[`entities.${name}.y`] = FIELD.position;
          }
          if (change.color !== undefined) {
            if (isColour(change.color)) target.color = change.color;
            else fields[`entities.${name}.color`] = FIELD.colour;
          }
        }
      }
      if (typeof groups !== "object" || groups === null || Array.isArray(groups)) fields.groups = FIELD.colour;
      else {
        for (const [name, raw] of Object.entries(groups as Record<string, unknown>)) {
          const target = next.groups[name];
          if (!target || typeof raw !== "object" || raw === null) {
            fields[`groups.${name}`] = FIELD.noGroup(name);
            continue;
          }
          const color = (raw as Record<string, unknown>).color;
          if (isColour(color)) target.color = color;
          else fields[`groups.${name}.color`] = FIELD.colour;
        }
      }
      if (Object.keys(fields).length) throw fail.invalid(fields);
      await saveLayout(db, project, next);
      return { layout: next, user };
    });
    live.layout(ctx.params.id!, outcome.layout, outcome.user);
    return json(200, { layout: outcome.layout });
  });

  router.add("POST", "/api/projects/:id/layout/arrange", async (ctx) => {
    const outcome = await withProject(ctx, "write", async (db, project, user) => {
      const next = arrangeLayout(project.layout, parseText(project.last_valid_text).model);
      await saveLayout(db, project, next);
      return { layout: next, user };
    });
    live.layout(ctx.params.id!, outcome.layout, outcome.user);
    return json(200, { layout: outcome.layout });
  });

  router.add("POST", "/api/projects/:id/links", async (ctx) => {
    const outcome = await withProject(ctx, "write", async (db, project, user): Promise<Outcome<unknown>> => {
      const body = parseJson(ctx.body);
      requireLatestValid(project, baseRevisionOf(body.baseRevision, project));
      const planned = planLink(project.text, parseText(project.text), body.from, body.to, parseLimits);
      if (!planned.ok) throw fail.refused(planned.refusal);
      const insertion = planned.value;
      const committed = await commitText(db, project, insertion.text, user);
      return {
        reply: { revision: committed.revision, text: committed.text, line: insertion.line, lineNumber: insertion.lineNumber },
        committed,
        user,
      };
    });
    announce(ctx.params.id!, outcome);
    return json(200, outcome.reply);
  });

  router.add("POST", "/api/projects/:id/groups", async (ctx) => {
    const outcome = await withProject(ctx, "write", async (db, project, user): Promise<Outcome<unknown>> => {
      const body = parseJson(ctx.body);
      requireLatestValid(project, baseRevisionOf(body.baseRevision, project));
      const planned = planGroup(project.text, parseText(project.text), project.layout, body.name, body.entities, body.color);
      if (!planned.ok) throw fail.refused(planned.refusal);
      const { text, layout } = planned.value;
      const committed = await commitText(db, project, text, user, layout);
      return { reply: { revision: committed.revision, text: committed.text, layout: committed.layout }, committed, user };
    });
    announce(ctx.params.id!, outcome, true);
    return json(200, outcome.reply);
  });

  router.add("DELETE", "/api/projects/:id/groups/:group", async (ctx) => {
    const outcome = await withProject(ctx, "write", async (db, project, user): Promise<Outcome<unknown>> => {
      const text = planUngroup(project.text, parseText(project.text), ctx.params.group!);
      if (text === null) throw fail.notFound();
      requireLatestValid(project, baseRevisionOf(ctx.url.searchParams.get("baseRevision"), project));
      const committed = await commitText(db, project, text, user);
      return { reply: { revision: committed.revision, text: committed.text, layout: committed.layout }, committed, user };
    });
    announce(ctx.params.id!, outcome);
    return json(200, outcome.reply);
  });

  router.add("POST", "/api/projects/:id/entities/rename", async (ctx) => {
    const outcome = await withProject(ctx, "write", async (db, project, user): Promise<Outcome<unknown>> => {
      const body = parseJson(ctx.body);
      requireLatestValid(project, baseRevisionOf(body.baseRevision, project));
      const planned = planRename(project.text, parseText(project.text), project.layout, body.from, body.to);
      if (!planned.ok) throw fail.refused(planned.refusal);
      const committed = await commitText(db, project, planned.value.text, user, planned.value.layout);
      return { reply: { revision: committed.revision, text: committed.text, layout: committed.layout }, committed, user };
    });
    announce(ctx.params.id!, outcome, true);
    return json(200, outcome.reply);
  });

  router.add("GET", "/api/projects/:id/ddl", async (ctx) => {
    const user = await requireUser(ctx);
    const { project } = await transaction((db) => projectAccess(db, ctx.params.id!, user));
    if (project.error_count > 0) throw fail.schemaHasErrors();
    const dialect = ctx.url.searchParams.get("dialect");
    if (!isDialect(dialect)) throw fail.invalid({ dialect: FIELD.dialect });
    return {
      status: 200,
      raw: exportDdl(parseText(project.text).model, dialect),
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    };
  });
}
