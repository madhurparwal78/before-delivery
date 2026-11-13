import type { Cell, CellType } from "../../shared/api";
import { limits } from "../config";
import { query, queryOne } from "../db";
import type { Db } from "../db";
import { conflict, notFound } from "../errors";
import { Context, Problems, defineRoute, reply } from "../http";
import type { Reply } from "../http";
import { getCell, getCells, insertCell, listCells, orderOf, publishCells, renumber, storeWorkingCopy, touch } from "../notebooks";
import { pool } from "../db";
import { markStale, runIndexer } from "../search";
import { CELL_TYPE_MESSAGE } from "../notebook-format";
import { field, inRange, isObject, length, requireTab, SOURCE_MAX } from "../validate";

const CELL_TYPES = ["code", "markdown"];

/** After any change to cells: bump the notebook, queue its search document and tell every open screen. */
export async function changed(ctx: Context, db: Db, ids: string[] | "all", withOrder: boolean): Promise<void> {
  const id = ctx.notebook().id;
  await touch(db, id);
  await markStale(db, id);
  ctx.afterCommit(() => {
    publishCells(id, ids, withOrder);
    void runIndexer();
  });
}

const tabOf = (body: unknown): string => {
  const tab = field(body, "tab_id");
  return typeof tab === "string" ? tab : "";
};

/** 409 cell_locked: one of these cells is being edited by a different tab. */
async function assertUnlocked(db: Db, notebookId: string, ids: string[], tabId: string): Promise<void> {
  const row = await queryOne<{ cell_id: string; holder: string }>(
    db,
    `SELECT l.cell_id, u.display_name AS holder FROM cell_locks l JOIN users u ON u.id = l.user_id
      WHERE l.notebook_id = $1 AND l.cell_id = ANY($2::text[]) AND l.tab_id <> $3
        AND l.last_seen > clock_timestamp() - make_interval(secs => $4) LIMIT 1`,
    [notebookId, ids, tabId, limits.presence_timeout_ms / 1000],
  );
  if (row) throw conflict("cell_locked", `${row.holder} is editing that cell.`, { cell_id: row.cell_id, holder: row.holder });
}

/** 409 stale_revision: the cells whose current revision differs from the one the page holds. */
async function assertFresh(db: Db, notebookId: string, expected: Map<string, unknown>): Promise<void> {
  const current = await getCells(db, notebookId, [...expected.keys()]);
  const stale = current.filter((cell) => expected.get(cell.id) !== cell.revision);
  if (stale.length) throw conflict("stale_revision", "Someone saved this cell after you started editing.", { cells: stale });
}

const idList = (value: unknown): string[] | null =>
  Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string") ? (value as string[]) : null;

async function mustExist(db: Db, notebookId: string, ids: string[]): Promise<void> {
  if (new Set(ids).size !== (await getCells(db, notebookId, ids)).length) throw notFound();
}

const cellCount = async (db: Db, notebookId: string): Promise<number> =>
  Number((await queryOne<{ count: string }>(db, "SELECT count(*) FROM cells WHERE notebook_id = $1", [notebookId]))?.count);

const wholeNotebook = async (db: Db, notebookId: string, status = 200, extra: Record<string, unknown> = {}): Promise<Reply> =>
  reply(status, { cells: await listCells(db, notebookId), ...extra });

/** The path's cell must exist (404). */
const pathCell = async (ctx: Context): Promise<string> => {
  if (!(await getCell(pool, ctx.notebook().id, ctx.params.cellId as string))) throw notFound();
  return ctx.params.cellId as string;
};

// ---- save ----

interface Edit {
  id: string;
  base_revision: number;
  source: string;
  cell_type: CellType;
}

