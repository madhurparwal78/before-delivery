// Exports: queued in the background, stored in object storage before they are offered.
import { randomUUID } from "node:crypto";
import { ApiError, invalid, notFound } from "../errors.js";
import { CSV_TYPE, XLSX_TYPE } from "../files/exportFile.js";
import { jsonBody, member } from "../http.js";
import { requireRole } from "../rules/roles.js";
import { type Services } from "../services/index.js";
import { derive, isUuid, stationClock, stationWorkbook } from "../workbook.js";

interface ExportRow {
  id: string;
  workbook_id: string;
  station_id: string;
  format: "xlsx" | "csv";
  sheet_id: string | null;
  file_name: string;
  status: "pending" | "waiting_for_storage" | "ready";
  created_at: Date;
  ready_at: Date | null;
}

function exportOut(e: ExportRow): Record<string, unknown> {
  return {
    id: e.id,
    format: e.format,
    sheetId: e.sheet_id,
    fileName: e.file_name,
    status: e.status,
    createdAt: e.created_at.toISOString(),
    readyAt: e.ready_at ? e.ready_at.toISOString() : null,
  };
}

const stem = (name: string): string => name.replace(/[^A-Za-z0-9-]/g, "-");

export function exportRoutes(svc: Services): void {
  member("POST", "/api/workbooks/:id/exports", async ({ req, member: me }) => {
    const row = await stationWorkbook(svc.db, me.stationId, req.params.id);
    requireRole(me.role, "exports");
    const body = jsonBody(req);
    if (body.format !== "xlsx" && body.format !== "csv") throw invalid({ format: "Pick xlsx or csv." });
    let fileName = `${stem(row.name)}.xlsx`;
    let sheetId: string | null = null;
    if (body.format === "csv") {
      const derived = await derive(svc.db, row, stationClock(me.timeZone));
      const sheet = typeof body.sheetId === "string" ? derived.engine.sheetById(body.sheetId) : undefined;
      if (!sheet) throw invalid({ sheetId: "Pick a sheet of this workbook to export." });
      sheetId = sheet.id;
      fileName = `${stem(row.name)}-${stem(sheet.name)}.csv`;
    }
    const status = svc.status.status.storage === "up" ? "pending" : "waiting_for_storage";
    const r = await svc.db.query<ExportRow>(
      `INSERT INTO exports (id, workbook_id, member_id, format, sheet_id, file_name, status, head_seq, origin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [randomUUID(), row.id, me.id, body.format, sheetId, fileName, status, row.head_seq, req.origin],
    );
    svc.workers.kickExports();
    return { status: 202, json: { export: exportOut(r.rows[0]) } };
  });

  member("GET", "/api/workbooks/:id/exports", async ({ req, member: me }) => {
    const row = await stationWorkbook(svc.db, me.stationId, req.params.id);
    requireRole(me.role, "exports");
    const r = await svc.db.query<ExportRow>("SELECT * FROM exports WHERE workbook_id = $1 ORDER BY created_at DESC LIMIT 20", [row.id]);
    return { status: 200, json: { exports: r.rows.map(exportOut) } };
  });

  member("GET", "/api/exports/:exportId/download", async ({ req, member: me }) => {
    if (!isUuid(req.params.exportId)) throw notFound();
    const r = await svc.db.query<ExportRow>(
      "SELECT e.*, w.station_id FROM exports e JOIN workbooks w ON w.id = e.workbook_id WHERE e.id = $1 AND w.station_id = $2",
      [req.params.exportId, me.stationId],
    );
    const found = r.rows[0];
    if (!found) throw notFound();
    requireRole(me.role, "exports");
    if (found.status !== "ready") throw new ApiError(409, "export_not_ready", "That export is not ready yet.");
    const data = await svc.storage.get(`stations/${found.station_id}/exports/${found.id}/${found.file_name}`);
    return {
      status: 200,
      file: { data, type: found.format === "xlsx" ? XLSX_TYPE : CSV_TYPE, disposition: `attachment; filename="${found.file_name}"` },
      headers: { "Cache-Control": "no-store" },
    };
  });
}
