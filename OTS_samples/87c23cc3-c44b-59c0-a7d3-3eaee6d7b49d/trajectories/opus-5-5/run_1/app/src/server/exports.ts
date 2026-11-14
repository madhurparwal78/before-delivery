import { randomUUID } from "node:crypto";
import { exportDdl, exportFileName, isDialect, type Dialect } from "../shared/ddl-export.js";
import { isUuid, requireUser } from "./auth.js";
import { config } from "./config.js";
import { query, transaction } from "./db.js";
import { FIELD, fail } from "./errors.js";
import { deny } from "./guard.js";
import { json, parseJson, type Router } from "./http.js";
import { parseText, projectAccess } from "./project-store.js";
import { getObject, putVerified } from "./storage.js";

type StoredExportStatus = "requested" | "stored" | "failed";

interface ExportRow {
  id: string;
  project_id: string;
  dialect: Dialect;
  status: StoredExportStatus;
  object_key: string;
  bytes: number;
  sha256: string;
  file_name: string;
  revision: number;
  download_expires_at: Date | null;
  created_at: Date;
}

function exportStatus(row: ExportRow, now: Date): StoredExportStatus | "expired" {
  if (row.status === "stored" && row.download_expires_at && now.getTime() >= row.download_expires_at.getTime()) return "expired";
  return row.status;
}

function exportJson(row: ExportRow) {
  return {
    id: row.id,
    dialect: row.dialect,
    status: exportStatus(row, new Date()),
    key: row.object_key,
    bytes: row.bytes,
    sha256: row.sha256,
    fileName: row.file_name,
    revision: row.revision,
    downloadUrl: `/api/projects/${row.project_id}/exports/${row.id}/download`,
    downloadExpiresAt: row.download_expires_at ? row.download_expires_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function countExports(): Promise<number> {
  const rows = await query<{ n: string }>("SELECT count(*) AS n FROM exports WHERE status = 'stored'");
  return Number(rows[0]!.n);
}

export function registerExportRoutes(router: Router): void {
  router.add("POST", "/api/projects/:id/exports", async (ctx) => {
    const user = await requireUser(ctx);
    const row = await transaction(async (db) => {
      const { project, role } = await projectAccess(db, ctx.params.id!, user);
      deny(role, "write");
      const body = parseJson(ctx.body);
      if (project.error_count > 0) throw fail.schemaHasErrors();
      if (!isDialect(body.dialect)) throw fail.invalid({ dialect: FIELD.dialect });
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`exports:${user.id}`]);
      const now = new Date();
      const recent = await db.query<{ created_at: Date }>(
        "SELECT created_at FROM exports WHERE user_id = $1 AND created_at > $2 ORDER BY created_at ASC",
        [user.id, new Date(now.getTime() - 60000)],
      );
      if (recent.rows.length >= config.exportRateLimit) {
        const oldest = recent.rows[recent.rows.length - config.exportRateLimit]!.created_at.getTime();
        throw fail.rateLimited(Math.max(1, Math.ceil((oldest + 60000 - now.getTime()) / 1000)));
      }
      const id = randomUUID();
      const dialect = body.dialect;
      const record: ExportRow = {
        id,
        project_id: project.id,
        dialect,
        status: "requested",
        object_key: `exports/${project.id}/${id}-${dialect}.sql`,
        bytes: 0,
        sha256: "",
        file_name: exportFileName(project.name, dialect),
        revision: project.revision,
        download_expires_at: null,
        created_at: now,
      };
      await db.query(
        `INSERT INTO exports (id, project_id, user_id, dialect, status, object_key, bytes, sha256, file_name, revision, download_expires_at, created_at)
         VALUES ($1, $2, $3, $4, 'requested', $5, 0, '', $6, $7, NULL, $8)`,
        [id, project.id, user.id, dialect, record.object_key, record.file_name, record.revision, now],
      );
      return { record, ddl: exportDdl(parseText(project.text).model, dialect) };
    });
    const record = row.record;
    try {
      const stored = await putVerified(record.object_key, Buffer.from(row.ddl, "utf8"));
      const expiresAt = new Date(Date.now() + config.exportLinkTtlSeconds * 1000);
      await query("UPDATE exports SET status = 'stored', bytes = $2, sha256 = $3, download_expires_at = $4 WHERE id = $1", [
        record.id,
        stored.bytes,
        stored.sha256,
        expiresAt,
      ]);
      Object.assign(record, { status: "stored", bytes: stored.bytes, sha256: stored.sha256, download_expires_at: expiresAt });
    } catch (error) {
      await query("UPDATE exports SET status = 'failed' WHERE id = $1", [record.id]);
      throw error;
    }
    return json(201, exportJson(record));
  });

  router.add("GET", "/api/projects/:id/exports", async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await transaction(async (db) => {
      const { project } = await projectAccess(db, ctx.params.id!, user);
      return (await db.query<ExportRow>("SELECT * FROM exports WHERE project_id = $1 ORDER BY created_at DESC", [project.id])).rows;
    });
    return json(200, { exports: rows.map(exportJson) });
  });

  router.add("GET", "/api/projects/:id/exports/:exportId/download", async (ctx) => {
    const user = await requireUser(ctx);
    const row = await transaction(async (db) => {
      const { project } = await projectAccess(db, ctx.params.id!, user);
      if (!isUuid(ctx.params.exportId!)) throw fail.notFound();
      const rows = await db.query<ExportRow>("SELECT * FROM exports WHERE id = $1 AND project_id = $2", [ctx.params.exportId, project.id]);
      const found = rows.rows[0];
      if (!found || found.status !== "stored") throw fail.notFound();
      return found;
    });
    if (exportStatus(row, new Date()) === "expired") throw fail.exportExpired();
    const bytes = await getObject(row.object_key);
    return {
      status: 200,
      raw: bytes,
      headers: {
        "Content-Type": "application/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="${row.file_name}"`,
      },
    };
  });
}