const save = defineRoute<undefined, Edit[]>({
  method: "POST",
  path: "/api/notebooks/:id/save",
  access: "session",
  notebook: "editor",
  write: true,
  body: "json",
  check: async (ctx, _resource, body) => {
    const raw = field(body, "cells");
    const edits = Array.isArray(raw) ? raw.filter(isObject).filter((e) => typeof e.id === "string") : [];
    if (edits.length === 0) return;
    const db = await ctx.transaction();
    const ids = edits.map((edit) => edit.id as string);
    await mustExist(db, ctx.notebook().id, ids);
    await assertUnlocked(db, ctx.notebook().id, ids, tabOf(body));
    await assertFresh(db, ctx.notebook().id, new Map(edits.map((edit) => [edit.id as string, edit.base_revision])));
  },
  validate: (body) => {
    const problems = new Problems();
    requireTab(body, problems);
    const raw = field(body, "cells");
    if (!Array.isArray(raw)) {
      problems.add("cells", "must be an array");
      problems.done();
    }
    const edits = (raw as unknown[]).map((entry, i) => {
      const edit = isObject(entry) ? entry : {};
      if (typeof edit.id !== "string") problems.add(`cells[${i}].id`, "is required");
      if (!inRange(edit.base_revision, 1, Number.MAX_SAFE_INTEGER)) problems.add(`cells[${i}].base_revision`, "must be a whole number of at least 1");
      if (typeof edit.source !== "string" || length(edit.source) > SOURCE_MAX) problems.add(`cells[${i}].source`, "must be at most 1,000,000 characters");
      if (typeof edit.cell_type !== "string" || !CELL_TYPES.includes(edit.cell_type)) problems.add(`cells[${i}].cell_type`, CELL_TYPE_MESSAGE);
      return edit as unknown as Edit;
    });
    problems.done();
    return edits;
  },
  run: async (ctx, _resource, edits) => {
    const db = await ctx.transaction();
    const notebookId = ctx.notebook().id;
    for (const edit of edits) {
      const [current] = await getCells(db, notebookId, [edit.id]) as [Cell];
      if (current.source === edit.source && current.cell_type === edit.cell_type) continue;
      await db.query(
        `UPDATE cells SET source = $3, cell_type = $4, revision = revision + 1,
                execution_count = CASE WHEN $5 THEN NULL ELSE execution_count END,
                outputs = CASE WHEN $5 THEN '[]'::json ELSE outputs END,
                outputs_version = CASE WHEN $5 THEN outputs_version + 1 ELSE outputs_version END,
                run_state = CASE WHEN $5 THEN 'idle' ELSE run_state END
          WHERE notebook_id = $1 AND id = $2`,
        [notebookId, edit.id, edit.source, edit.cell_type, current.cell_type !== edit.cell_type],
      );
    }
    await storeWorkingCopy(db, notebookId);
    const saved = await getCells(db, notebookId, edits.map((edit) => edit.id));
    await changed(ctx, db, edits.map((edit) => edit.id), false);
    return reply(200, { cells: saved });
  },
});

// ---- insert and paste ----

interface Draft {
  cell_type: CellType;
  source: string;
}

function readDraft(entry: unknown, prefix: string, problems: Problems): Draft {
  const draft = isObject(entry) ? entry : {};
  const type = draft.cell_type;
  const source = draft.source ?? "";
  if (typeof type !== "string" || !CELL_TYPES.includes(type)) problems.add(`${prefix}cell_type`, CELL_TYPE_MESSAGE);
  if (typeof source !== "string" || length(source) > SOURCE_MAX) problems.add(`${prefix}source`, "must be at most 1,000,000 characters");
  return { cell_type: type as CellType, source: source as string };
}

async function readPosition(ctx: Context, body: unknown, problems: Problems): Promise<number> {
  const position = field(body, "position");
  const count = await cellCount(await ctx.transaction(), ctx.notebook().id);
  if (!inRange(position, 0, count)) problems.add("position", `must be between 0 and ${count}`);
  return position as number;
}

async function addCells(ctx: Context, position: number, drafts: Draft[]): Promise<Reply> {
  const db = await ctx.transaction();
  const notebookId = ctx.notebook().id;
  const ids: string[] = [];
  for (const [offset, draft] of drafts.entries()) ids.push(await insertCell(db, notebookId, position + offset, draft));
  await changed(ctx, db, ids, true);
  return wholeNotebook(db, notebookId, 201, { new_ids: ids });
}

const insert = defineRoute<undefined, { position: number; draft: Draft }>({
  method: "POST",
  path: "/api/notebooks/:id/cells",
  access: "session",
  notebook: "editor",
  write: true,
  body: "json",
  validate: async (body, _resource, ctx) => {
    const problems = new Problems();
    const position = await readPosition(ctx, body, problems);
    const draft = readDraft(body, "", problems);
    problems.done();
    return { position, draft };
  },
  run: (ctx, _resource, { position, draft }) => addCells(ctx, position, [draft]),
});

