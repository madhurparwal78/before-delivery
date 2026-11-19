// Exports (brief: Exports, Services MinIO): rendered on the server, independent of any tab; ready
// only once object storage confirms the object; storage_unavailable after 10 seconds without it.
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, Image } from "@napi-rs/canvas";
import { ApiError, requireFields } from "../shared/errors";
import { copy } from "../shared/copy";
import { canEdit } from "../shared/rules";
import { exportFrame, exportSvg } from "../shared/svg";
import type { DiagramDocument, ExportFormat, ExportStatus, ExportView } from "../shared/types";
import { diagramAccess, requireRole } from "./access";
import { requireUser, type SessionUser } from "./auth";
import { one, pool, transaction } from "./db";
import { json, objectBody, route } from "./http";
import { newId } from "./ids";
import { broadcast } from "./live";
import { getObject, objectExists, putObject } from "./storage";

const STORAGE_WAIT_MS = 10000;
const RETRY_GAP_MS = 1000;

GlobalFonts.registerFromPath(fileURLToPath(new URL("../public/fonts/ibm-plex-sans-latin-400-normal.woff2", import.meta.url)), "IBM Plex Sans");

interface ExportRow {
  id: string;
  diagram_id: string;
  page_id: string;
  format: ExportFormat;
  scale: number;
  background: "white" | "transparent";
  status: ExportStatus;
  requested_by: string;
  seq: number;
  snapshot: DiagramDocument;
  width: number | null;
  height: number | null;
  created_at: Date;
}

function view(row: ExportRow): ExportView {
  return { id: row.id, status: row.status, format: row.format, page: row.page_id, seq: row.seq, requestedBy: row.requested_by, width: row.width, height: row.height, createdAt: row.created_at.toISOString() };
}

/** The export as `GET /api/exports/<id>` and the create and retry answers show it. */
function statusView(row: ExportRow) {
  return { id: row.id, status: row.status, format: row.format, page: row.page_id, seq: row.seq, width: row.width, height: row.height };
}

function objectKey(row: ExportRow): string {
  return `exports/${row.diagram_id}/${row.id}.${row.format}`;
}

const CONTENT_TYPE: Record<ExportFormat, string> = { svg: "image/svg+xml", png: "image/png" };

/** Renders the export's snapshot: the document as it was at the export's recorded seq. */
function render(row: ExportRow): { body: Buffer; width: number; height: number } {
  const page = row.snapshot.pages.find((p) => p.id === row.page_id);
  const frame = page ? exportFrame(page) : null;
  if (!page || !frame) throw new Error("nothing visible to export");
  const svg = exportSvg(page, frame, row.background, row.seq);
  if (row.format === "svg") return { body: Buffer.from(svg, "utf8"), width: frame.width, height: frame.height };
  const width = Math.round(frame.width * row.scale);
  const height = Math.round(frame.height * row.scale);
  const image = new Image();
  image.src = Buffer.from(svg, "utf8");
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  return { body: canvas.toBuffer("image/png"), width, height };
}

async function setStatus(row: ExportRow, status: ExportStatus, size?: { width: number; height: number }): Promise<void> {
  const { rows } = await pool.query<ExportRow>("UPDATE exports SET status = $2, width = $3, height = $4 WHERE id = $1 RETURNING *",
    [row.id, status, size?.width ?? null, size?.height ?? null]);
  const updated = rows[0];
  if (updated) broadcast(row.diagram_id, { type: "export", export: view(updated) });
}

/** One rendering attempt: write the object, confirm it exists, then mark ready; give up after 10 seconds. */
async function attempt(row: ExportRow): Promise<void> {
  const file = render(row);
  const deadline = Date.now() + STORAGE_WAIT_MS;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return setStatus(row, "storage_unavailable");
    try {
      await putObject(objectKey(row), file.body, CONTENT_TYPE[row.format], left);
      if (await objectExists(objectKey(row), Math.max(1, deadline - Date.now()))) return setStatus(row, "ready", file);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, Math.min(RETRY_GAP_MS, Math.max(0, deadline - Date.now()))));
    }
  }
}

function start(row: ExportRow): void {
  void attempt(row).catch(() => setStatus(row, "storage_unavailable")).catch((error: unknown) => console.error(error));
}

