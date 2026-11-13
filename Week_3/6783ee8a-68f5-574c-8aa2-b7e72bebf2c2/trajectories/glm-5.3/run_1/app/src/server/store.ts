import type { PoolClient } from "pg";
import { one, query, withTransaction } from "./db.ts";
import { newId } from "./identity.ts";
import { publish, publishLocks, publishPresence } from "./live.ts";
import * as s3 from "./s3.ts";
import { syncDoc, forgetPending, deleteDoc, type SearchDoc } from "./meili.ts";
import type { Cell, CellType, Output, Role } from "../shared/types.ts";
import { snapshotFromCells } from "./shapes.ts";
import type { CellRow } from "./shapes.ts";
import { ApiError } from "./http.ts";

const CELL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type Access = { notebookId: string; role: Role };

/** Error precedence in one place: unknown notebook or no access answers 404, a lesser role answers 403. */
export async function requireAccess(notebookId: string, userId: string, need: Role[]): Promise<Access> {
  const row = await one<{ role: Role | null }>(
    `SELECT CASE WHEN n.owner_id = $2 THEN 'owner' ELSE s.role END AS role
     FROM notebooks n LEFT JOIN shares s ON s.notebook_id = n.id AND s.user_id = $2 AND s.status = 'active'
     WHERE n.id = $1`,
    [notebookId, userId],
  );
  if (row === null) throw new ApiError(404, "not_found", "Notebook not found.");
  if (row.role === null) throw new ApiError(404, "not_found", "Notebook not found.");
  if (!need.includes(row.role)) throw new ApiError(403, "forbidden", "Your role does not allow this.");
  return { notebookId, role: row.role };
}

export async function loadCells(notebookId: string): Promise<CellRow[]> {
  const result = await query<{
    id: string;
    position: number;
    cell_type: string;
    source: string;
    revision: number;
    execution_count: number | null;
    run_state: string;
    outputs: unknown;
    outputs_version: number;
    metadata: unknown;
    locked_by: string | null;
  }>(
    `SELECT c.id, c.position, c.cell_type, c.source, c.revision, c.execution_count, c.run_state, c.outputs, c.outputs_version, c.metadata,
            l.holder_display_name AS locked_by
     FROM cells c
     LEFT JOIN locks l ON l.notebook_id = c.notebook_id AND l.cell_id = c.id
     WHERE c.notebook_id = $1
     ORDER BY c.position`,
    [notebookId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    position: row.position,
    cell_type: row.cell_type as CellType,
    source: row.source,
    revision: row.revision,
    execution_count: row.execution_count,
    run_state: row.run_state as CellRow["run_state"],
    outputs: (row.outputs ?? []) as Output[],
    outputs_version: row.outputs_version,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    locked_by: row.locked_by,
  }));
}

export async function notebookKernelStatus(notebookId: string): Promise<string> {
  const busy = await one<{ count: string }>(
    "SELECT count(*) AS count FROM kernel_reports WHERE notebook_id = $1 AND status = 'busy'",
    [notebookId],
  );
  if (busy !== null && Number(busy.count) > 0) return "busy";
  const latest = await one<{ status: string }>(
    "SELECT status FROM kernel_reports WHERE notebook_id = $1 ORDER BY reported_at DESC LIMIT 1",
    [notebookId],
  );
  return latest?.status ?? "idle";
}

/** The working copy is rewritten by every successful save, before it commits. */
export async function pushWorkingCopy(notebookId: string): Promise<boolean> {
  const cells = await loadCells(notebookId);
  const snapshot = snapshotFromCells(cells, {
    kernelspec: { name: "brackenpad-js", display_name: "JavaScript (Brackenpad)", language: "javascript" },
    language_info: { name: "javascript" },
  });
  return s3.put(s3.workingKey(notebookId), Buffer.from(JSON.stringify(snapshot, null, 1), "utf8"), "application/json");
}

