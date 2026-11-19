import type { Db } from "./db";
import { config } from "./config";
import { businessNow } from "./clock";
import { conflict, gone, notFound } from "./errors";
import { applyBoardChange } from "./boardchange";
import type { UserRef } from "./domain";

export interface OperationJson {
  id: number;
  kind: "move" | "copy" | "delete";
  count: number;
  board: { id: number; name: string } | null;
  deadline: string;
  status: "open" | "undone" | "expired";
}

export interface OperationRow {
  id: string;
  user_id: string;
  kind: "move" | "copy" | "delete";
  board_id: string;
  target_board_id: string | null;
  target_section_id: string | null;
  count: number;
  status: "open" | "undone" | "expired";
  payload: OpPayload;
  deadline: Date;
  created_at: Date;
}

/** Everything needed to undo an operation exactly: prior pins and containers, and copies made. */
export interface OpPayload {
  pins: Array<{
    pinId: number;
    fromBoard: number;
    fromSection: number | null;
    fromPosition: number;
    title: string;
    rootId: number | null;
    copyId?: number; // set for copy operations
  }>;
  targetBoard: number | null;
  targetSection: number | null;
  lastSavedBefore: Record<string, string | null>; // board id -> last_saved_at before the operation
  // The full prior order of every touched container, so undo restores the exact positions.
  priorOrder: Array<{ boardId: number; sectionId: number | null; pins: number[] }>;
}

export function operationJson(op: OperationRow, boardName: string | null): OperationJson {
  return {
    id: Number(op.id),
    kind: op.kind,
    count: op.count,
    board: op.target_board_id !== null ? { id: Number(op.target_board_id), name: boardName! } : null,
    deadline: op.deadline.toISOString(),
    status: op.status,
  };
}

/**
 * All-or-nothing bulk move, copy or delete (DP-40): one transaction, one operation row,
 * one board message per board touched. Pin ids in `pins` must be validated by the caller.
 */
