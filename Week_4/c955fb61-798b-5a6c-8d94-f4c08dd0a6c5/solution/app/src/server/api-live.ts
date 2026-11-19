import { projectAccess } from "./auth";
import { notFound } from "./errors";
import { route } from "./http";
import { presenceOf } from "./live";
import { createExport, downloadExport, storedExports, type ExportFormat } from "./exports";
import { pool } from "./db";
import * as check from "./validate";

async function accessToProject(personId: string, projectId: string) {
  const access = await projectAccess(personId, projectId);
  if (!access) throw notFound();
  return access;
}

route("GET", "/api/projects/:id/presence", async ({ person, params }) => {
  const access = await accessToProject(person.id, params.id);
  return { status: 200, body: { people: presenceOf(access.projectId) } };
});

route("POST", "/api/projects/:id/exports", async ({ person, params, body }) => {
  const access = await accessToProject(person.id, params.id);
  const format: ExportFormat = check.oneOf(body, "format", ["csv", "pdf"] as const);
  return { status: 201, body: await createExport(access.projectId, format) };
});

route("GET", "/api/projects/:id/exports", async ({ person, params }) => {
  const access = await accessToProject(person.id, params.id);
  return { status: 200, body: { exports: await storedExports(access.projectId) } };
});

route("GET", "/api/exports/:id/download", async ({ person, params }) => {
  const owner = await pool.query("SELECT project_id FROM exports WHERE id = $1", [params.id]);
  if (owner.rowCount === 0) throw notFound();
  const access = await accessToProject(person.id, owner.rows[0].project_id);
  const file = await downloadExport(access.projectId, params.id);
  if (!file) throw notFound();
  return {
    status: 200,
    stream: async (res) => {
      res.writeHead(200, { "content-type": file.contentType, "content-disposition": `attachment; filename="${file.filename}"`, "cache-control": "no-store" });
      res.end(Buffer.from(await file.response.arrayBuffer()));
    },
  };
});
