import { formatHours } from "../shared/format";
import { canonicalPredecessors } from "../shared/predecessors";
import type { Project, StoredExport } from "../shared/types";
import { planToday } from "./config";
import { newId, pool } from "./db";
import { loadProject, buildProject } from "./model";
import { renderPdf } from "./pdf";
import { fetchObject, storeObject } from "./s3";

export type ExportFormat = "csv" | "pdf";

const CONTENT_TYPES: Record<ExportFormat, string> = { csv: "text/csv; charset=utf-8", pdf: "application/pdf" };
const CSV_HEADER = "Row,Name,Type,Group,Start,End,Duration,Percent complete,Critical,Assignees,Predecessors,Baseline start,Baseline end,Variance";

const quoted = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
/** A cell that begins with =, +, - or @ is written with a leading apostrophe so a spreadsheet never runs it. */
const neutralised = (value: string): string => quoted(/^[=+\-@]/.test(value) ? `'${value}` : value);

function renderCsv(project: Project): Buffer {
  const nameOf = new Map(project.items.map((item) => [item.id, item.name]));
  const lines = project.items.map((item) => {
    const assignees = [...item.assignees].sort((a, b) => a.name.localeCompare(b.name)).map((a) => `${a.name} (${formatHours(a.hours)})`).join("; ");
    const baseline = item.baseline;
    return [
      String(item.row),
      neutralised(item.name),
      item.kind,
      neutralised(item.group ? (nameOf.get(item.group) ?? "") : ""),
      item.start ?? "",
      item.end ?? "",
      String(item.duration),
      String(item.percent),
      item.critical ? "yes" : "no",
      neutralised(assignees),
      quoted(canonicalPredecessors(item.id, project.items, project.links)),
      baseline ? baseline.start : "",
      baseline ? baseline.end : "",
      baseline ? String(baseline.variance) : "",
    ].join(",");
  });
  return Buffer.from([CSV_HEADER, ...lines].map((line) => `${line}\r\n`).join(""), "utf8");
}

const slugOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";

/** An export is requested, rendering, then stored (its link is shown) or failed (the outage alert is shown). */
export async function createExport(projectId: string, format: ExportFormat): Promise<Omit<StoredExport, "createdAt">> {
  const project = buildProject(await loadProject(pool, projectId));
  const id = newId();
  const filename = `${slugOf(project.name)}-${planToday()}.${format}`;
  await pool.query("INSERT INTO exports (id, project_id, format, filename, state) VALUES ($1, $2, $3, $4, 'rendering')", [id, projectId, format, filename]);
  try {
    await storeObject(`exports/${projectId}/${id}/${filename}`, format === "csv" ? renderCsv(project) : renderPdf(project), CONTENT_TYPES[format]);
  } catch (error) {
    await pool.query("UPDATE exports SET state = 'failed' WHERE id = $1", [id]);
    throw error;
  }
  await pool.query("UPDATE exports SET state = 'stored' WHERE id = $1", [id]);
  return { id, format, filename, downloadUrl: `/api/exports/${id}/download` };
}

export async function storedExports(projectId: string): Promise<StoredExport[]> {
  const found = await pool.query(
    "SELECT id, format, filename, created_at FROM exports WHERE project_id = $1 AND state = 'stored' ORDER BY created_at DESC, id",
    [projectId],
  );
  return found.rows.map((row) => ({ id: row.id, format: row.format, filename: row.filename, downloadUrl: `/api/exports/${row.id}/download`, createdAt: row.created_at.toISOString() }));
}

export async function downloadExport(projectId: string, exportId: string): Promise<{ filename: string; contentType: string; response: Response } | null> {
  const found = await pool.query("SELECT format, filename FROM exports WHERE id = $1 AND project_id = $2 AND state = 'stored'", [exportId, projectId]);
  if (found.rowCount === 0) return null;
  const { format, filename } = found.rows[0] as { format: ExportFormat; filename: string };
  return { filename, contentType: CONTENT_TYPES[format], response: await fetchObject(`exports/${projectId}/${exportId}/${filename}`) };
}
