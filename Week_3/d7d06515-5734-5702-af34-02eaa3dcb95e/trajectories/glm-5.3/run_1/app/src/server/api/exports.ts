import { randomToken, config } from "../config.js";
import { bad, validation } from "../errors.js";
import { db } from "../db.js";
import { json, type Ctx } from "./accounts.js";
import { drawingContext, type DrawingAccessInfo } from "./drawings.js";
import { publishDrawingEvent } from "../live.js";
import { putObject, getObject, minioAvailable } from "../providers/minio.js";
import { workspaceNow, studioDateKey, dateNotBeforeToday } from "../clock.js";
import { writeDxf } from "../dxf.js";
import { buildPdf, greyFor, textWidthOf, type PdfPage } from "../pdf.js";
import { loadSnapshot } from "../command-state.js";
import { copy } from "../../shared/copy.js";
import type { Point } from "../../shared/types.js";

const scales = ["1:20", "1:50", "1:100", "1:200"];

export async function handleExportCreate(ctx: Ctx, drawingId: string): Promise<void> {
  const info = await drawingContext(ctx, drawingId, "export");
  const body = ctx.body as { format?: string; layout?: string };
  const format = String(body?.format ?? "");
  if (format !== "pdf" && format !== "dxf") throw validation({ format: "Choose a format." });
  const layout = format === "dxf" ? "Model" : String(body?.layout ?? "");
  const snapshot = await loadSnapshot(drawingId);
  if (format === "pdf") {
    const layouts = snapshot.layouts.map((l) => l.name);
    if (!layouts.includes(layout)) throw validation({ layout: "Choose a layout." });
  }
  const { epochMs } = await workspaceNow(info.workspaceId);
  const issueDateKey = studioDateKey(epochMs, info.zone);
  const revision = await revisionInEffect(info.workspaceId, issueDateKey);
  const exportId = randomToken(9);
  const countRow = await db.one<{ count: string }>(`select count(*) as count from exports where drawing_id = $1`, [drawingId]);
  const n = Number(countRow?.count ?? 0) + 1;
  const baseName = snapshot.drawing.name.replace(/\.dxf$/i, "");
  const file = `${baseName}-${format === "dxf" ? "Model" : layout}-${n}.${format}`;
  await db.run(
    `insert into exports (id, drawing_id, format, layout, file, state, issue_date_key, title_block_revision, requested_epoch)
     values ($1, $2, $3, $4, $5, 'rendering', $6, $7, $8)`,
    [exportId, drawingId, format, layout, file, issueDateKey, revision?.letter ?? null, epochMs],
  );
  json(ctx.res, 202, { export: await exportRecord(exportId) });
  void renderAndStore(exportId, info, format, layout);
}

async function renderAndStore(exportId: string, info: DrawingAccessInfo, format: string, layout: string): Promise<void> {
  const snapshot = await loadSnapshot(info.drawingId);
  const visibleLayers = new Set(snapshot.layers.filter((l) => l.on && !l.frozen).map((l) => l.name));
  const layerByName = new Map(snapshot.layers.map((l) => [l.name, l]));
  let bytes: Uint8Array;
  let contentType: string;
  if (format === "dxf") {
    bytes = new TextEncoder().encode(
      writeDxf({
        units: info.units,
        layers: snapshot.layers.map((l) => ({
          name: l.name,
          colour: l.color,
          linetype: l.linetype,
          on: l.on,
          frozen: l.frozen,
          locked: l.locked,
        })),
        entities: snapshot.objects
          .filter((o) => visibleLayers.has(o.layer))
          .map((o) => ({
            handle: o.handle,
            type: o.type,
            layer: o.layer,
            colour: String(o.props.color === "ByLayer" ? (layerByName.get(o.layer)?.color ?? "White") : o.props.color),
            linetype: String(o.props.linetype),
            lineweight: String(o.props.lineweight),
            geometry: o.geometry,
          })),
      }),
    );
    contentType = "application/dxf";
  } else {
    const page = await renderPdfPage(snapshot, info, layout, visibleLayers, layerByName);
    bytes = buildPdf(page);
    contentType = "application/pdf";
  }
  const objectKey = `exports/${info.drawingId}/${exportId}.${format}`;
  const stored = await putObject(objectKey, bytes, contentType);
  if (!stored) {
    await db.run(`update exports set state = 'failed' where id = $1`, [exportId]);
    return;
  }
  await db.run(`update exports set state = 'stored', object_key = $2, size_bytes = $3, stored_epoch = $4 where id = $1`, [
    exportId,
    objectKey,
    bytes.byteLength,
    Date.now(),
  ]);
}

async function renderPdfPage(
  snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
  info: DrawingAccessInfo,
  layout: string,
  visibleLayers: Set<string>,
  layerByName: Map<string, { name: string; color: string; linetype: string; on: boolean; frozen: boolean; locked: boolean; current: boolean; position: number }>,
): Promise<PdfPage> {
  const { buildPage } = await import("../plotting.js");
  const { epochMs } = await workspaceNow(info.workspaceId);
  const issueDateKey = studioDateKey(epochMs, info.zone);
  const revision = await revisionInEffect(info.workspaceId, issueDateKey);
  const layoutRow = snapshot.layouts.find((l) => l.name === layout);
  const scale = layoutRow?.viewport_scale ?? "FIT";
  return buildPage({
    snapshot,
    info,
    layout,
    visibleLayers,
    layerByName,
    titleBlock: {
      letter: revision?.letter ?? "-",
      footerNote: revision?.footer_note ?? "",
      issued: issueDateKey,
      scale,
      drawingName: snapshot.drawing.name.replace(/\.dxf$/i, ""),
    },
  });
}

