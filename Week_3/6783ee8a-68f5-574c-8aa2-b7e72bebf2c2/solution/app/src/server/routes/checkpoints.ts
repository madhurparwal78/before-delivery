import type { Cell, Checkpoint, CompareResult } from "../../shared/api";
import { joinSource } from "../notebook-format";
import { query, queryOne, pool } from "../db";
import type { Db } from "../db";
import { notFound } from "../errors";
import { Context, Problems, defineRoute, reply } from "../http";
import { compareNotebooks } from "../compare";
import { encodeDocument, exportDocument, getCell, listCells, publishCheckpoints, runStateOf } from "../notebooks";
import type { ExportDocument } from "../notebooks";
import { newId } from "../session";
import { deleteObject, getObject, putObject, StorageUnavailable } from "../storage";
import { limits } from "../config";
import { field, length } from "../validate";
import { changed } from "./cells";

const keyOf = (notebookId: string, checkpointId: string): string => `notebooks/${notebookId}/checkpoints/${checkpointId}.json`;

/** Stores a snapshot in MinIO, then lists it. A checkpoint exists only after the put succeeded. The oldest beyond the limit go. */
export async function storeCheckpoint(db: Db, notebookId: string, label: string | null, document: ExportDocument): Promise<Checkpoint> {
  const seq = await queryOne<{ checkpoint_seq: number }>(db, "UPDATE notebooks SET checkpoint_seq = checkpoint_seq + 1 WHERE id = $1 RETURNING checkpoint_seq", [notebookId]);
  const number = (seq as { checkpoint_seq: number }).checkpoint_seq;
  const id = newId("cp");
  await putObject(keyOf(notebookId, id), encodeDocument(document));
  const row = await queryOne<Checkpoint>(
    db,
    `INSERT INTO checkpoints (id, notebook_id, number, label) VALUES ($1, $2, $3, $4)
     RETURNING id, number, label, created_at, 'saved' AS status`,
    [id, notebookId, number, label ?? `Checkpoint ${number}`],
  );
  const dropped = await query<{ id: string }>(
    db,
    `DELETE FROM checkpoints WHERE notebook_id = $1 AND id IN
       (SELECT id FROM checkpoints WHERE notebook_id = $1 ORDER BY number DESC OFFSET $2) RETURNING id`,
    [notebookId, limits.checkpoints_kept],
  );
  for (const old of dropped) await deleteObject(keyOf(notebookId, old.id)).catch(() => undefined);
  return row as Checkpoint;
}

const checkpointsOf = (db: Db, notebookId: string): Promise<Checkpoint[]> =>
  query<Checkpoint>(db, "SELECT id, number, label, created_at, 'saved' AS status FROM checkpoints WHERE notebook_id = $1 ORDER BY number DESC", [notebookId]);

/** The snapshot's cells in the shape the API returns them. */
function snapshotCells(document: ExportDocument): Cell[] {
  return document.cells.map((cell, position) => {
    const outputs = cell.outputs ?? [];
    const count = cell.execution_count ?? null;
    return {
      id: cell.id,
      position,
      cell_type: cell.cell_type,
      source: joinSource(cell.source),
      revision: 1,
      execution_count: count,
      run_state: runStateOf(outputs, count),
      outputs,
      outputs_version: 0,
      metadata: cell.metadata ?? {},
      locked_by: null,
    };
  });
}

async function loadSnapshot(notebookId: string, checkpointId: string): Promise<Cell[]> {
  const bytes = await getObject(keyOf(notebookId, checkpointId));
  if (!bytes) throw new StorageUnavailable("checkpoint object is missing");
  return snapshotCells(JSON.parse(bytes.toString("utf8")) as ExportDocument);
}

const pathCheckpoint = async (ctx: Context): Promise<Checkpoint> => {
  const row = await queryOne<Checkpoint>(pool, "SELECT id, number, label, created_at, 'saved' AS status FROM checkpoints WHERE id = $1 AND notebook_id = $2", [
    ctx.params.cpId,
    ctx.notebook().id,
  ]);
  if (!row) throw notFound();
  return row;
};

const list = defineRoute({
  method: "GET",
  path: "/api/notebooks/:id/checkpoints",
  access: "session",
  notebook: "viewer",
  run: async (ctx) => reply(200, { checkpoints: await checkpointsOf(pool, ctx.notebook().id) }),
});

