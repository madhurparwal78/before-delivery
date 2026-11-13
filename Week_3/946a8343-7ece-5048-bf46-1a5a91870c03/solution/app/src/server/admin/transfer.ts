// Project export and import (DP-46): five steps of SPUR_EXPORT_STEP_MS on the server clock, live progress and storage-backed files.
import { config } from "../config.ts";
import { now } from "../clock.ts";
import { db, withTx, type Queryable, type Tx } from "../db.ts";
import { onDue } from "../deadlines.ts";
import { groupScope, isVisibility, projectScope, requireAction, type ProjectRow } from "../access.ts";
import { FieldErrors, notFound, payloadTooLarge, storageUnavailable, validation, validationOne, wrongState } from "../errors.ts";
import { intParam, json, type Ctx, type Reply, type Router } from "../http.ts";
import { storage, StorageUnavailable } from "../s3.ts";
import { parsePack, previewSentence, serializePack, type PackModel } from "../lib/spurpack.ts";
import { buildPack } from "./pack-build.ts";
import { applyPack } from "./pack-apply.ts";
import { createProjectRow, protectDefaultBranch } from "./projects.ts";
import { FLAG_SETTINGS, isMergeMethod, type ProjectSettings } from "../../shared/settings.ts";
import { exceedsVisibility, isSegment, SEGMENT_MESSAGE } from "./rules.ts";

const STEPS = 5;
const EXPORT_FAILED = "Export failed: file storage is unavailable.";
const IMPORT_FAILED_STORAGE = "Import failed: file storage is unavailable.";
const IMPORT_FAILED = "Import failed.";

interface ExportRow {
  readonly id: number;
  readonly project_id: number;
  readonly status: "running" | "finished" | "failed";
  readonly progress: number;
  readonly error: string | null;
  readonly object_key: string | null;
  readonly next_step_at: number | null;
}

interface ImportRow {
  readonly id: number;
  readonly group_id: number;
  readonly user_id: number;
  readonly slug: string;
  readonly pack: string;
  readonly commits: number;
  readonly issues: number;
  readonly requests: number;
  readonly status: "preview" | "running" | "finished" | "failed";
  readonly progress: number;
  readonly error: string | null;
  readonly project_id: number | null;
  readonly next_step_at: number | null;
}

const exportKey = (row: Pick<ExportRow, "id" | "project_id">): string => `exports/${row.project_id}/${row.id}.spurpack`;

const progressOf = (step: number): number => (step * 100) / STEPS;

async function existingUsers(q: Queryable, text: string): Promise<ReadonlySet<string>> {
  const names = [...text.matchAll(/^user\t([^\t\n]*)/gmu)].map((match) => match[1] ?? "");
  const rows = await q.q<{ username: string }>("SELECT username FROM users WHERE username = ANY($1)", [names]);
  return new Set(rows.map((row) => row.username));
}

// ---- Export ----

async function emitExport(tx: Tx, row: ExportRow, say?: string): Promise<number> {
  return tx.emit(
    row.project_id,
    "export",
    { id: row.id, status: row.status, progress: row.progress },
    say === undefined ? {} : { say: [{ text: say, pages: ["export"] }] },
  );
}

async function stepExport(tx: Tx, exportId: number): Promise<boolean> {
  const row = await tx.maybe<ExportRow>("SELECT * FROM project_exports WHERE id = $1", [exportId]);
  if (row === undefined || row.status !== "running" || row.next_step_at === null || row.next_step_at > now()) return false;
  const step = Math.round((row.progress / 100) * STEPS) + 1;
  const nextAt = row.next_step_at + config.exportStepMs;
  if (step < STEPS) {
    const moved = await tx.one<ExportRow>("UPDATE project_exports SET progress = $2, next_step_at = $3 WHERE id = $1 RETURNING *", [
      row.id, progressOf(step), nextAt,
    ]);
    await emitExport(tx, moved);
    return true;
  }
  const project = await tx.one<ProjectRow>("SELECT * FROM projects WHERE id = $1", [row.project_id]);
  try {
    const file = serializePack(await buildPack(tx, project));
    await storage.put(exportKey(row), file, "text/plain; charset=utf-8");
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    const failed = await tx.one<ExportRow>(
      "UPDATE project_exports SET status = 'failed', error = $2, next_step_at = NULL WHERE id = $1 RETURNING *",
      [row.id, EXPORT_FAILED],
    );
    await emitExport(tx, failed, EXPORT_FAILED);
    return false;
  }
  const finished = await tx.one<ExportRow>(
    "UPDATE project_exports SET status = 'finished', progress = 100, object_key = $2, next_step_at = NULL WHERE id = $1 RETURNING *",
    [row.id, exportKey(row)],
  );
  await emitExport(tx, finished, "Export ready.");
  return false;
}

