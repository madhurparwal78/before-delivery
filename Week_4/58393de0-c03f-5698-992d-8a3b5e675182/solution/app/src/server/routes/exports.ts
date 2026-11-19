import { randomUUID } from "node:crypto";
import { copy } from "../../shared/copy";
import { EXPORT_BODY_LIMIT } from "../../shared/limits";
import { isExportFileName } from "../../shared/rules";
import type { ExportFormat, ExportUnit } from "../../shared/types";
import { requirePrincipal } from "../auth";
import { serverNow } from "../clock";
import { first, pool, rows } from "../db";
import { ApiError, assertNoFieldErrors, validationError } from "../errors";
import { exportKey, exportView, EXPORT_COLUMNS, type ExportRow } from "../exports-store";
import type { Route } from "../http-types";
import { isEducatorOf } from "../classrooms-store";
import { inspectExport } from "../mesh";
import { openProject, projectNotFound } from "../projects-store";
import { getObject, putObject, whenStorageUp } from "../s3";

const FORMATS: readonly ExportFormat[] = ["stl", "obj", "svg"];
const UNITS: readonly ExportUnit[] = ["mm", "in"];
const CONTENT_TYPES: Record<ExportFormat, string> = { stl: "model/stl", obj: "model/obj", svg: "image/svg+xml" };

const upload: Route = {
  method: "POST",
  pattern: "/api/exports",
  bodyLimit: EXPORT_BODY_LIMIT,
  async handler(req) {
    const { account } = await requirePrincipal(req);
    const projectId = req.query.get("projectId");
    const project = projectId ? await openProject(account, projectId) : null;
    if (project && project.ownerId !== account.id) throw new ApiError("forbidden");
    if (!account.emailVerified) throw new ApiError("email_unverified", { message: copy.unverifiedExport });

    const format = FORMATS.find((candidate) => candidate === req.query.get("format"));
    const unit = UNITS.find((candidate) => candidate === req.query.get("unit"));
    const name = req.query.get("name") ?? "";
    const fields: Record<string, string> = {};
    if (!format) fields.format = copy.validation;
    if (!unit) fields.unit = copy.validation;
    if (format && !isExportFileName(name, format)) fields.name = copy.validation;
    if (project?.kind === "circuit") {
      if (format !== "svg") fields.format = copy.validation;
      if (unit !== "mm") fields.unit = copy.validation;
    }
    assertNoFieldErrors(fields);
    if (!format || !unit) throw validationError(fields);
    const facts = inspectExport(format, unit, req.body);

    const id = randomUUID();
    const key = exportKey(account.id, id, name);
    await whenStorageUp(copy.exportStorage, () => putObject(key, req.body, CONTENT_TYPES[format]));
    const row: ExportRow = {
      id, ownerId: account.id, projectId: project?.id ?? null, fileName: name, format, unit,
      bytes: req.body.length, triangleCount: facts.triangleCount, bbox: project?.kind === "circuit" ? null : facts.bbox, objectKey: key,
      createdAt: serverNow(),
    };
    await pool.query(
      `INSERT INTO exports (id, owner_id, project_id, file_name, format, unit, bytes, triangle_count, bbox, object_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [row.id, row.ownerId, row.projectId, row.fileName, row.format, row.unit, row.bytes, row.triangleCount,
        row.bbox && JSON.stringify(row.bbox), row.objectKey, row.createdAt]);
    return { status: 201, body: exportView(row) };
  },
};

const list: Route = {
  method: "GET",
  pattern: "/api/exports",
  async handler(req) {
    const { account } = await requirePrincipal(req);
    const found = await rows<ExportRow>(pool,
      `SELECT ${EXPORT_COLUMNS} FROM exports e WHERE e.owner_id = $1 ORDER BY e.created_at DESC, e.id`, [account.id]);
    return { status: 200, body: { exports: found.map(exportView) } };
  },
};

const download: Route = {
  method: "GET",
  pattern: "/api/exports/:id/download",
  async handler(req) {
    const { account } = await requirePrincipal(req);
    const found = await first<ExportRow>(pool,
      `SELECT ${EXPORT_COLUMNS} FROM exports e JOIN accounts o ON o.id = e.owner_id
       WHERE e.id = $1 AND (e.owner_id = $2 OR (o.classroom_id IS NOT NULL AND ${isEducatorOf("o.classroom_id", "$2")}))`,
      [req.param("id"), account.id]);
    if (!found) throw projectNotFound();
    const bytes = await whenStorageUp(copy.openStorage, () => getObject(found.objectKey));
    return {
      status: 200, bytes,
      headers: {
        "Content-Type": CONTENT_TYPES[found.format],
        "Content-Disposition": `attachment; filename="${found.fileName}"`,
      },
    };
  },
};

export const exportRoutes: Route[] = [upload, list, download];