const create = defineRoute<undefined, string | null>({
  method: "POST",
  path: "/api/notebooks/:id/checkpoints",
  access: "session",
  notebook: "editor",
  write: true,
  body: "json",
  validate: (body) => {
    const label = field(body, "label");
    if (label !== undefined && label !== null && (typeof label !== "string" || length(label) < 1 || length(label) > 60)) {
      const problems = new Problems();
      problems.add("label", "must be 1 to 60 characters");
      problems.done();
    }
    return typeof label === "string" ? label : null;
  },
  run: async (ctx, _resource, label) => {
    const db = await ctx.transaction();
    const checkpoint = await storeCheckpoint(db, ctx.notebook().id, label, exportDocument(await listCells(db, ctx.notebook().id)));
    ctx.afterCommit(() => publishCheckpoints(ctx.notebook().id));
    return reply(201, { checkpoint });
  },
});

const compare = defineRoute<Checkpoint>({
  method: "GET",
  path: "/api/notebooks/:id/checkpoints/:cpId/compare",
  access: "session",
  notebook: "viewer",
  resolve: pathCheckpoint,
  run: async (ctx, checkpoint) => {
    const result: CompareResult = compareNotebooks(await loadSnapshot(ctx.notebook().id, checkpoint.id), await listCells(pool, ctx.notebook().id));
    return reply(200, result);
  },
});

interface Loaded {
  cells?: Cell[];
  failure?: unknown;
}
const loaded = new WeakMap<Context, Loaded>();

const revert = defineRoute<Checkpoint, string | null>({
  method: "POST",
  path: "/api/notebooks/:id/checkpoints/:cpId/revert",
  access: "session",
  notebook: "editor",
  write: true,
  resolve: pathCheckpoint,
  body: "json",
  check: async (ctx, checkpoint) => {
    loaded.set(ctx, await loadSnapshot(ctx.notebook().id, checkpoint.id).then((cells) => ({ cells }), (failure) => ({ failure })));
  },
  validate: async (body, _checkpoint, ctx) => {
    const cellId = field(body, "cell_id");
    const snapshot = loaded.get(ctx)?.cells;
    if (cellId !== undefined && cellId !== null && snapshot) {
      const current = typeof cellId === "string" ? await getCell(await ctx.transaction(), ctx.notebook().id, cellId) : null;
      if (typeof cellId !== "string" || (!current && !snapshot.some((cell) => cell.id === cellId))) {
        const problems = new Problems();
        problems.add("cell_id", "is in neither version");
        problems.done();
      }
    }
    return typeof cellId === "string" ? cellId : null;
  },
  run: async (ctx, _checkpoint, cellId) => {
    const found = loaded.get(ctx) as Loaded;
    if (!found.cells) throw found.failure;
    const target = found.cells;
    const db = await ctx.transaction();
    const notebookId = ctx.notebook().id;
    const current = await listCells(db, notebookId);
    const beforeRevert = await storeCheckpoint(db, notebookId, "Before revert", exportDocument(current));
    const previous = new Map(current.map((cell) => [cell.id, cell]));
    const write = async (cell: Cell, position: number): Promise<void> => {
      const old = previous.get(cell.id);
      await db.query("UPDATE cells SET position = position + 1 WHERE notebook_id = $1 AND position >= $2", [notebookId, position]);
      await db.query(
        `INSERT INTO cells (notebook_id, id, position, cell_type, source, revision, execution_count, run_state, outputs, outputs_version, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [notebookId, cell.id, position, cell.cell_type, cell.source, (old?.revision ?? 0) + 1, cell.execution_count, cell.run_state, JSON.stringify(cell.outputs), (old?.outputs_version ?? 0) + 1, JSON.stringify(cell.metadata)],
      );
    };
    if (cellId === null) {
      await db.query("DELETE FROM cells WHERE notebook_id = $1", [notebookId]);
      for (const [position, cell] of target.entries()) await write(cell, position);
    } else {
      const wanted = target.find((cell) => cell.id === cellId);
      const here = previous.get(cellId);
      const at = here ? here.position : Math.min(target.findIndex((cell) => cell.id === cellId), current.length);
      if (here) {
        await db.query("DELETE FROM cells WHERE notebook_id = $1 AND id = $2", [notebookId, cellId]);
        await db.query("UPDATE cells SET position = position - 1 WHERE notebook_id = $1 AND position > $2", [notebookId, here.position]);
      }
      if (wanted) await write(wanted, at);
    }
    await changed(ctx, db, "all", true);
    ctx.afterCommit(() => publishCheckpoints(notebookId));
    return reply(200, { before_revert: beforeRevert, cells: await listCells(db, notebookId) });
  },
});

export const checkpointRoutes = [list, create, compare, revert];