export async function searchDocFor(notebookId: string): Promise<SearchDoc | null> {
  const meta = await one<{ title: string; owner_id: string }>(
    "SELECT title, owner_id FROM notebooks WHERE id = $1",
    [notebookId],
  );
  if (meta === null) return null;
  const readers = await query<{ user_id: string }>(
    "SELECT owner_id AS user_id FROM notebooks WHERE id = $1 UNION SELECT user_id FROM shares WHERE notebook_id = $1 AND status = 'active'",
    [notebookId],
  );
  const cells = await loadCells(notebookId);
  const sources = cells.map((c) => c.source).filter((s) => s !== "");
  const headings = cells.flatMap((c) => (c.cell_type === "markdown" ? headingTexts(c.source) : []));
  return {
    id: notebookId,
    title: meta.title,
    cells: sources,
    headings,
    reader_ids: readers.rows.map((r) => r.user_id),
  };
}

function headingTexts(source: string): string[] {
  const lines = source.split("\n");
  const texts: string[] = [];
  let inCode = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match !== null) texts.push(match[2].trim());
  }
  return texts;
}

export async function syncSearch(notebookId: string): Promise<boolean> {
  const doc = await searchDocFor(notebookId);
  if (doc === null) return true;
  const ok = await syncDoc(doc);
  await query("UPDATE notebooks SET search_synced = $2 WHERE id = $1", [notebookId, ok]);
  return ok;
}

export function dropSearch(notebookId: string): Promise<boolean> {
  forgetPending(notebookId);
  return deleteDoc(notebookId);
}

export async function publishCells(notebookId: string): Promise<void> {
  const cells = await loadCells(notebookId);
  const mapped = cells.map((cell, index) => ({ ...cell, position: index, locked_by: cell.locked_by }));
  publish(notebookId, { type: "cells", cells: mapped.map(serializeCell) });
}

export function serializeCell(cell: CellRow): Cell {
  return {
    id: cell.id,
    position: cell.position,
    cell_type: cell.cell_type,
    source: cell.source,
    revision: cell.revision,
    execution_count: cell.execution_count,
    run_state: cell.run_state,
    outputs: cell.outputs,
    outputs_version: cell.outputs_version,
    metadata: cell.metadata,
    locked_by: cell.locked_by,
  };
}

export async function insertCell(
  client: PoolClient,
  notebookId: string,
  position: number,
  cellType: CellType,
  source: string,
): Promise<string> {
  const id = newId("c");
  await client.query(
    "INSERT INTO cells (notebook_id, id, position, cell_type, source) VALUES ($1, $2, $3, $4, $5)",
    [notebookId, id, position, cellType, source],
  );
  await normalizePositions(client, notebookId);
  return id;
}

/** One server-ordered sequence per notebook is kept here. */
export async function normalizePositions(client: PoolClient, notebookId: string): Promise<void> {
  const result = await client.query<{ id: string; position: number }>(
    "SELECT id, position FROM cells WHERE notebook_id = $1 ORDER BY position, id",
    [notebookId],
  );
  let index = 0;
  for (const row of result.rows) {
    if (row.position !== index) {
      await client.query("UPDATE cells SET position = $3 WHERE notebook_id = $1 AND id = $2", [notebookId, row.id, index]);
    }
    index += 1;
  }
}

export async function cellsInOrder(client: PoolClient, notebookId: string): Promise<CellRow[]> {
  const result = await client.query<Record<string, unknown>>(
    "SELECT id, position, cell_type, source, revision, execution_count, run_state, outputs, outputs_version, metadata FROM cells WHERE notebook_id = $1 ORDER BY position",
    [notebookId],
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    position: row.position as number,
    cell_type: row.cell_type as CellType,
    source: row.source as string,
    revision: row.revision as number,
    execution_count: (row.execution_count as number | null) ?? null,
    run_state: row.run_state as CellRow["run_state"],
    outputs: (row.outputs as Output[]) ?? [],
    outputs_version: row.outputs_version as number,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    locked_by: null,
  }));
}

export async function publishAfterStructural(notebookId: string): Promise<void> {
  await publishCells(notebookId);
  // The search index is refreshed in the background; results are filtered by access
  // at read time, so a notebook is simply not searchable until the index catches up.
  void syncSearch(notebookId);
}

export { CELL_ID_RE, withTransaction, publishLocks, publishPresence };
