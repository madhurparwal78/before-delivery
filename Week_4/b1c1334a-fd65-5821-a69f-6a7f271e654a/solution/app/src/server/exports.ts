// CSV exports: a snapshot of one table at one point in the edit order, stored in object
// storage, confirmed by size and SHA-256, and re-verified before every download.
import type { Account } from "./auth.js";
import { query, transaction } from "./db.js";
import { documentAccess } from "./edit.js";
import { Evaluation } from "./engine.js";
import { ApiError, type Reply, json, notFound } from "./http.js";
import { newId } from "./ops.js";
import { loadState } from "./store.js";
import { StorageUnavailable, digest, getObject, objectKey, putObject } from "./storage.js";

const EXPORT_DEADLINE_MS = 12_000;

interface ExportRow {
  id: string;
  document_id: string;
  table_id: string;
  file_name: string;
  status: "writing" | "ready" | "failed";
  byte_size: string | null;
  sha256: string | null;
  created_by: string;
  document_revision: number;
  created_at: Date;
}

function exportJson(e: ExportRow) {
  const ready = e.status === "ready";
  return {
    id: e.id,
    table_id: e.table_id,
    file_name: e.file_name,
    status: e.status,
    byte_size: ready ? Number(e.byte_size) : null,
    sha256: ready ? e.sha256 : null,
    download_url: ready ? `/api/exports/${e.id}/download` : null,
    created_by: e.created_by,
    document_revision: e.document_revision,
    created_at: e.created_at.toISOString(),
  };
}

// RFC 4180 with CRLF after every record; text-origin values starting with = + - @ tab or CR
// get one apostrophe in the file only.
function csvField(shown: string, textOrigin: boolean): string {
  const value = textOrigin && /^[=+\-@\t\r]/.test(shown) ? `'${shown}` : shown;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvFor(ev: Evaluation, tableId: string): Buffer {
  const table = ev.tables.get(tableId)!;
  const lines: string[] = [];
  if (table.kind === "summary") {
    const s = ev.summary(table);
    lines.push(s.columns.map((c) => csvField(c.name, true)).join(","));
    for (const g of s.groups) lines.push(s.columns.map((c) => {
      const out = ev.summaryOut(table, g, c);
      return csvField(out.display, out.textOrigin);
    }).join(","));
  } else {
    const columns = ev.columns(tableId);
    lines.push(columns.map((c) => csvField(c.name, true)).join(","));
    for (const r of ev.visibleRows(tableId)) lines.push(columns.map((c) => {
      const out = ev.out(r, c);
      return csvField(out.display, out.textOrigin);
    }).join(","));
  }
  return Buffer.from(lines.map((l) => `${l}\r\n`).join(""), "utf8");
}

// The download's one Content-Disposition header: always plain ASCII on one line.
export function contentDisposition(fileName: string): string {
  const ascii = Array.from(fileName).map((ch) => (/^[\x20-\x7e]$/.test(ch) && ch !== '"' && ch !== "\\" ? ch : "_")).join("");
  const keep = /^[A-Za-z0-9!#$&+\-.^_`|~]$/;
  const encoded = [...Buffer.from(fileName, "utf8")]
    .map((byte) => {
      const ch = String.fromCharCode(byte);
      return byte < 0x80 && keep.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function createExport(account: Account, docId: string, tableId: string): Promise<Reply> {
  // Read the table at one snapshot of the edit order; edits never wait on this.
  const snap = await transaction(async (db) => {
    const { doc, access } = await documentAccess(db, docId, account, false);
    const ev = new Evaluation(await loadState(db, doc), access);
    const table = ev.tables.get(tableId);
    if (!table) throw notFound();
    return { body: csvFor(ev, tableId), fileName: `${ev.tableName(table)}.csv`, revision: doc.revision };
  }, "REPEATABLE READ");
  const [record] = await query<ExportRow>(
    `INSERT INTO exports (id, document_id, table_id, file_name, status, created_by, document_revision)
     VALUES ($1, $2, $3, $4, 'writing', $5, $6) RETURNING *`,
    [newId("x"), docId, tableId, snap.fileName, account.id, snap.revision],
  );
  // Storage runs outside any transaction and keeps going if the client leaves.
  const finished = await storeExport(record!, snap.body);
  return json(201, { export: exportJson(finished) });
}

async function storeExport(record: ExportRow, body: Buffer): Promise<ExportRow> {
  const signal = AbortSignal.timeout(EXPORT_DEADLINE_MS);
  const key = objectKey(record.document_id, record.id);
  const hash = digest(body);
  let ok = false;
  try {
    await putObject(key, body, "text/csv; charset=utf-8", signal);
    const stored = await getObject(key, signal);
    ok = stored !== null && stored.length === body.length && digest(stored) === hash;
  } catch {
    // Any storage error or timeout ends the export as failed.
  }
  const rows = await query<ExportRow>(
    ok
      ? "UPDATE exports SET status = 'ready', byte_size = $2, sha256 = $3 WHERE id = $1 AND status = 'writing' RETURNING *"
      : "UPDATE exports SET status = 'failed' WHERE id = $1 AND status = 'writing' RETURNING *",
    ok ? [record.id, body.length, hash] : [record.id],
  );
  return rows[0] ?? record;
}

export async function listExports(account: Account, docId: string): Promise<Reply> {
  return transaction(async (db) => {
    await documentAccess(db, docId, account, false);
    const { rows } = await db.query<ExportRow>(
      "SELECT * FROM exports WHERE document_id = $1 AND created_by = $2 ORDER BY created_at DESC, id DESC",
      [docId, account.id],
    );
    return json(200, { exports: rows.map(exportJson) });
  });
}

async function ownExport(account: Account, exportId: string): Promise<ExportRow> {
  const [row] = await query<ExportRow>("SELECT * FROM exports WHERE id = $1 AND created_by = $2", [exportId, account.id]);
  if (!row) throw notFound();
  await transaction((db) => documentAccess(db, row.document_id, account, false));
  return row;
}

export async function getExport(account: Account, exportId: string): Promise<Reply> {
  return json(200, { export: exportJson(await ownExport(account, exportId)) });
}

export async function downloadExport(account: Account, exportId: string): Promise<{ body: Buffer; fileName: string }> {
  const record = await ownExport(account, exportId);
  if (record.status !== "ready") throw new ApiError(409, "export_not_ready", "This file is not ready to download.");
  let stored: Buffer | null;
  try {
    stored = await getObject(objectKey(record.document_id, record.id), AbortSignal.timeout(10_000));
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    throw new ApiError(503, "storage_unavailable", "The file store is unreachable.");
  }
  if (!stored || stored.length !== Number(record.byte_size) || digest(stored) !== record.sha256) {
    throw new ApiError(502, "export_corrupt", "The stored file no longer matches this export.");
  }
  return { body: stored, fileName: record.file_name };
}
