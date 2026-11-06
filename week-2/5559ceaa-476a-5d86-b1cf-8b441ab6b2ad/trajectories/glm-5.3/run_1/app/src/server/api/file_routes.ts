import { Router, type RouteCtx, json } from "./router.js";
import { ApiError } from "../errors.js";
import { z } from "./zod_mini.js";
import { requireMentor, requireProjectView, listFiles } from "./helpers.js";
import type { Services } from "../services.js";

export function fileOut(f: { id: string; path: string; revision: number; sha256: string; size: number }): Record<string, unknown> {
  return { id: f.id, path: f.path, revision: f.revision, sha256: f.sha256, size: f.size };
}

export function registerFileRoutes(router: Router, svc: Services): void {
  router.add("GET", "/api/projects/<project_id>/files", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    await requireProjectView(svc.pool, projectId, user);
    const client = await svc.pool.connect();
    try {
      const files = await listFiles(client, projectId);
      return json(200, { files: files.map(fileOut) });
    } finally {
      client.release();
    }
  });

  router.add("GET", "/api/projects/<project_id>/files/<file_id>", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    const file_id = ctx.params["file_id"] as string;
    await requireProjectView(svc.pool, projectId, user);
    const r = await svc.pool.query(
      `SELECT id, path, revision, sha256, size, content FROM files WHERE project_id = $1 AND id = $2`,
      [projectId, file_id],
    );
    const row = r.rows[0];
    if (!row) throw new ApiError("not_found", "No such file.");
    return json(200, {
      file: {
        id: row["id"],
        path: row["path"],
        revision: row["revision"],
        sha256: row["sha256"],
        size: row["size"],
        content: row["content"],
      },
    });
  });

  router.add("POST", "/api/projects/<project_id>/files", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    await requireProjectView(svc.pool, projectId, user);
    const body = z.object({ path: z.string({ min: 1 }), content: z.string() }).parse(ctx.body);
    const result = await svc.files.createFile(projectId, user, body.path ?? "", body.content ?? "");
    return json(201, { file: result.file });
  });

  router.add("PUT", "/api/projects/<project_id>/files/<file_id>", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    const file_id = ctx.params["file_id"] as string;
    await requireProjectView(svc.pool, projectId, user);
    const body = z.object({
      content: z.string(),
      base_revision: z.number({ int: true, min: 1 }),
    }).parse(ctx.body);
    const result = await svc.files.saveFile(projectId, user, file_id, body.content ?? "", body.base_revision ?? 0);
    return json(200, { file: result.file });
  });

  router.add("PATCH", "/api/projects/<project_id>/files/<file_id>", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    const file_id = ctx.params["file_id"] as string;
    await requireMentor(svc.pool, projectId, user);
    const body = z.object({ path: z.string({ min: 1 }) }).parse(ctx.body);
    const r = await svc.files.renameFile(projectId, user, file_id, body.path ?? "");
    return json(200, { file: r.file });
  });

  router.add("POST", "/api/projects/<project_id>/folders/rename", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    await requireMentor(svc.pool, projectId, user);
    const body = z.object({ from: z.string({ min: 1 }), to: z.string({ min: 1 }) }).parse(ctx.body);
    const r = await svc.files.renameFolder(projectId, user, body.from ?? "", body.to ?? "");
    return json(200, { files: r.files });
  });

  router.add("DELETE", "/api/projects/<project_id>/files/<file_id>", async (ctx: RouteCtx) => {
    const user = ctx.user;
    if (!user) throw new ApiError("unauthenticated", "You need to sign in.");
    const projectId = ctx.params["project_id"] as string;
    const file_id = ctx.params["file_id"] as string;
    await requireProjectView(svc.pool, projectId, user);
    await svc.files.deleteFile(projectId, user, file_id);
    return json(204);
  });
}
