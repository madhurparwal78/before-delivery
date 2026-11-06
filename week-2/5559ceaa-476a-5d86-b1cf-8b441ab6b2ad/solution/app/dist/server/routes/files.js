import { many, one, pool } from "../db.js";
import { ApiError } from "../errors.js";
import { createFile, deleteFile, renameFile, renameFolder, saveFile } from "../files.js";
import { noContent, ok, route } from "../http.js";
import { planImport, applyImport } from "../imports.js";
import { FILE_COLUMNS, projectRole } from "../views.js";
route("GET", "/api/projects/:project_id/files", async (ctx) => {
    const projectId = ctx.params.project_id;
    await projectRole(pool, projectId, ctx.user.id);
    const files = await many(pool, `SELECT ${FILE_COLUMNS} FROM files WHERE project_id = $1 AND deleted_at IS NULL ORDER BY path COLLATE "C"`, [projectId]);
    return ok({ files });
});
route("GET", "/api/projects/:project_id/files/:file_id", async (ctx) => {
    const projectId = ctx.params.project_id;
    await projectRole(pool, projectId, ctx.user.id);
    const file = await one(pool, `SELECT ${FILE_COLUMNS}, content FROM files WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`, [ctx.params.file_id, projectId]);
    if (!file)
        throw new ApiError("not_found");
    return ok({ file: { ...file, content: file.content.toString("utf8") } });
});
route("POST", "/api/projects/:project_id/files", async (ctx) => ok({ file: await createFile(ctx.params.project_id, ctx.user.id, ctx.json()) }, 201));
route("PUT", "/api/projects/:project_id/files/:file_id", async (ctx) => {
    const body = ctx.json();
    return ok({ file: await saveFile(ctx.params.project_id, ctx.params.file_id, ctx.user.id, body.content, body.base_revision) });
});
route("PATCH", "/api/projects/:project_id/files/:file_id", async (ctx) => ok({ file: await renameFile(ctx.params.project_id, ctx.params.file_id, ctx.user.id, ctx.json()) }));
route("POST", "/api/projects/:project_id/folders/rename", async (ctx) => ok({ files: await renameFolder(ctx.params.project_id, ctx.user.id, ctx.json()) }));
route("DELETE", "/api/projects/:project_id/files/:file_id", async (ctx) => {
    await deleteFile(ctx.params.project_id, ctx.params.file_id, ctx.user.id);
    return noContent();
});
route("POST", "/api/projects/:project_id/imports", async (ctx) => ok(await planImport(ctx.params.project_id, ctx.user.id, ctx.raw), 201), {
    body: "zip",
});
route("POST", "/api/imports/:import_id/apply", async (ctx) => ok(await applyImport(ctx.params.import_id, ctx.user.id, ctx.json())));
