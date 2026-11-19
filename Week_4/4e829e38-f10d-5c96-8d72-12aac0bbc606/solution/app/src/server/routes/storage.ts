import { randomUUID } from "node:crypto";
import { projectTeam, taskAccess } from "../access.js";
import { config } from "../config.js";
import { now } from "../clock.js";
import { csvText } from "../csv.js";
import { pool, transaction } from "../db.js";
import { publish } from "../events.js";
import { ApiError, fields, invalid, notFound, readJson, readRaw, route, storageUnavailable } from "../http.js";
import { parseMultipart } from "../multipart.js";
import { getObject, putObject, reachable } from "../s3.js";
import { addHistory, listTasks, loadProject } from "../tasks.js";
import { RAW } from "../state.js";

const TOO_LARGE = () => new ApiError(413, { error: "file_too_large" }, { "x-upload-limit-bytes": String(config.limits.uploadMaxBytes) });

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f]/g, "_").trim() || "file";
}

route("POST", "/api/tasks/:id/attachments", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const cap = config.limits.uploadMaxBytes;
  const raw = await readRaw(ctx.req, cap + 65536);
  if (!Buffer.isBuffer(raw)) throw TOO_LARGE();
  const parts = parseMultipart(raw, String(ctx.req.headers["content-type"] ?? ""));
  if (parts.some((p) => p.data.length > cap)) throw TOO_LARGE();
  if (!(await reachable())) throw storageUnavailable();
  const file = parts.find((p) => p.name === "file" && p.filename);
  if (!file) throw invalid({ file: "Choose a file to attach" });
  const id = randomUUID();
  const name = safeName(file.filename!);
  const key = `attachments/${ctx.params.id}/${id}/${name}`;
  await putObject(key, file.data, file.contentType);
  await transaction(async (tx) => {
    const instant = await now(tx);
    await tx.query("INSERT INTO attachments (id, task_id, name, size, content_type, object_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, ctx.params.id, name, file.data.length, file.contentType, key, instant]);
    const who = (await tx.query("SELECT name FROM people WHERE id = $1", [ctx.personId])).rows[0].name;
    await addHistory(tx, ctx.params.id, `${who} changed Attachments`, instant);
    await publish(tx, { t: "tasks", team: access.teamId, project: access.projectId, ids: [ctx.params.id], runs: [] });
  });
  return { id, name, size: file.data.length, contentType: file.contentType };
}, { status: 201 });

route("GET", "/api/attachments/:id", async (ctx) => {
  const { rows } = await pool.query("SELECT task_id, name, content_type, object_key FROM attachments WHERE id = $1", [ctx.params.id]);
  if (!rows.length) throw notFound();
  await taskAccess(pool, ctx.personId, rows[0].task_id);
  const bytes = await getObject(rows[0].object_key);
  ctx.res.writeHead(200, {
    "content-type": rows[0].content_type, "content-length": bytes.length, "x-content-type-options": "nosniff",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].name)}`,
  });
  ctx.res.end(bytes);
  return RAW;
});

/* ------------------------------------------------------------------ project downloads */

async function buildFile(projectId: string, format: "csv" | "json"): Promise<string> {
  const project = await loadProject(pool, projectId);
  const tasks = await listTasks(pool, project);
  const people = await pool.query("SELECT id, email FROM people");
  const emails = new Map<string, string>(people.rows.map((p): [string, string] => [p.id, p.email]));
  const sectionName = new Map(project.sections.map((s) => [s.id, s.name]));
  if (format === "csv") {
    return csvText([
      ["id", "name", "section", "assignee_email", "start", "due", "effort_hours", "completed", "parent_id"],
      ...tasks.map((t) => [t.id, t.name, sectionName.get(t.sectionId), t.assigneeId ? emails.get(t.assigneeId) : "", t.start, t.due, t.effort, String(t.completed), t.parentId]),
    ]);
  }
  return JSON.stringify({
    schema: "everyweek.project/1", project: { id: project.id, name: project.name },
    sections: project.sections.map((s) => ({ id: s.id, name: s.name, position: s.position })),
    tasks: tasks.map((t) => ({
      id: t.id, name: t.name, section: t.sectionId, assignee_email: t.assigneeId ? emails.get(t.assigneeId) ?? null : null,
      start: t.start, due: t.due, effort_hours: t.effort, completed: t.completed, parent_id: t.parentId,
    })),
  });
}

async function runFileJob(id: string, projectId: string, format: "csv" | "json", teamId: string, personId: string): Promise<void> {
  const key = `exports/${projectId}/${id}.${format}`;
  let status = "ready";
  try {
    await putObject(key, Buffer.from(await buildFile(projectId, format), "utf8"), format === "csv" ? "text/csv" : "application/json");
  } catch {
    status = "failed";
  }
  await transaction(async (tx) => {
    await tx.query("UPDATE files SET status = $2, object_key = $3, error = $4 WHERE id = $1",
      [id, status, status === "ready" ? key : null, status === "failed" ? "storage_unavailable" : null]);
    await publish(tx, { t: "file", person: personId, team: teamId, file: id, status });
  });
}

route("POST", "/api/projects/:id/files", async (ctx) => {
  const { teamId } = await projectTeam(pool, ctx.personId, ctx.params.id);
  const body = fields(await readJson(ctx));
  if (body.format !== "csv" && body.format !== "json") throw invalid({ format: "Choose csv or json" });
  const id = randomUUID();
  await pool.query("INSERT INTO files (id, project_id, format, status, requested_by, created_at) VALUES ($1,$2,$3,'preparing',$4,$5)",
    [id, ctx.params.id, body.format, ctx.personId, await now(pool)]);
  void runFileJob(id, ctx.params.id, body.format, teamId, ctx.personId);
  return { id, status: "preparing" };
}, { status: 202 });

async function fileAccess(personId: string, fileId: string) {
  const { rows } = await pool.query("SELECT id, project_id, format, status, object_key, error FROM files WHERE id = $1", [fileId]);
  if (!rows.length) throw notFound();
  await projectTeam(pool, personId, rows[0].project_id);
  return rows[0];
}

route("GET", "/api/files/:id", async (ctx) => {
  const file = await fileAccess(ctx.personId, ctx.params.id);
  return {
    id: file.id, status: file.status, format: file.format,
    ...(file.status === "ready" ? { url: `/api/files/${file.id}/download` } : {}),
    ...(file.error ? { error: file.error } : {}),
  };
});

route("GET", "/api/files/:id/download", async (ctx) => {
  const file = await fileAccess(ctx.personId, ctx.params.id);
  if (file.status !== "ready") throw notFound();
  const bytes = await getObject(file.object_key);
  ctx.res.writeHead(200, {
    "content-type": file.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    "content-length": bytes.length, "x-content-type-options": "nosniff",
    "content-disposition": `attachment; filename="project.${file.format}"`,
  });
  ctx.res.end(bytes);
  return RAW;
});

