// Export readiness and one reproducible export per project revision.
import { createHash } from "node:crypto";
import type pg from "pg";
import type { Export, Readiness } from "../shared/api.ts";
import { membership, requireRole } from "./access.ts";
import { signedIn } from "./auth.ts";
import { citationReport } from "./citations.ts";
import { one, pool, transaction, turn, type Db } from "./db.ts";
import { bytes, fail, ok, type Context, type Reply } from "./http.ts";
import { newId, textOf, treeAt } from "./projects.ts";
import { assetKey, exportKey, getObject, objectSize, putObject } from "./storage.ts";
import { onlyKeys } from "./validate.ts";
import { zip } from "./zip.ts";

interface ExportRow {
  id: string;
  project_id: string;
  project_revision: number;
  size: number;
  sha256: string;
}

/** Lower case, runs of anything but letters and digits become one hyphen, trimmed, then `-r<n>.zip`. */
function exportFilename(title: string, revision: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-r${revision}.zip`;
}

function exportShape(row: ExportRow, title: string): Export {
  return {
    id: row.id,
    projectRevision: row.project_revision,
    size: Number(row.size),
    sha256: row.sha256,
    downloadUrl: `/api/projects/${row.project_id}/exports/${row.id}/download`,
    filename: exportFilename(title, row.project_revision),
  };
}

/** An export needs no open suggestions, open threads, undefined citations or duplicate keys. */
async function readiness(db: Db, projectId: string, revision: number): Promise<Readiness> {
  const counts = await one<{ suggestions: number; threads: number }>(
    db,
    `SELECT (SELECT count(*)::int FROM suggestions WHERE project_id = $1 AND status = 'open') AS suggestions,
            (SELECT count(*)::int FROM threads WHERE project_id = $1 AND status = 'open') AS threads`,
    [projectId],
  );
  const report = await citationReport(db, projectId, revision);
  return {
    openSuggestions: counts?.suggestions ?? 0,
    openThreads: counts?.threads ?? 0,
    undefinedCitations: report.undefined.length,
    duplicateKeys: report.duplicate.length,
  };
}

async function buildZip(client: pg.PoolClient, projectId: string, revision: number): Promise<Buffer> {
  const files = await treeAt(client, projectId, revision);
  const entries = [];
  for (const file of files) {
    const data =
      file.kind === "text"
        ? Buffer.from(await textOf(client, file.id, file.text_revision ?? 1), "utf8")
        : await getObject(assetKey(projectId, file.id));
    entries.push({ path: file.path, data });
  }
  return zip(entries);
}

export async function createExport(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  requireRole(access, "export");
  const projectId = access.project.id;
  return transaction(async (client) => {
    await turn(client, "exports", projectId);
    const revision = (await client.query<{ revision: number }>("SELECT revision FROM projects WHERE id = $1", [projectId])).rows[0]
      ?.revision as number;
    const ready = await readiness(client, projectId, revision);
    if (Object.values(ready).some((count) => count > 0)) throw fail.conflict("not_ready", { readiness: ready });
    onlyKeys(ctx.body, []);
    for (const file of await treeAt(client, projectId, revision)) {
      if (file.kind === "asset" && (await objectSize(assetKey(projectId, file.id))) === null) throw fail.storage();
    }
    const existing = await one<ExportRow>(client, "SELECT * FROM exports WHERE project_id = $1 AND project_revision = $2", [
      projectId,
      revision,
    ]);
    if (existing) {
      const key = exportKey(projectId, existing.id);
      if ((await objectSize(key)) !== Number(existing.size)) {
        await putObject(key, await buildZip(client, projectId, revision), "application/zip");
      }
      return ok({ export: exportShape(existing, access.project.title) });
    }
    const data = await buildZip(client, projectId, revision);
    const id = newId();
    await putObject(exportKey(projectId, id), data, "application/zip");
    const row = await client.query<ExportRow>(
      "INSERT INTO exports (id, project_id, project_revision, size, sha256) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [id, projectId, revision, data.length, createHash("sha256").update(data).digest("hex")],
    );
    return ok({ export: exportShape(row.rows[0] as ExportRow, access.project.title) }, 201);
  });
}

export async function downloadExport(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  const row = await one<ExportRow>(pool, "SELECT * FROM exports WHERE project_id = $1 AND id = $2", [access.project.id, ctx.params.eid]);
  if (!row) throw fail.notFound();
  requireRole(access, "export");
  const data = await getObject(exportKey(row.project_id, row.id));
  return bytes(data, "application/zip", {
    "Content-Disposition": `attachment; filename="${exportShape(row, access.project.title).filename}"`,
  });
}
