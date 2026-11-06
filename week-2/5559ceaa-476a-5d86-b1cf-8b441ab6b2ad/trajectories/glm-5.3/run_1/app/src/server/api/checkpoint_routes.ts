import { Router, type RouteCtx, json } from "./router.js";
import { ApiError } from "../errors.js";
import { z } from "./zod_mini.js";
import { requireProjectView } from "./helpers.js";
import type { Services } from "../services.js";

export function registerCheckpointRoutes(router: Router, svc: Services): void {
  router.add("POST", "/api/projects/<project_id>/checkpoints", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    await requireProjectView(svc.pool, projectId, user);
    const body = z.object({ name: z.string({ min: 1 }) }).parse(ctx.body);
    const out = await svc.checkpoints.saveCheckpoint(projectId, user, body.name ?? "");
    return json(out.status, { checkpoint: out.checkpoint });
  });

  router.add("GET", "/api/projects/<project_id>/checkpoints", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    await requireProjectView(svc.pool, projectId, user);
    const r = await svc.pool.query(
      `SELECT c.id, c.project_id, c.name, c.state, c.created_by, c.created_at, c.file_count, u.name AS author_name
       FROM checkpoints c JOIN users u ON u.id = c.created_by
       WHERE c.project_id = $1 ORDER BY c.created_at DESC, c.id DESC`,
      [projectId],
    );
    return json(200, {
      checkpoints: r.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        project_id: row.project_id,
        name: row.name,
        state: row.state,
        created_by: { id: row.created_by, name: row.author_name },
        created_at: (row.created_at as Date).toISOString(),
        file_count: row.file_count,
      })),
    });
  });

  router.add("GET", "/api/checkpoints/<checkpoint_id>", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const checkpointId = ctx.params["checkpoint_id"] as string;
    const cp = await svc.checkpointsByAccess(checkpointId, user);
    const files = await svc.pool.query(
      `SELECT cf.file_id, cf.path, cf.sha256, cf.size, f.path AS current_path
       FROM checkpoint_files cf LEFT JOIN files f ON f.id = cf.file_id
       WHERE cf.checkpoint_id = $1 ORDER BY cf.path`,
      [checkpointId],
    );
    return json(200, {
      checkpoint: {
        ...cp,
        files: files.rows.map((row: Record<string, unknown>) => ({
          file_id: row.file_id,
          path: row.path,
          current_path: row.current_path,
          sha256: row.sha256,
          size: row.size,
        })),
      },
    });
  });

  router.add("GET", "/api/checkpoints/<checkpoint_id>/files/<file_id>", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const checkpointId = ctx.params["checkpoint_id"] as string;
    const fileId = ctx.params["file_id"] as string;
    await svc.checkpointsByAccess(checkpointId, user);
    const state = await svc.checkpointState(checkpointId);
    if (state !== "saved") throw new ApiError("checkpoint_not_saved", "This checkpoint hasn't finished uploading yet.", { state });
    const row = await svc.pool.query(
      `SELECT cf.file_id, cf.path, cf.sha256, cp.project_id
       FROM checkpoint_files cf JOIN checkpoints cp ON cp.id = cf.checkpoint_id
       WHERE cf.checkpoint_id = $1 AND cf.file_id = $2`,
      [checkpointId, fileId],
    );
    if (row.rowCount === 0) throw new ApiError("not_found", "No such checkpoint file.");
    const f = row.rows[0] as unknown as { file_id: string; path: string; sha256: string; project_id: string };
    let bytes: Buffer;
    try {
      bytes = await svc.readCheckpointBlob(f.project_id, f.sha256);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("storage_unavailable", "Storage is unreachable.");
    }
    if (sha256Hex(bytes) !== f.sha256) {
      throw new ApiError("checkpoint_damaged", "This checkpoint's stored files don't match its record.", { paths: [f.path] });
    }
    return json(200, { file: { file_id: f.file_id, path: f.path, content: bytes.toString("utf8"), sha256: f.sha256 } });
  });

  router.add("POST", "/api/checkpoints/<checkpoint_id>/restore", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const checkpointId = ctx.params["checkpoint_id"] as string;
    const projectId = await svc.checkpointProject(checkpointId, user);
    const result = await svc.checkpoints.restore(projectId, checkpointId, user);
    return json(200, { restore: { id: result.restoreId, checkpoint_id: checkpointId, state: "applied" }, files: result.files });
  });

  router.add("POST", "/api/restores/<restore_id>/undo", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const restoreId = ctx.params["restore_id"] as string;
    const projectId = await svc.restoreProject(restoreId, user);
    const result = await svc.checkpoints.undoRestore(projectId, restoreId, user);
    return json(200, { restore: { id: restoreId, checkpoint_id: null, state: "undone" }, files: result.files });
  });
}

import { createHash } from "node:crypto";
function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