export async function exportRecord(exportId: string): Promise<Record<string, unknown>> {
  const row = await db.one<{
    id: string;
    drawing_id: string;
    format: string;
    layout: string;
    file: string;
    state: string;
    issue_date_key: string;
    title_block_revision: string | null;
    object_key: string | null;
    size_bytes: number | null;
    stored_epoch: string | null;
  }>(`select * from exports where id = $1`, [exportId]);
  if (!row) throw bad("not_found");
  return {
    id: row.id,
    drawing_id: row.drawing_id,
    format: row.format,
    layout: row.layout,
    file: row.file,
    state: row.state,
    issued_at: row.stored_epoch === null ? null : new Date(Number(row.stored_epoch)).toISOString(),
    issue_date: row.issue_date_key,
    title_block_revision: row.title_block_revision,
    object_key: row.object_key,
    size_bytes: row.size_bytes,
    download_url: row.state === "stored" ? `/api/exports/${row.id}/download` : null,
  };
}

export async function handleExportGet(ctx: Ctx, exportId: string): Promise<void> {
  const row = await db.one<{ drawing_id: string }>(`select drawing_id from exports where id = $1`, [exportId]);
  if (!row) throw bad("not_found");
  await drawingContext(ctx, row.drawing_id, "read");
  json(ctx.res, 200, { export: await exportRecord(exportId) });
}

export async function handleExportList(ctx: Ctx, drawingId: string): Promise<void> {
  await drawingContext(ctx, drawingId, "read");
  const rows = await db.all<{ id: string }>(`select id from exports where drawing_id = $1 order by requested_epoch desc`, [drawingId]);
  const exports = [];
  for (const row of rows) exports.push(await exportRecord(row.id));
  json(ctx.res, 200, { exports });
}

export async function handleExportDownload(ctx: Ctx, exportId: string): Promise<void> {
  const row = await db.one<{ drawing_id: string; file: string; object_key: string | null; format: string; state: string }>(
    `select drawing_id, file, object_key, format, state from exports where id = $1`,
    [exportId],
  );
  if (!row) throw bad("not_found");
  await drawingContext(ctx, row.drawing_id, "read");
  if (row.state !== "stored" || !row.object_key) throw bad("export_not_ready");
  const bytes = await getObject(row.object_key);
  if (!bytes) throw bad("storage_unavailable");
  ctx.res.writeHead(200, {
    "content-type": row.format === "pdf" ? "application/pdf" : "application/dxf",
    "content-disposition": `attachment; filename="${row.file}"`,
  });
  ctx.res.end(bytes);
}

export async function revisionInEffect(workspaceId: string, issueDateKey: string): Promise<{ letter: string; footer_note: string; effective_date: string } | null> {
  const rows = await db.all<{ letter: string; footer_note: string; effective_date: string }>(
    `select letter, footer_note, effective_date from title_block_revisions where workspace_id = $1 order by effective_date desc, position desc`,
    [workspaceId],
  );
  for (const row of rows) {
    if (row.effective_date <= issueDateKey) return row;
  }
  return null;
}

export async function handleRevisionList(ctx: Ctx): Promise<void> {
  const account = ctx.account;
  if (!account) throw bad("unauthenticated");
  const rows = await db.all<{ letter: string; footer_note: string; effective_date: string }>(
    `select letter, footer_note, effective_date from title_block_revisions where workspace_id = $1 order by effective_date, position`,
    [account.workspace_id],
  );
  json(ctx.res, 200, { revisions: rows });
}

export async function handleRevisionCreate(ctx: Ctx): Promise<void> {
  const account = ctx.account;
  if (!account) throw bad("unauthenticated");
  const body = ctx.body as { footer_note?: string; effective_date?: string };
  const footerNote = typeof body?.footer_note === "string" ? body.footer_note.trim() : "";
  if (footerNote.length < 1 || footerNote.length > 120) throw validation({ footer_note: copy.footerNoteError });
  const effectiveDate = String(body?.effective_date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw validation({ effective_date: copy.expiryFormat });
  const { epochMs } = await workspaceNow(account.workspace_id);
  if (!dateNotBeforeToday(effectiveDate, epochMs, account.time_zone)) throw validation({ effective_date: copy.expiryPast });
  const latest = await db.one<{ effective_date: string; letter: string }>(
    `select effective_date, letter from title_block_revisions where workspace_id = $1 order by effective_date desc, position desc limit 1`,
    [account.workspace_id],
  );
  if (latest && effectiveDate <= latest.effective_date) {
    throw validation({ effective_date: copy.effectiveDateError });
  }
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const letter = letters[(latest ? letters.indexOf(latest.letter) + 1 : 0) % 26];
  const positionRow = await db.one<{ count: string }>(
    `select count(*) as count from title_block_revisions where workspace_id = $1`,
    [account.workspace_id],
  );
  await db.run(
    `insert into title_block_revisions (workspace_id, letter, footer_note, effective_date, position) values ($1, $2, $3, $4, $5)`,
    [account.workspace_id, letter, footerNote, effectiveDate, Number(positionRow?.count ?? 0)],
  );
  json(ctx.res, 201, { revision: { letter, footer_note: footerNote, effective_date: effectiveDate } });
}

export const viewportScales = scales;