export async function runBulkOperation(
  db: Db,
  actor: UserRef,
  args: {
    kind: "move" | "copy" | "delete";
    pinIds: number[];
    targetBoard: number | null;
    targetSection: number | null;
    targetBoardName?: string;
  }
): Promise<OperationRow> {
  const now = businessNow();
  const deadline = new Date(now.getTime() + config.undoSeconds * 1000);

  // Resolve chosen pins in board order: unsectioned area first, then sections in order, each by position.
  const allRows = await db.query<{ id: string; board_id: string; section_id: string | null; position: number; title: string; root_id: string | null; owner_id: string; status: string }>(
    `select id, board_id, section_id, position, title, root_id, owner_id, status from pins where id = any($1::bigint[])`,
    [args.pinIds]
  );
  const all = allRows;
  all.sort((a, b) => {
    if (a.board_id !== b.board_id) return Number(a.board_id) - Number(b.board_id);
    if (a.section_id !== b.section_id) return 0;
    return a.position - b.position;
  });

  const payload: OpPayload = {
    pins: all.map(p => ({
      pinId: Number(p.id),
      fromBoard: Number(p.board_id),
      fromSection: p.section_id === null ? null : Number(p.section_id),
      fromPosition: p.position,
      title: p.title,
      rootId: p.root_id === null ? null : Number(p.root_id),
    })),
    targetBoard: args.targetBoard,
    targetSection: args.targetSection,
    lastSavedBefore: {},
    priorOrder: [],
  };

  // Record the full prior order of every container the operation touches, so the
  // undo can restore it exactly (Business rules: undo result).
  const priorContainers = new Set<string>();
  for (const p of all) priorContainers.add(`${p.board_id}:${p.section_id ?? "-"}`);
  if (args.kind !== "delete" && args.targetBoard !== null) priorContainers.add(`${args.targetBoard}:${args.targetSection ?? "-"}`);
  for (const key of priorContainers) {
    const [boardIdStr, sectionIdStr] = key.split(":");
    const boardId = Number(boardIdStr);
    const sectionId = sectionIdStr === "-" ? null : Number(sectionIdStr);
    const rows = await db.query<{ id: string }>(
      `select id from pins where board_id = $1 and section_id is not distinct from $2 and status = 'live' order by position, id`,
      [boardId, sectionId]
    );
    payload.priorOrder.push({ boardId, sectionId, pins: rows.map(r => Number(r.id)) });
  }

  // Record last_saved_at of every board we will touch.
  const boardsTouched = new Set<number>(all.map(p => Number(p.board_id)));
  if (args.targetBoard !== null && args.kind !== "delete") boardsTouched.add(args.targetBoard);
  for (const boardId of boardsTouched) {
    const b = await db.queryOne<{ last_saved_at: Date | null }>(`select last_saved_at from boards where id = $1`, [boardId]);
    payload.lastSavedBefore[String(boardId)] = b?.last_saved_at ? b.last_saved_at.toISOString() : null;
  }

  const nowIso = now;
  if (args.kind === "delete") {
    for (const p of all) {
      await db.query(`update pins set status = 'deleted', updated_at = $2 where id = $1`, [Number(p.id), nowIso]);
    }
  } else if (args.kind === "move") {
    // Positions 1..n of the target container in previous board order; the rest shift down.
    await renumberContainer(db, args.targetBoard!, args.targetSection);
    let pos = 1;
    for (const p of all) {
      await db.query(
        `update pins set board_id = $2, section_id = $3, position = $4, updated_at = $5 where id = $1`,
        [Number(p.id), args.targetBoard, args.targetSection, pos, nowIso]
      );
      pos++;
    }
    for (const boardId of new Set(all.map(p => Number(p.board_id)))) {
      await renumberContainer(db, boardId, null);
    }
    // Renumber each vacated section.
    for (const p of all) {
      if (p.section_id !== null) await renumberContainer(db, Number(p.board_id), Number(p.section_id));
    }
  } else {
    // Copy: new pins owned by the actor, credited like saves.
    let pos = 1;
    for (const p of all) {
      const inserted = await db.queryOne<{ id: string }>(
        `insert into pins (owner_id, board_id, section_id, image_id, root_id, title, description, alt, source, source_host, tags, position, status, created_at, updated_at)
         select $2, $3, $4, image_id, coalesce(root_id, id), title, description, alt, source, source_host, tags, $5, 'live', $6, $6
         from pins where id = $1 returning id`,
        [Number(p.id), actor.id, args.targetBoard, args.targetSection, pos, nowIso]
      );
      const copyId = Number(inserted!.id);
      const entry = payload.pins.find(x => x.pinId === Number(p.id))!;
      entry.copyId = copyId;
      pos++;
    }
  }

  // Renumber remaining containers of source boards after a delete or move.
  if (args.kind !== "copy") {
    for (const p of all) {
      await renumberContainer(db, Number(p.board_id), p.section_id === null ? null : Number(p.section_id));
    }
  }
  await renumberContainer(db, args.targetBoard ?? 0, args.targetSection);

  const inserted = await db.queryOne<OperationRow>(
    `insert into operations (user_id, kind, board_id, target_board_id, target_section_id, count, status, payload, deadline, created_at)
     values ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9) returning id, user_id, kind, board_id, target_board_id, target_section_id, count, status, payload, deadline, created_at`,
    [actor.id, args.kind, Number(all[0]?.board_id ?? 0), args.targetBoard, args.targetSection, all.length, JSON.stringify(payload), deadline, nowIso]
  );

  // One board message per board touched (DP-49).
  const firstPin = payload.pins[0] ? { id: payload.pins[0].pinId, title: payload.pins[0].title } : null;
  for (const boardId of boardsTouched) {
    const sameBoard = args.targetBoard !== null && boardId === args.targetBoard && all.length > 0 && all.every(p => Number(p.board_id) === args.targetBoard);
    let change: "moved" | "added" | "removed";
    if (args.kind === "delete") change = "removed";
    else if (args.kind === "copy") change = boardId === args.targetBoard ? "added" : "removed";
    else change = sameBoard ? "moved" : boardId === args.targetBoard ? "added" : "removed";
    const isTarget = args.targetBoard === boardId;
    await applyBoardChange(db, {
      boardId,
      actor,
      change,
      pin: firstPin,
      lastSaved: (args.kind === "copy" && isTarget) || (args.kind === "move" && isTarget && !sameBoard),
    });
  }
  return inserted!;
}

/** Renumber pins of one container to 1..n with no gaps (DP-44). */
export async function renumberContainer(db: Db, boardId: number, sectionId: number | null): Promise<void> {
  await db.query(
    `with ordered as (
       select id, row_number() over (order by position, id) as rn
       from pins where board_id = $1 and section_id is not distinct from $2 and status = 'live'
     )
     update pins p set position = o.rn from ordered o where p.id = o.id and p.position <> o.rn`,
    [boardId, sectionId]
  );
}

export async function renumberSections(db: Db, boardId: number): Promise<void> {
  await db.query(
    `with ordered as (
       select id, row_number() over (order by position, id) as rn
       from sections where board_id = $1
     )
     update sections s set position = o.rn from ordered o where s.id = o.id and s.position <> o.rn`,
    [boardId]
  );
}