async function runExports(): Promise<void> {
  for (;;) {
    const due = await db.maybe<{ id: number; project_id: number }>(
      "SELECT id, project_id FROM project_exports WHERE status = 'running' AND next_step_at <= $1 ORDER BY id LIMIT 1",
      [now()],
    );
    if (due === undefined) return;
    await withTx(async (tx) => {
      await tx.lockProject(due.project_id);
      while (await stepExport(tx, due.id)) continue;
    });
  }
}

const exportView = (row: ExportRow): Record<string, unknown> => ({
  id: row.id,
  status: row.status,
  progress: row.progress,
  error: row.error,
  download: row.status === "finished" ? `/api/exports/${row.id}/file` : null,
});

async function exportScope(tx: Queryable, ctx: Ctx): Promise<{ row: ExportRow; project: ProjectRow }> {
  const row = await tx.maybe<ExportRow>("SELECT * FROM project_exports WHERE id = $1", [intParam(ctx, "id")]);
  if (row === undefined) throw notFound();
  const { project, access } = await projectScope(tx, ctx.user, row.project_id);
  requireAction(access, "transfer");
  return { row, project };
}

// ---- Import ----

async function emitImport(tx: Tx, projectId: number, row: ImportRow, say?: string): Promise<number> {
  return tx.emit(
    projectId,
    "import",
    { id: row.id, status: row.status, progress: row.progress },
    say === undefined ? {} : { say: [{ text: say, pages: ["import"] }] },
  );
}

function configOf(model: PackModel): Map<string, string> {
  return new Map(model.config.map((entry) => [entry.key, entry.value]));
}

function settingsFrom(values: ReadonlyMap<string, string>): Partial<ProjectSettings> {
  const settings: Partial<ProjectSettings> = {};
  const method = values.get("merge_method");
  if (isMergeMethod(method)) settings.merge_method = method;
  for (const key of FLAG_SETTINGS) {
    const value = values.get(key);
    if (value !== undefined) settings[key] = value === "true";
  }
  return settings;
}

async function stepImport(tx: Tx, importId: number): Promise<boolean> {
  const row = await tx.maybe<ImportRow>("SELECT * FROM project_imports WHERE id = $1", [importId]);
  if (row === undefined || row.status !== "running" || row.project_id === null || row.next_step_at === null || row.next_step_at > now()) return false;
  const step = Math.round((row.progress / 100) * STEPS) + 1;
  if (step < STEPS) {
    const moved = await tx.one<ImportRow>("UPDATE project_imports SET progress = $2, next_step_at = $3 WHERE id = $1 RETURNING *", [
      row.id, progressOf(step), row.next_step_at + config.exportStepMs,
    ]);
    await emitImport(tx, row.project_id, moved);
    return true;
  }
  const project = await tx.one<ProjectRow>("SELECT * FROM projects WHERE id = $1", [row.project_id]);
  const known = await existingUsers(tx, row.pack);
  const parsed = parsePack(row.pack, (name) => name === "spurline-train" || known.has(name));
  if (!parsed.ok) throw new Error("A stored pack no longer parses.");
  await tx.q("SAVEPOINT import_data");
  try {
    await applyPack(tx, project, parsed.model);
  } catch (error) {
    await tx.q("ROLLBACK TO SAVEPOINT import_data");
    const text = error instanceof StorageUnavailable ? IMPORT_FAILED_STORAGE : IMPORT_FAILED;
    if (!(error instanceof StorageUnavailable)) console.error("import failed", error);
    const failed = await tx.one<ImportRow>("UPDATE project_imports SET status = 'failed', error = $2, next_step_at = NULL WHERE id = $1 RETURNING *", [row.id, text]);
    await emitImport(tx, row.project_id, failed, text);
    return false;
  }
  await tx.q("RELEASE SAVEPOINT import_data");
  const finished = await tx.one<ImportRow>(
    "UPDATE project_imports SET status = 'finished', progress = 100, next_step_at = NULL WHERE id = $1 RETURNING *",
    [row.id],
  );
  await emitImport(tx, row.project_id, finished, `Import finished: ${row.commits} commits, ${row.issues} issues, ${row.requests} requests.`);
  return false;
}

async function runImports(): Promise<void> {
  for (;;) {
    const due = await db.maybe<{ id: number; project_id: number }>(
      "SELECT id, project_id FROM project_imports WHERE status = 'running' AND next_step_at <= $1 ORDER BY id LIMIT 1",
      [now()],
    );
    if (due === undefined) return;
    await withTx(async (tx) => {
      await tx.lockProject(due.project_id);
      while (await stepImport(tx, due.id)) continue;
    });
  }
}

const importView = (row: ImportRow): Record<string, unknown> => ({
  id: row.id,
  status: row.status,
  progress: row.progress,
  error: row.error,
  project: row.project_id,
  preview: { commits: row.commits, issues: row.issues, requests: row.requests },
});

async function importScope(tx: Queryable, ctx: Ctx): Promise<ImportRow> {
  const row = await tx.maybe<ImportRow>("SELECT * FROM project_imports WHERE id = $1", [intParam(ctx, "id")]);
  if (row === undefined) throw notFound();
  const { access } = await groupScope(tx, ctx.user, row.group_id);
  requireAction(access, "transfer");
  return row;
}