async function readableExport(user: SessionUser, exportId: string): Promise<ExportRow> {
  const { rows } = await pool.query<ExportRow>(
    "SELECT e.* FROM exports e JOIN members m ON m.diagram_id = e.diagram_id AND m.user_id = $2 WHERE e.id = $1", [exportId, user.id]);
  const row = rows[0];
  if (!row) throw new ApiError("not_found");
  return row;
}

route("GET", "/api/diagrams/:id/exports", async (req) => {
  const access = await diagramAccess(await requireUser(req), req.params[0] as string);
  const { rows } = await pool.query<ExportRow>("SELECT * FROM exports WHERE diagram_id = $1 ORDER BY created_at DESC, id DESC", [access.diagramId]);
  return json(200, { exports: rows.map(view) });
});

route("POST", "/api/diagrams/:id/exports", async (req) => {
  const access = await diagramAccess(await requireUser(req), req.params[0] as string);
  const { page, format, scale, background } = objectBody(req.body);
  // The diagram row lock orders this request against operations, so the snapshot is the document at its seq,
  // and against repeats of the same request, so only one export is created.
  const outcome = await transaction(async (db) => {
    const locked = one((await db.query<{ doc: DiagramDocument; seq: number }>("SELECT doc, seq FROM diagrams WHERE id = $1 FOR UPDATE", [access.diagramId])).rows);
    const doc: DiagramDocument = { ...locked.doc, seq: locked.seq };
    const target = typeof page === "string" ? doc.pages.find((p) => p.id === page) : undefined;
    if (typeof page === "string" && !target) throw new ApiError("not_found");
    requireRole(access, canEdit);
    requireFields({
      page: target && exportFrame(target) ? null : copy.fields.exportPage,
      format: format === "png" || format === "svg" ? null : "Choose PNG or SVG.",
      scale: scale === 1 || (scale === 2 && format === "png") ? null : "Choose 1x, or 2x for PNG.",
      background: background === "white" || background === "transparent" ? null : "Choose White or Transparent.",
    });
    const repeat = await db.query<ExportRow>(
      `SELECT * FROM exports WHERE diagram_id = $1 AND requested_by = $2 AND status = 'rendering' AND seq = $3
          AND page_id = $4 AND format = $5 AND scale = $6 AND background = $7 LIMIT 1`,
      [access.diagramId, access.user.id, doc.seq, page, format, scale, background]);
    const existing = repeat.rows[0];
    if (existing) return { row: existing, created: false };
    const { rows } = await db.query<ExportRow>(
      `INSERT INTO exports (id, diagram_id, page_id, format, scale, background, status, requested_by, seq, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, 'rendering', $7, $8, $9) RETURNING *`,
      [newId("x_"), access.diagramId, page, format, scale, background, access.user.id, doc.seq, JSON.stringify(doc)]);
    return { row: one(rows), created: true };
  });
  if (!outcome.created) return json(200, statusView(outcome.row));
  broadcast(access.diagramId, { type: "export", export: view(outcome.row) });
  start(outcome.row);
  return json(202, statusView(outcome.row));
});

route("GET", "/api/exports/:id", async (req) => {
  const row = await readableExport(await requireUser(req), req.params[0] as string);
  return json(200, statusView(row));
});

route("GET", "/api/exports/:id/file", async (req) => {
  const row = await readableExport(await requireUser(req), req.params[0] as string);
  if (row.status !== "ready") throw new ApiError("export_not_ready");
  const file = await getObject(objectKey(row));
  return { status: 200, body: file.body, headers: { "Content-Type": CONTENT_TYPE[row.format], "Content-Disposition": `attachment; filename="${row.id}.${row.format}"` } };
});

route("POST", "/api/exports/:id/retry", async (req) => {
  const user = await requireUser(req);
  const row = await readableExport(user, req.params[0] as string);
  const access = await diagramAccess(user, row.diagram_id);
  requireRole(access, canEdit);
  // The one retry transition, atomic: only storage_unavailable moves back to rendering, and only once.
  const claimed = await pool.query<ExportRow>(
    "UPDATE exports SET status = 'rendering', width = NULL, height = NULL WHERE id = $1 AND status = 'storage_unavailable' RETURNING *", [row.id]);
  const retried = claimed.rows[0];
  if (!retried) throw new ApiError("export_not_retryable");
  broadcast(retried.diagram_id, { type: "export", export: view(retried) });
  start(retried);
  return json(202, statusView(retried));
});