const paste = defineRoute<undefined, { position: number; drafts: Draft[] }>({
  method: "POST",
  path: "/api/notebooks/:id/cells/paste",
  access: "session",
  notebook: "editor",
  write: true,
  body: "json",
  validate: async (body, _resource, ctx) => {
    const problems = new Problems();
    const position = await readPosition(ctx, body, problems);
    const raw = field(body, "cells");
    if (!Array.isArray(raw) || raw.length === 0) problems.add("cells", "must be a list of at least one cell");
    const drafts = (Array.isArray(raw) ? raw : []).map((entry, i) => readDraft(entry, `cells[${i}].`, problems));
    problems.done();
    return { position, drafts };
  },
  run: (ctx, _resource, { position, drafts }) => addCells(ctx, position, drafts),
});

// ---- delete and restore ----

const remove = defineRoute<undefined, string[]>({
  method: "POST",
  path: "/api/notebooks/:id/cells/delete",
  access: "session",
  notebook: "editor",
  write: true,
  body: "json",
  check: async (ctx, _resource, body) => {
    const ids = idList(field(body, "ids"));
    if (ids) await assertUnlocked(await ctx.transaction(), ctx.notebook().id, ids, tabOf(body));
  },
  validate: async (body, _resource, ctx) => {
    const problems = new Problems();
    requireTab(body, problems);
    const ids = idList(field(body, "ids"));
    if (!ids || new Set(ids).size !== (await getCells(await ctx.transaction(), ctx.notebook().id, ids)).length) {
      problems.add("ids", "must name cells of this notebook");
    }
    problems.done();
    return ids as string[];
  },
  run: async (ctx, _resource, ids) => {
    const db = await ctx.transaction();
    const notebookId = ctx.notebook().id;
    const before = await orderOf(db, notebookId);
    for (const id of before.filter((x) => ids.includes(x))) {
      await db.query(
        `INSERT INTO deleted_cells (notebook_id, id, position, payload)
         SELECT notebook_id, id, $3, row_to_json(cells) FROM cells WHERE notebook_id = $1 AND id = $2
         ON CONFLICT (notebook_id, id) DO UPDATE SET position = $3, payload = EXCLUDED.payload, seq = nextval('deleted_cells_seq_seq')`,
        [notebookId, id, before.indexOf(id)],
      );
    }
    await db.query("DELETE FROM cells WHERE notebook_id = $1 AND id = ANY($2::text[])", [notebookId, ids]);
    const left = before.filter((id) => !ids.includes(id));
    if (left.length === 0) await insertCell(db, notebookId, 0, { cell_type: "code", source: "" });
    else await renumber(db, notebookId, left);
    await changed(ctx, db, "all", true);
    return wholeNotebook(db, notebookId);
  },
});

interface DeletedRow {
  id: string;
  position: number;
  payload: Cell & { metadata: Record<string, unknown> };
}

