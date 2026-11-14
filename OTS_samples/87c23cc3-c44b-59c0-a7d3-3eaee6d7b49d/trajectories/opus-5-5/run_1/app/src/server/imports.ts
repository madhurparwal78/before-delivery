import { randomUUID } from "node:crypto";
import { isDialect, type Dialect } from "../shared/ddl-export.js";
import { isUuid, requireUser } from "./auth.js";
import { config, parseLimits } from "./config.js";
import { transaction } from "./db.js";
import { importDdl, type ImportMode } from "./ddl-import.js";
import { FIELD, fail, type Fields } from "./errors.js";
import { baseRevisionOf, deny } from "./guard.js";
import { json, type Router } from "./http.js";
import { live } from "./live.js";
import { commitText, parseText, projectAccess, type Committed } from "./project-store.js";
import { getObject, putVerified } from "./storage.js";

interface ImportRow {
  id: string;
  project_id: string;
  dialect: Dialect;
  mode: ImportMode;
  object_key: string;
  bytes: number;
  sha256: string;
  created_at: Date;
}

function isMode(value: unknown): value is ImportMode {
  return value === "merge" || value === "replace";
}

export function registerImportRoutes(router: Router): void {
  router.add("POST", "/api/projects/:id/imports", async (ctx) => {
    const user = await requireUser(ctx);
    const params = ctx.url.searchParams;
    const dialect = params.get("dialect");
    const mode = params.get("mode");
    const id = randomUUID();

    // Every check runs against the project as it stands, before anything is stored.
    const planned = await transaction(async (db) => {
      const { project, role } = await projectAccess(db, ctx.params.id!, user);
      deny(role, "write");
      const base = baseRevisionOf(params.get("baseRevision"), project);
      if (base !== project.revision) throw fail.staleRevision(project.revision, project.text);
      if (mode === "merge" && project.error_count > 0) throw fail.schemaHasErrors();
      const fields: Fields = {};
      if (!isDialect(dialect)) fields.dialect = FIELD.dialect;
      if (!isMode(mode)) fields.mode = FIELD.mode;
      if (Object.keys(fields).length) throw fail.invalid(fields);
      const outcome = importDdl({
        bytes: ctx.body,
        dialect: dialect as Dialect,
        mode: mode as ImportMode,
        currentText: project.text,
        current: parseText(project.text),
        limits: { ...parseLimits, nestingLimit: config.nestingLimit },
      });
      if (!outcome.ok) throw fail.importFailed(outcome.lines);
      if (ctx.body.length > config.textLimitBytes) throw fail.ddlTooLarge(config.textLimitBytes);
      return { outcome, projectId: project.id, base };
    });

    const objectKey = `imports/${planned.projectId}/${id}.sql`;
    const stored = await putVerified(objectKey, ctx.body);
    const outcome = planned.outcome;

    const applied = await transaction(async (db) => {
      const { project } = await projectAccess(db, planned.projectId, user, true);
      if (project.revision !== planned.base) throw fail.staleRevision(project.revision, project.text);
      let committed: Committed | null = null;
      if (outcome.changed) committed = await commitText(db, project, outcome.text, user);
      await db.query(
        `INSERT INTO imports (id, project_id, user_id, dialect, mode, object_key, bytes, sha256, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, project.id, user.id, dialect, mode, objectKey, stored.bytes, stored.sha256, new Date()],
      );
      return { committed, revision: project.revision };
    });
    if (applied.committed) {
      live.revision(planned.projectId, applied.committed.revision, applied.committed.text, user);
      if (applied.committed.layoutChanged) live.layout(planned.projectId, applied.committed.layout, user);
    }
    return json(201, {
      id,
      dialect,
      mode,
      revision: applied.revision,
      changed: outcome.changed,
      originalKey: objectKey,
      bytes: stored.bytes,
      sha256: stored.sha256,
      report: outcome.report,
      notes: outcome.notes,
      counts: outcome.counts,
    });
  });

  router.add("GET", "/api/projects/:id/imports", async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await transaction(async (db) => {
      const { project } = await projectAccess(db, ctx.params.id!, user);
      return (await db.query<ImportRow>("SELECT * FROM imports WHERE project_id = $1 ORDER BY created_at DESC", [project.id])).rows;
    });
    return json(200, {
      imports: rows.map((r) => ({
        id: r.id,
        dialect: r.dialect,
        mode: r.mode,
        bytes: r.bytes,
        sha256: r.sha256,
        createdAt: r.created_at.toISOString(),
      })),
    });
  });

  router.add("GET", "/api/projects/:id/imports/:importId/original", async (ctx) => {
    const user = await requireUser(ctx);
    const row = await transaction(async (db) => {
      const { project } = await projectAccess(db, ctx.params.id!, user);
      if (!isUuid(ctx.params.importId!)) throw fail.notFound();
      const rows = await db.query<ImportRow>("SELECT * FROM imports WHERE id = $1 AND project_id = $2", [ctx.params.importId, project.id]);
      if (!rows.rows[0]) throw fail.notFound();
      return rows.rows[0];
    });
    const bytes = await getObject(row.object_key);
    return { status: 200, raw: bytes, headers: { "Content-Type": "application/sql" } };
  });
}