/** Undo restores the exact prior boards, sections and positions (DP-42). */
export async function undoOperation(db: Db, actor: UserRef, operationId: number): Promise<{ op: OperationRow; boardName: string | null }> {
  const op = await db.queryOne<OperationRow>(
    `select * from operations where id = $1`,
    [operationId]
  );
  if (!op) throw notFound();
  if (op.user_id !== String(actor.id)) throw notFound(); // another person's operation is a hidden record
  if (op.status === "undone") throw conflict("already_undone");
  const now = businessNow();
  if (op.status === "expired" || now.getTime() >= op.deadline.getTime()) throw gone("undo_expired");

  const payload = op.payload as OpPayload;
  // Conflict check: any pin, its prior board or section gone, or a copy deleted.
  for (const entry of payload.pins) {
    const pin = await db.queryOne<{ status: string }>(`select status from pins where id = $1`, [entry.pinId]);
    if (!pin || pin.status === "gone") throw conflict("undo_conflict");
    if (entry.copyId !== undefined) {
      const copy = await db.queryOne<{ status: string }>(`select status from pins where id = $1`, [entry.copyId]);
      if (!copy || copy.status !== "live") throw conflict("undo_conflict");
    }
    const board = await db.queryOne<{ id: string }>(`select id from boards where id = $1`, [entry.fromBoard]);
    if (!board) throw conflict("undo_conflict");
    if (entry.fromSection !== null) {
      const section = await db.queryOne<{ id: string }>(`select id from sections where id = $1 and board_id = $2`, [entry.fromSection, entry.fromBoard]);
      if (!section) throw conflict("undo_conflict");
    }
  }

  if (op.kind === "copy") {
    for (const entry of payload.pins) {
      await db.query(`delete from pins where id = $1`, [entry.copyId]);
    }
  } else if (op.kind === "delete") {
    for (const entry of payload.pins) {
      await db.query(`update pins set status = 'live', updated_at = $2 where id = $1`, [entry.pinId, now]);
    }
  } else {
    for (const entry of payload.pins) {
      await db.query(
        `update pins set board_id = $2, section_id = $3, position = $4, updated_at = $5 where id = $1`,
        [entry.pinId, entry.fromBoard, entry.fromSection, entry.fromPosition, now]
      );
    }
  }

  // Restore the exact prior order of every touched container, then renumber for any
  // pins that were not part of the recorded order, and restore last_saved_at values.
  const boardsTouched = new Set<number>();
  for (const entry of payload.pins) boardsTouched.add(entry.fromBoard);
  if (op.target_board_id !== null) boardsTouched.add(Number(op.target_board_id));
  for (const container of payload.priorOrder) {
    let position = 1;
    for (const pinId of container.pins) {
      const pin = await db.queryOne<{ status: string }>(`select status from pins where id = $1`, [pinId]);
      // A pin that no longer exists (deleted later) is skipped by the conflict check above,
      // so every recorded pin is restorable; its position comes from the recorded order.
      if (pin) {
        await db.query(`update pins set position = $2 where id = $1`, [pinId, position]);
        position++;
      }
    }
  }
  for (const boardId of boardsTouched) {
    const sections = await db.query<{ id: string }>(`select id from sections where board_id = $1`, [boardId]);
    await renumberContainer(db, boardId, null);
    for (const s of sections) await renumberContainer(db, boardId, Number(s.id));
    const before = payload.lastSavedBefore[String(boardId)];
    await db.query(`update boards set last_saved_at = $2 where id = $1`, [boardId, before ? new Date(before) : null]);
  }

  const updated = await db.queryOne<OperationRow>(
    `update operations set status = 'undone' where id = $1
     returning id, user_id, kind, board_id, target_board_id, target_section_id, count, status, payload, deadline, created_at`,
    [operationId]
  );

  // The undo sends the reverse of what the operation sent, one message per board touched.
  const firstPin = payload.pins[0] ? { id: payload.pins[0].pinId, title: payload.pins[0].title } : null;
  for (const boardId of boardsTouched) {
    let change: "moved" | "added" | "removed";
    if (op.kind === "delete") change = "added";
    else if (op.kind === "copy") change = boardId === Number(op.target_board_id) ? "removed" : "removed";
    else change = "moved";
    await applyBoardChange(db, { boardId, actor, change, pin: firstPin, lastSaved: false });
  }

  const target = op.target_board_id !== null
    ? await db.queryOne<{ name: string }>(`select name from boards where id = $1`, [Number(op.target_board_id)])
    : null;
  return { op: updated!, boardName: target?.name ?? null };
}
