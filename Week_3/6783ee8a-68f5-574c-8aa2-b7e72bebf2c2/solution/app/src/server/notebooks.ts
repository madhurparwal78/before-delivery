import { randomBytes } from "node:crypto";
import type { Cell, CellType, KernelStatus, LiveEvent, Notebook, Output, Present, RunState } from "../shared/api";
import { limits } from "./config";
import { pool, query, queryOne } from "./db";
import type { Db } from "./db";
import { publish } from "./live";
import type { Access } from "./http";
import { putObject } from "./storage";

interface CellRow {
  id: string;
  position: number;
  cell_type: CellType;
  source: string;
  revision: number;
  execution_count: number | null;
  run_state: RunState;
  outputs: Output[];
  outputs_version: number;
  metadata: Record<string, unknown>;
  locked_by: string | null;
}

const CELL_SELECT = `
  SELECT c.id, c.position, c.cell_type, c.source, c.revision, c.execution_count, c.run_state, c.outputs,
         c.outputs_version, c.metadata, u.display_name AS locked_by
    FROM cells c
    LEFT JOIN cell_locks l ON l.notebook_id = c.notebook_id AND l.cell_id = c.id
         AND l.last_seen > clock_timestamp() - make_interval(secs => $2)
    LEFT JOIN users u ON u.id = l.user_id`;

const lockSeconds = (): number => limits.presence_timeout_ms / 1000;

export const newCellId = (): string => `c-${randomBytes(8).toString("hex")}`;

export async function listCells(db: Db, notebookId: string): Promise<Cell[]> {
  return query<CellRow>(db, `${CELL_SELECT} WHERE c.notebook_id = $1 ORDER BY c.position`, [notebookId, lockSeconds()]);
}

export async function getCell(db: Db, notebookId: string, cellId: string): Promise<Cell | null> {
  return queryOne<CellRow>(db, `${CELL_SELECT} WHERE c.notebook_id = $1 AND c.id = ANY($3::text[])`, [notebookId, lockSeconds(), [cellId]]);
}

export async function getCells(db: Db, notebookId: string, ids: string[]): Promise<Cell[]> {
  return query<CellRow>(db, `${CELL_SELECT} WHERE c.notebook_id = $1 AND c.id = ANY($3::text[]) ORDER BY c.position`, [
    notebookId,
    lockSeconds(),
    ids,
  ]);
}

/** The status every screen shows: busy while any tab is busy, otherwise the most recent report. */
export async function kernelStatus(db: Db, notebookId: string): Promise<KernelStatus> {
  const rows = await query<{ status: KernelStatus }>(db, "SELECT status FROM kernel_tabs WHERE notebook_id = $1 ORDER BY updated_at DESC", [notebookId]);
  if (rows.some((row) => row.status === "busy")) return "busy";
  return rows[0]?.status ?? "idle";
}

export async function loadNotebook(db: Db, access: Access): Promise<Notebook | null> {
  const row = await queryOne<{ id: string; title: string; imported: boolean; execution_counter: number; owner_display_name: string }>(
    db,
    `SELECT n.id, n.title, n.imported, n.execution_counter, u.display_name AS owner_display_name
       FROM notebooks n JOIN users u ON u.id = n.owner_id WHERE n.id = $1`,
    [access.id],
  );
  if (!row) return null;
  return { ...row, role: access.role, kernel_status: await kernelStatus(db, access.id), cells: await listCells(db, access.id) };
}

export async function touch(db: Db, notebookId: string): Promise<void> {
  await db.query("UPDATE notebooks SET modified_at = now() WHERE id = $1", [notebookId]);
}

/** Writes the whole order: position follows the position in `order`. */
export async function renumber(db: Db, notebookId: string, order: string[]): Promise<void> {
  await db.query(
    `UPDATE cells SET position = o.pos FROM unnest($2::text[], $3::int[]) AS o(id, pos)
      WHERE cells.notebook_id = $1 AND cells.id = o.id`,
    [notebookId, order, order.map((_, index) => index)],
  );
}

export async function orderOf(db: Db, notebookId: string): Promise<string[]> {
  return (await query<{ id: string }>(db, "SELECT id FROM cells WHERE notebook_id = $1 ORDER BY position", [notebookId])).map((r) => r.id);
}

/** What a cell starts as when it arrives with outputs and a count (a seed, an import, a revert). */
export function runStateOf(outputs: Output[], count: number | null): RunState {
  if (outputs.some((output) => output.output_type === "error")) return "failed";
  return count === null ? "idle" : "finished";
}

