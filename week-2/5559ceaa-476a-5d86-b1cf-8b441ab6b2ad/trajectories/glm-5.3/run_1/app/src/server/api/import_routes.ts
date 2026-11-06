import { Router, type RouteCtx, json, ZIP_LIMIT } from "./router.js";
import { ApiError } from "../errors.js";
import { scanZip } from "../zip.js";
import { requireMentor } from "./helpers.js";
import type { Services } from "../services.js";

export function registerImportRoutes(router: Router, svc: Services): void {
  router.add("POST", "/api/projects/<project_id>/imports", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    await requireMentor(svc.pool, projectId, user);
    if (ctx.raw.length > ZIP_LIMIT) {
      throw new ApiError("too_large", "The zip is over the upload limit.", { limit_bytes: ZIP_LIMIT });
    }
    const ct = contentType(ctx.req.headers["content-type"]);
    if (ct !== "application/zip") {
      throw new ApiError("unsupported_media_type", "Send the zip as application/zip.");
    }
    const scan = await scanZip(ctx.raw);
    if (scan.rejected.length > 0) {
      throw new ApiError("import_rejected", "The zip was rejected.", {
        entries: scan.rejected.map((r) => ({
          path: r.path,
          reason: r.reason,
          ...(r.limit !== undefined ? { limit: r.limit } : {}),
        })),
      });
    }
    const plan = await svc.imports.planImport(projectId, user, ctx.raw, scan.entries, scan.ignored);
    return json(201, { import: plan });
  });

  router.add("POST", "/api/imports/<import_id>/apply", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const importId = ctx.params["import_id"] as string;
    const body = (ctx.body ?? {}) as { decisions?: Record<string, unknown> };
    const planRow = await svc.pool.query(
      `SELECT id, project_id, state FROM import_plans WHERE id = $1`,
      [importId],
    );
    if (planRow.rowCount === 0) throw new ApiError("not_found", "No such import.");
    const projectId = planRow.rows[0]["project_id"] as string;
    await requireMentor(svc.pool, projectId, user);
    const decisions = (body.decisions ?? {}) as Record<string, unknown>;
    const result = await svc.imports.applyImport(projectId, importId, user, decisions);
    return json(200, result);
  });
}

function contentType(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return (s ?? "").split(";")[0]?.trim() ?? "";
}