export function registerTransferRoutes(router: Router): void {
  onDue(runExports);
  onDue(runImports);

  router.post("/api/projects/:id/exports", (ctx) =>
    withTx(async (tx) => {
      const { project, access } = await projectScope(tx, ctx.user, intParam(ctx, "id"));
      requireAction(access, "transfer");
      await tx.lockProject(project.id);
      const row = await tx.one<ExportRow>(
        "INSERT INTO project_exports (project_id, status, progress, next_step_at, created_at) VALUES ($1, 'running', 0, $2, $3) RETURNING *",
        [project.id, now() + config.exportStepMs, now()],
      );
      return json(202, { id: row.id, seq: await emitExport(tx, row) });
    }),
  );

  router.get("/api/exports/:id", async (ctx) => json(200, exportView((await exportScope(db, ctx)).row)));

  router.get("/api/exports/:id/file", async (ctx): Promise<Reply> => {
    const { row } = await exportScope(db, ctx);
    if (row.status !== "finished" || row.object_key === null) throw notFound();
    let file: Buffer | null;
    try {
      file = await storage.get(row.object_key);
    } catch (error) {
      if (error instanceof StorageUnavailable) throw storageUnavailable();
      throw error;
    }
    if (file === null) throw notFound();
    return { status: 200, raw: file, contentType: "text/plain; charset=utf-8", headers: { "content-disposition": `attachment; filename="export-${row.id}.spurpack"` } };
  });

  router.post(
    "/api/groups/:id/imports",
    async (ctx) => {
      const { group, access } = await groupScope(db, ctx.user, intParam(ctx, "id"));
      requireAction(access, "transfer");
      const slug = ctx.query.get("slug") ?? "";
      const errors = new FieldErrors();
      if (!isSegment(slug)) errors.add("slug", SEGMENT_MESSAGE);
      else if ((await db.maybe("SELECT 1 FROM projects WHERE path = $1", [`${group.path}/${slug}`])) !== undefined) errors.add("slug", "That path is taken.");
      errors.throwIfAny();
      const known = await existingUsers(db, ctx.text);
      const parsed = parsePack(ctx.text, (name) => name === "spurline-train" || known.has(name));
      if (!parsed.ok) {
        throw validation({ file: parsed.errors[0] ?? "" }, { code: "invalid_pack", message: "This file can't be imported.", extra: { errors: parsed.errors } });
      }
      const row = await db.one<ImportRow>(
        `INSERT INTO project_imports (group_id, user_id, slug, pack, commits, issues, requests, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'preview', $8) RETURNING *`,
        [group.id, ctx.user.id, slug, ctx.text, parsed.preview.commits, parsed.preview.issues, parsed.preview.requests, now()],
      );
      return json(200, { id: row.id, preview: parsed.preview, sentence: previewSentence(parsed.preview) });
    },
    {
      bodyKind: "text",
      bodyLimit: config.exportMaxBytes,
      tooLarge: (max) => payloadTooLarge(`File is too large (${max} bytes at most).`),
    },
  );

  router.post("/api/imports/:id/confirm", (ctx) =>
    withTx(async (tx) => {
      const found = await importScope(tx, ctx);
      const { group } = await groupScope(tx, ctx.user, found.group_id);
      const row = await tx.one<ImportRow>("SELECT * FROM project_imports WHERE id = $1 FOR UPDATE", [found.id]);
      if (row.status !== "preview") throw wrongState("This import was already confirmed.");
      const known = await existingUsers(tx, row.pack);
      const parsed = parsePack(row.pack, (name) => name === "spurline-train" || known.has(name));
      if (!parsed.ok) throw new Error("A stored pack no longer parses.");
      const values = configOf(parsed.model);
      const path = `${group.path}/${row.slug}`;
      if ((await tx.maybe("SELECT 1 FROM projects WHERE path = $1", [path])) !== undefined) throw validationOne("slug", "That path is taken.");
      const asked = values.get("visibility");
      const visibility = isVisibility(asked) && !exceedsVisibility(asked, group.visibility) ? asked : group.visibility;
      const branch = values.get("default_branch") ?? "main";
      const project = await createProjectRow(tx, {
        groupId: group.id, slug: row.slug, path, visibility, defaultBranch: branch, settings: settingsFrom(values),
      });
      await protectDefaultBranch(tx, project.id, branch);
      await tx.lockProject(project.id);
      const running = await tx.one<ImportRow>(
        "UPDATE project_imports SET status = 'running', progress = 0, project_id = $2, next_step_at = $3 WHERE id = $1 RETURNING *",
        [row.id, project.id, now() + config.exportStepMs],
      );
      return json(202, { project: project.id, seq: await emitImport(tx, project.id, running) });
    }),
  );

  router.get("/api/imports/:id", async (ctx) => json(200, importView(await importScope(db, ctx))));
}