export interface NewCell {
  id?: string;
  cell_type: CellType;
  source: string;
  outputs?: Output[];
  execution_count?: number | null;
  metadata?: Record<string, unknown>;
}

/** Inserts a cell at a 0-based position, shifting the cells below it. */
export async function insertCell(db: Db, notebookId: string, position: number, cell: NewCell): Promise<string> {
  const id = cell.id ?? newCellId();
  const outputs = cell.cell_type === "code" ? (cell.outputs ?? []) : [];
  const count = cell.cell_type === "code" ? (cell.execution_count ?? null) : null;
  await db.query("UPDATE cells SET position = position + 1 WHERE notebook_id = $1 AND position >= $2", [notebookId, position]);
  await db.query(
    `INSERT INTO cells (notebook_id, id, position, cell_type, source, execution_count, run_state, outputs, outputs_version, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [notebookId, id, position, cell.cell_type, cell.source, count, runStateOf(outputs, count), JSON.stringify(outputs), outputs.length ? 1 : 0, JSON.stringify(cell.metadata ?? {})],
  );
  return id;
}

export interface ExportCell {
  id: string;
  cell_type: CellType;
  source: string;
  metadata: Record<string, unknown>;
  execution_count?: number | null;
  outputs?: Output[];
}

export interface ExportDocument {
  nbformat: 4;
  nbformat_minor: 5;
  metadata: Record<string, unknown>;
  cells: ExportCell[];
}

/** The export format: what a checkpoint, a working copy and an export file all store. */
export function exportDocument(cells: Cell[]): ExportDocument {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: "brackenpad-js", display_name: "JavaScript (Brackenpad)", language: "javascript" },
      language_info: { name: "javascript" },
    },
    cells: cells.map((cell) =>
      cell.cell_type === "code"
        ? { id: cell.id, cell_type: "code", source: cell.source, metadata: cell.metadata, execution_count: cell.execution_count, outputs: cell.outputs }
        : { id: cell.id, cell_type: "markdown", source: cell.source, metadata: cell.metadata },
    ),
  };
}

export const encodeDocument = (document: ExportDocument): Buffer => Buffer.from(JSON.stringify(document), "utf8");

const workingCopyKey = (notebookId: string): string => `notebooks/${notebookId}/working.json`;

/** Rewrites the working copy in MinIO; a failure here makes the save fail before it commits. */
export async function storeWorkingCopy(db: Db, notebookId: string): Promise<void> {
  await putObject(workingCopyKey(notebookId), encodeDocument(exportDocument(await listCells(db, notebookId))));
}

// ---- live publishing: after a commit, current rows go to every open screen, one notebook at a time ----

const queues = new Map<string, Promise<void>>();

function inOrder(notebookId: string, job: () => Promise<void>): void {
  const next = (queues.get(notebookId) ?? Promise.resolve()).then(job).catch((error) => console.error("live publish failed:", error));
  queues.set(notebookId, next);
  void next.then(() => {
    if (queues.get(notebookId) === next) queues.delete(notebookId);
  });
}

/** Sends the named cells (or all of them) and, when the order changed, the whole order. */
export function publishCells(notebookId: string, ids: string[] | "all", withOrder: boolean): void {
  inOrder(notebookId, async () => {
    const order = withOrder ? await orderOf(pool, notebookId) : undefined;
    const cells = ids === "all" ? await listCells(pool, notebookId) : await getCells(pool, notebookId, ids);
    publish(notebookId, { type: "cells", ...(order ? { order } : {}), cells });
  });
}

/** Sends an event after the ones published before it; use for anything whose value was decided at commit time. */
export function publishInOrder(notebookId: string, event: LiveEvent): void {
  inOrder(notebookId, async () => publish(notebookId, event));
}

export function publishKernel(notebookId: string, status: KernelStatus): void {
  publishInOrder(notebookId, { type: "kernel", kernel_status: status });
}

export async function presentIn(db: Db, notebookId: string): Promise<Present[]> {
  return query<Present>(
    db,
    `SELECT p.tab_id, p.user_id, u.display_name, p.cell_id
       FROM presence p JOIN users u ON u.id = p.user_id
      WHERE p.notebook_id = $1 AND p.last_seen > clock_timestamp() - make_interval(secs => $2)
      ORDER BY p.last_seen`,
    [notebookId, lockSeconds()],
  );
}

export function publishPresence(notebookId: string): void {
  inOrder(notebookId, async () => publish(notebookId, { type: "presence", present: await presentIn(pool, notebookId) }));
}

export function publishCheckpoints(notebookId: string): void {
  publish(notebookId, { type: "checkpoints" });
}
