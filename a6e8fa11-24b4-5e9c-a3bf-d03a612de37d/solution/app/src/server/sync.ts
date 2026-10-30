// Op batch sync (API · Sync; Business rules · Sequencing and sync). Batches for one workbook are applied
// one at a time under the workbook's row lock; a batch is recorded all or nothing.
import { randomUUID } from "node:crypto";
import { LIMITS } from "../shared/limits.js";
import { type Op } from "../shared/ops.js";
import { cellName, parseCell } from "../shared/refs.js";
import { type Member } from "./auth.js";
import { type Tx } from "./db.js";
import { invalid } from "./errors.js";
import { type Reason, conflicts, contentAllowed, keptInTray, opShape, seasonRoleSheet } from "./rules/edits.js";
import { type Author, type DerivedWorkbook, type StoredOp, type WorkbookRow, cellOut } from "./workbook.js";

export interface Batch {
  deviceId: string;
  baseSeq: number;
  ops: Array<Record<string, unknown>>;
}

/** The whole request is refused only when the batch itself is malformed. */
export function parseBatch(body: Record<string, unknown>, headSeq: number): Batch {
  const fields: Record<string, string> = {};
  const extra = Object.keys(body).filter((k) => !["deviceId", "baseSeq", "ops"].includes(k));
  if (extra.length) fields.body = "Send only deviceId, baseSeq and ops.";
  const { deviceId, baseSeq, ops } = body;
  if (typeof deviceId !== "string" || deviceId.length < 1 || deviceId.length > 64) fields.deviceId = "Send a device id of 1 to 64 characters.";
  if (typeof baseSeq !== "number" || !Number.isInteger(baseSeq) || baseSeq < 0 || baseSeq > headSeq) {
    fields.baseSeq = `Send a base sequence from 0 to ${headSeq}.`;
  }
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > LIMITS.maxOpsPerBatch || ops.some((o) => typeof o !== "object" || o === null || Array.isArray(o))) {
    fields.ops = `Send 1 to ${LIMITS.maxOpsPerBatch} ops.`;
  } else {
    const ids = ops.map((o: Record<string, unknown>) => o.opId);
    if (ids.some((id) => typeof id !== "string" || id.length < 1 || id.length > 64)) fields.ops = "Give every op an opId of 1 to 64 characters.";
    else if (new Set(ids).size !== ids.length) fields.ops = "Give every op in the batch its own opId.";
  }
  if (Object.keys(fields).length) throw invalid(fields);
  return { deviceId: deviceId as string, baseSeq: baseSeq as number, ops: ops as Array<Record<string, unknown>> };
}

type Result = Record<string, unknown>;

async function trayEntry(
  t: Tx,
  row: WorkbookRow,
  member: Member,
  derived: DerivedWorkbook,
  op: Extract<Op, { type: "setCell" }>,
  kind: "conflict" | "rejected",
  reason: Reason | null,
): Promise<{ id: string; current: string; author: Author | null }> {
  const id = randomUUID();
  const current = derived.engine.input(op.sheetId, op.cell);
  const author = derived.lastAuthor(op.sheetId, op.cell);
  const sheetName = derived.engine.sheetById(op.sheetId)?.name ?? "";
  await t.query(
    `INSERT INTO conflicts (id, workbook_id, member_id, kind, sheet_id, sheet_name, cell, my_input, current_input, current_author_id, current_author_name, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, row.id, member.id, kind, op.sheetId, sheetName, op.cell, op.input, current, author?.id ?? null, author?.name ?? null, reason],
  );
  return { id, current, author };
}

function position(derived: DerivedWorkbook, sheetId: string): number {
  return derived.engine.sheets.findIndex((s) => s.id === sheetId);
}

/** The applied result of a cell edit: the cell and its closure with depths and values. */
function cellResult(derived: DerivedWorkbook, sheetId: string, cell: string): Result {
  const engine = derived.engine;
  const dependents = engine
    .closure(sheetId, cell)
    .map((d) => ({ d, at: parseCell(d.cell) as { row: number; col: number }, pos: position(derived, d.sheetId) }))
    .sort((a, b) => a.d.depth - b.d.depth || a.pos - b.pos || a.at.row - b.at.row || a.at.col - b.at.col)
    .map(({ d, at }) => ({
      sheetId: d.sheetId,
      sheetName: engine.sheetById(d.sheetId)?.name ?? "",
      cell: cellName(at.row, at.col),
      depth: d.depth,
      ...cellOut(engine, d.sheetId, d.cell),
    }));
  return { cell: { sheetId, cell, ...cellOut(engine, sheetId, cell) }, dependents };
}

/** Appends applied ops to the record in one statement. */
export async function appendOps(t: Tx, workbookId: string, ops: Array<{ seq: number; op: StoredOp }>, author: Author): Promise<void> {
  if (!ops.length) return;
  await t.query(
    `INSERT INTO ops (workbook_id, seq, type, body, author_id, author_name)
     SELECT $1, x.seq, x.type, x.body, $2, $3 FROM jsonb_to_recordset($4::jsonb) AS x(seq integer, type text, body jsonb)`,
    [workbookId, author.id, author.name, JSON.stringify(ops.map((o) => ({ seq: o.seq, type: o.op.type, body: o.op })))],
  );
}

export async function recordHead(t: Tx, workbookId: string, derived: DerivedWorkbook): Promise<void> {
  await t.query("UPDATE workbooks SET head_seq = $2, sheet_count = $3, updated_at = clock_timestamp() WHERE id = $1", [
    workbookId,
    derived.headSeq,
    derived.engine.sheets.length,
  ]);
}

/** Processes the ops in order and returns the acknowledgement body. */
export async function applyBatch(t: Tx, row: WorkbookRow, member: Member, derived: DerivedWorkbook, batch: Batch, key: string): Promise<Result> {
  const now = new Date();
  const author: Author = { id: member.id, name: member.name };
  const results: Result[] = [];
  const applied: Array<{ seq: number; op: StoredOp }> = [];
  for (const raw of batch.ops) {
    const opId = raw.opId as string;
    const op = opShape(raw);
    if (!op) {
      results.push({ opId, status: "rejected", reason: "invalid_op", conflictId: null });
      continue;
    }
    const blocked = seasonRoleSheet(row, member.role, op, derived, now) ?? (contentAllowed(op, derived) ? null : "invalid_op");
    if (blocked) {
      const entry = op.type === "setCell" && keptInTray(op, blocked) ? await trayEntry(t, row, member, derived, op, "rejected", blocked) : null;
      results.push({ opId, status: "rejected", reason: blocked, conflictId: entry?.id ?? null });
      continue;
    }
    if (op.type === "setCell" && conflicts(op, derived, batch.baseSeq, member.id)) {
      const entry = await trayEntry(t, row, member, derived, op, "conflict", null);
      results.push({ opId, status: "conflict", conflictId: entry.id, current: { input: entry.current, author: entry.author } });
      continue;
    }
    const seq = derived.headSeq + 1;
    derived.apply(op, seq, author);
    applied.push({ seq, op });
    results.push(op.type === "setCell" ? { opId, status: "applied", seq, ...cellResult(derived, op.sheetId, op.cell) } : { opId, status: "applied", seq });
  }
  await appendOps(t, row.id, applied, author);
  if (applied.length) await recordHead(t, row.id, derived);
  return { batch: { key, deviceId: batch.deviceId, headSeq: derived.headSeq }, results };
}