const restore = defineRoute<undefined, string[]>({
  method: "POST",
  path: "/api/notebooks/:id/cells/restore",
  access: "session",
  notebook: "editor",
  write: true,
  body: "json",
  check: async (ctx, _resource, body) => {
    const ids = idList(field(body, "ids"));
    if (!ids) return;
    const found = await query(await ctx.transaction(), "SELECT id FROM deleted_cells WHERE notebook_id = $1 AND id = ANY($2::text[])", [ctx.notebook().id, ids]);
    if (new Set(ids).size !== found.length) throw conflict("not_deleted", "Those cells were not deleted.");
  },
  validate: (body) => {
    const ids = idList(field(body, "ids"));
    if (!ids) {
      const problems = new Problems();
      problems.add("ids", "must be a list of cell ids");
      problems.done();
    }
    return ids as string[];
  },
  run: async (ctx, _resource, ids) => {
    const db = await ctx.transaction();
    const notebookId = ctx.notebook().id;
    const rows = await query<DeletedRow>(db, "SELECT id, position, payload FROM deleted_cells WHERE notebook_id = $1 AND id = ANY($2::text[]) ORDER BY position, seq", [notebookId, ids]);
    for (const row of rows) {
      const at = Math.min(row.position, await cellCount(db, notebookId));
      await db.query("UPDATE cells SET position = position + 1 WHERE notebook_id = $1 AND position >= $2", [notebookId, at]);
      const cell = row.payload;
      await db.query(
        `INSERT INTO cells (notebook_id, id, position, cell_type, source, revision, execution_count, run_state, outputs, outputs_version, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [notebookId, row.id, at, cell.cell_type, cell.source, cell.revision, cell.execution_count, cell.run_state, JSON.stringify(cell.outputs), cell.outputs_version, JSON.stringify(cell.metadata)],
      );
    }
    await db.query("DELETE FROM deleted_cells WHERE notebook_id = $1 AND id = ANY($2::text[])", [notebookId, ids]);
    await changed(ctx, db, "all", true);
    return wholeNotebook(db, notebookId);
  },
});

// ---- move, split, merge ----

const move = defineRoute<string, number>({
  method: "POST",
  path: "/api/notebooks/:id/cells/:cellId/move",
  access: "session",
  notebook: "editor",
  write: true,
  resolve: pathCell,
  body: "json",
  check: async (ctx, cellId, body) => assertUnlocked(await ctx.transaction(), ctx.notebook().id, [cellId], tabOf(body)),
  validate: async (body, _cellId, ctx) => {
    const problems = new Problems();
    requireTab(body, problems);
    const count = await cellCount(await ctx.transaction(), ctx.notebook().id);
    const position = field(body, "position");
    if (!inRange(position, 0, count - 1)) problems.add("position", `must be between 0 and ${count - 1}`);
    problems.done();
    return position as number;
  },
  run: async (ctx, cellId, position) => {
    const db = await ctx.transaction();
    const order = (await orderOf(db, ctx.notebook().id)).filter((id) => id !== cellId);
    order.splice(position, 0, cellId);
    await renumber(db, ctx.notebook().id, order);
    await changed(ctx, db, "all", true);
    return wholeNotebook(db, ctx.notebook().id);
  },
});

const split = defineRoute<string, number>({
  method: "POST",
  path: "/api/notebooks/:id/cells/:cellId/split",
  access: "session",
  notebook: "editor",
  write: true,
  resolve: pathCell,
  body: "json",
  check: async (ctx, cellId, body) => {
    const db = await ctx.transaction();
    await assertUnlocked(db, ctx.notebook().id, [cellId], tabOf(body));
    await assertFresh(db, ctx.notebook().id, new Map([[cellId, field(body, "base_revision")]]));
  },
  validate: async (body, cellId, ctx) => {
    const problems = new Problems();
    requireTab(body, problems);
    const cell = (await getCell(await ctx.transaction(), ctx.notebook().id, cellId)) as Cell;
    const lines = cell.source.split("\n").length;
    const line = field(body, "line");
    if (!inRange(line, 2, lines)) problems.add("line", `must be between 2 and ${lines}`);
    problems.done();
    return line as number;
  },
  run: async (ctx, cellId, line) => {
    const db = await ctx.transaction();
    const notebookId = ctx.notebook().id;
    const cell = (await getCell(db, notebookId, cellId)) as Cell;
    const lines = cell.source.split("\n");
    await db.query(
      `UPDATE cells SET source = $3, revision = revision + 1, execution_count = NULL, outputs = '[]'::json,
              outputs_version = outputs_version + 1, run_state = 'idle' WHERE notebook_id = $1 AND id = $2`,
      [notebookId, cellId, lines.slice(0, line - 1).join("\n")],
    );
    const lower = await insertCell(db, notebookId, cell.position + 1, { cell_type: cell.cell_type, source: lines.slice(line - 1).join("\n") });
    await changed(ctx, db, "all", true);
    return wholeNotebook(db, notebookId, 200, { new_ids: [lower] });
  },
});

const merge = defineRoute<undefined, string[]>({
  method: "POST",
  path: "/api/notebooks/:id/cells/merge",
  access: "session",
  notebook: "editor",
  write: true,
  body: "json",
  check: async (ctx, _resource, body) => {
    const ids = idList(field(body, "ids"));
    if (!ids) return;
    const db = await ctx.transaction();
    await mustExist(db, ctx.notebook().id, ids);
    await assertUnlocked(db, ctx.notebook().id, ids, tabOf(body));
    const bases = field(body, "base_revisions");
    await assertFresh(db, ctx.notebook().id, new Map(ids.map((id) => [id, isObject(bases) ? bases[id] : undefined])));
  },
  validate: async (body, _resource, ctx) => {
    const problems = new Problems();
    requireTab(body, problems);
    const ids = idList(field(body, "ids"));
    const cells = ids ? await getCells(await ctx.transaction(), ctx.notebook().id, ids) : [];
    const adjacent =
      ids !== null && ids.length >= 2 && cells.length === ids.length && cells.every((cell, i) => cell.id === ids[i] && (i === 0 || cell.position === (cells[i - 1] as Cell).position + 1));
    if (!adjacent) problems.add("ids", "must be two or more adjacent cells in order");
    else if (new Set(cells.map((cell) => cell.cell_type)).size > 1) problems.add("ids", "must all be the same cell type");
    problems.done();
    return ids as string[];
  },
  run: async (ctx, _resource, ids) => {
    const db = await ctx.transaction();
    const notebookId = ctx.notebook().id;
    const cells = await getCells(db, notebookId, ids);
    const first = ids[0] as string;
    await db.query(
      `UPDATE cells SET source = $3, revision = revision + 1, execution_count = NULL, outputs = '[]'::json,
              outputs_version = outputs_version + 1, run_state = 'idle' WHERE notebook_id = $1 AND id = $2`,
      [notebookId, first, cells.map((cell) => cell.source).join("\n")],
    );
    await db.query("DELETE FROM cells WHERE notebook_id = $1 AND id = ANY($2::text[])", [notebookId, ids.slice(1)]);
    await renumber(db, notebookId, await orderOf(db, notebookId));
    await changed(ctx, db, "all", true);
    return wholeNotebook(db, notebookId);
  },
});

// ---- locks ----

const lock = defineRoute<string, string>({
  method: "POST",
  path: "/api/notebooks/:id/cells/:cellId/lock",
  access: "session",
  notebook: "editor",
  write: true,
  resolve: pathCell,
  body: "json",
  validate: (body) => {
    const problems = new Problems();
    const tab = requireTab(body, problems);
    problems.done();
    return tab;
  },
  run: async (ctx, cellId, tab) => {
    const db = await ctx.transaction();
    const notebookId = ctx.notebook().id;
    await assertUnlocked(db, notebookId, [cellId], tab);
    await db.query(
      `INSERT INTO cell_locks (notebook_id, cell_id, tab_id, user_id, last_seen)
       VALUES ($1, $2, $3, $4, COALESCE((SELECT last_seen FROM presence WHERE notebook_id = $1 AND tab_id = $3), clock_timestamp()))
       ON CONFLICT (notebook_id, cell_id) DO UPDATE SET tab_id = $3, user_id = $4, last_seen = EXCLUDED.last_seen`,
      [notebookId, cellId, tab, ctx.me().id],
    );
    ctx.afterCommit(() => publishCells(notebookId, [cellId], false));
    return reply(200, { cell_id: cellId, holder: ctx.me().display_name });
  },
});

const unlock = defineRoute<string, string>({
  method: "DELETE",
  path: "/api/notebooks/:id/cells/:cellId/lock",
  access: "session",
  notebook: "editor",
  write: true,
  resolve: pathCell,
  body: "json",
  validate: (body) => {
    const problems = new Problems();
    const tab = requireTab(body, problems);
    problems.done();
    return tab;
  },
  run: async (ctx, cellId, tab) => {
    const db = await ctx.transaction();
    const notebookId = ctx.notebook().id;
    const released = await db.query("DELETE FROM cell_locks WHERE notebook_id = $1 AND cell_id = $2 AND tab_id = $3", [notebookId, cellId, tab]);
    if (released.rowCount) ctx.afterCommit(() => publishCells(notebookId, [cellId], false));
    return reply(204);
  },
});

export const cellRoutes = [save, insert, paste, remove, restore, move, split, merge, lock, unlock];
