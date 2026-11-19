import { authorize, loadBoard, visiblePinSql } from "./access.js";
import { emitCounts, rootSql, rootsOf } from "./counts.js";
import { containerOf, flatten, removeFromOrder } from "../shared/order.js";
import { loadOrder, lockBoards, recordChange, renumber, writeOrder, type Actor } from "./containers.js";
import { iso, now } from "./clock.js";
import { Body, type SessionUser } from "./http.js";
import { config } from "./config.js";
import { exactlyOne, one, pool, rows, tx, type Db } from "./db.js";
import { conflict, gone, notFound, validation } from "./errors.js";
import { emit } from "./events.js";
import { addCredited, creditSources, holdsRoot, touchLastSaved } from "./pins.js";
import { deletePrefix } from "./storage.js";
import type { BoardOrder, ChangeKind, OperationView } from "../shared/types.js";

type Kind = "move" | "copy" | "delete";

interface SourcePin {
  id: number;
  board_id: number;
  section_id: number | null;
  title: string;
  root: number;
}

interface OperationRow {
  id: number;
  kind: Kind;
  actor_id: number;
  board_id: number | null;
  section_id: number | null;
  count: number;
  created_at: Date;
  deadline: Date;
  status: "open" | "undone" | "expired";
}

/** The undo window is open while the operation is open and the business clock is before its deadline. */
const windowOpen = (op: Pick<OperationRow, "status" | "deadline">, at: Date): boolean => op.status === "open" && at.getTime() < op.deadline.getTime();

async function view(db: Db, op: OperationRow): Promise<OperationView> {
  const board = op.board_id === null ? null : await one<{ id: number; name: string }>(db, "SELECT id, name FROM boards WHERE id = $1", [op.board_id]);
  const status = op.status === "open" && !windowOpen(op, now()) ? "expired" : op.status;
  return { id: op.id, kind: op.kind, count: op.count, board, deadline: iso(op.deadline), status };
}

function integersOf(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isSafeInteger(item) && item > 0) : [];
}

const clone = (order: BoardOrder): BoardOrder => structuredClone(order);

export async function createOperation(me: SessionUser, body: Body): Promise<OperationView> {
  const requested = integersOf(body.get("pins"));
  const kindValue = body.get("kind");
  return tx(async (client) => {
    const distinct = [...new Set(requested)];
    const targetField = body.integerOrNull("board");
    const homes = await rows<{ board_id: number }>(client, "SELECT DISTINCT board_id FROM pins WHERE id = ANY($1) AND board_id IS NOT NULL", [distinct]);
    await lockBoards(client, [...homes.map((home) => home.board_id), ...(targetField === null ? [] : [targetField])]);
    const found = await rows<SourcePin>(
      client,
      `SELECT p.id, p.board_id, p.section_id, p.title, ${rootSql("p")} AS root
         FROM pins p LEFT JOIN boards b ON b.id = p.board_id WHERE p.id = ANY($2) AND ${visiblePinSql("p", "b", "$1")}`,
      [me.id, distinct],
    );
    if (found.length !== distinct.length) throw notFound();
    const sourceBoards = [...new Set(found.map((pin) => pin.board_id))];
    for (const boardId of sourceBoards) authorize(await loadBoard(client, boardId, me.id), "edit_pins");
    if (kindValue !== "move" && kindValue !== "copy" && kindValue !== "delete") throw validation("kind");
    const kind: Kind = kindValue;
    let target: { id: number; name: string } | null = null;
    let sectionId: number | null = null;
    if (kind !== "delete") {
      if (targetField === null) throw validation("board");
      const access = await loadBoard(client, targetField, me.id);
      authorize(access, "edit_pins");
      target = { id: access.id, name: access.name };
      sectionId = body.integerOrNull("section");
      if (containerOf(await loadOrder(client, access.id), sectionId) === null) throw notFound();
    }
    const rawPins = body.get("pins");
    if (!Array.isArray(rawPins) || requested.length === 0 || requested.length !== rawPins.length || requested.length !== distinct.length) {
      throw validation("pins");
    }
    // The operation's order: source boards in the order they first appear, then each board's own order.
    const orders = new Map<number, BoardOrder>();
    for (const boardId of new Set([...sourceBoards, ...(target ? [target.id] : [])])) orders.set(boardId, await loadOrder(client, boardId));
    const snapshots = new Map([...orders].map(([boardId, order]) => [boardId, clone(order)]));
    const boardRank = new Map(sourceBoards.map((boardId, index) => [boardId, index]));
    const chosen = [...found].sort((a, b) => {
      const byBoard = (boardRank.get(a.board_id) ?? 0) - (boardRank.get(b.board_id) ?? 0);
      if (byBoard !== 0) return byBoard;
      const flat = flatten(orders.get(a.board_id) ?? { unsectioned: [], sections: [] });
      return flat.indexOf(a.id) - flat.indexOf(b.id);
    });
    const first = chosen[0];
    if (!first) throw validation("pins");
    const chosenIds = chosen.map((pin) => pin.id);
    if (target) {
      const roots = chosen.map((pin) => pin.root);
      if (new Set(roots).size !== roots.length || (await holdsRoot(client, target.id, roots, kind === "copy" ? [] : chosenIds))) {
        throw conflict("already_on_board", { board: target });
      }
    }
    const at = now();
    const operation = await exactlyOne<{ id: number }>(
      client,
      `INSERT INTO operations (kind, actor_id, board_id, section_id, count, created_at, deadline) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [kind, me.id, target?.id ?? null, sectionId, chosen.length, at, new Date(at.getTime() + config.undoSeconds * 1000)],
    );
    for (const [boardId] of orders) {
      const prior = await exactlyOne<{ last_saved_at: Date | null }>(client, "SELECT last_saved_at FROM boards WHERE id = $1", [boardId]);
      await client.query("INSERT INTO operation_boards (op_id, board_id, prior_last_saved_at, prior_order) VALUES ($1, $2, $3, $4)", [
        operation.id, boardId, prior.last_saved_at, JSON.stringify(snapshots.get(boardId)),
      ]);
    }
    const firstRef = { id: first.id, title: first.title };
    const record = (pin: SourcePin, newPinId: number | null, index: number) =>
      client.query(
        "INSERT INTO operation_items (op_id, pin_id, idx, prior_board_id, prior_section_id, new_pin_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [operation.id, pin.id, index, pin.board_id, pin.section_id, newPinId],
      );
    if (kind === "move" && target) {
      for (const [boardId, order] of orders) removeFromOrder(order, new Set(chosen.filter((pin) => pin.board_id === boardId).map((pin) => pin.id)));
      containerOf(orders.get(target.id) ?? { unsectioned: [], sections: [] }, sectionId)?.unshift(...chosenIds);
      for (const [boardId, order] of orders) await writeOrder(client, boardId, order);
      for (const [index, pin] of chosen.entries()) await record(pin, null, index);
      const external = chosen.some((pin) => pin.board_id !== target.id);
      if (external) await touchLastSaved(client, target.id, at);
      for (const boardId of sourceBoards) {
        if (boardId !== target.id) await recordChange(client, boardId, me, "removed", firstRef, null);
      }
      await recordChange(client, target.id, me, external ? "added" : "moved", firstRef, null);
      await emitCounts(client, await rootsOf(client, chosenIds));
    } else if (kind === "copy" && target) {
      const sources = await creditSources(client, chosenIds);
      const created = await addCredited(client, {
        actor: me, boardId: target.id, sectionId, sources: chosenIds.flatMap((id) => sources.get(id) ?? []), at,
      });
      for (const [index, pin] of chosen.entries()) await record(pin, created[index] ?? null, index);
      await recordChange(client, target.id, me, "added", { id: created[0] ?? first.id, title: first.title }, null);
    } else {
      await client.query("UPDATE pins SET state = 'deleted', delete_op_id = $2, position = NULL WHERE id = ANY($1)", [chosenIds, operation.id]);
      for (const [index, pin] of chosen.entries()) await record(pin, null, index);
      for (const boardId of sourceBoards) {
        await renumber(client, boardId);
        const firstInBoard = chosen.find((pin) => pin.board_id === boardId) ?? first;
        await recordChange(client, boardId, me, "removed", { id: firstInBoard.id, title: firstInBoard.title }, null);
      }
      await emitCounts(client, await rootsOf(client, chosenIds));
    }
    return view(client, await exactlyOne<OperationRow>(client, "SELECT * FROM operations WHERE id = $1", [operation.id]));
  });
}

export async function deleteOnePin(me: SessionUser, pinId: number): Promise<OperationView> {
  return createOperation(me, new Body({ kind: "delete", pins: [pinId], board: null, section: null }));
}

interface ItemRow {
  pin_id: number;
  idx: number;
  prior_board_id: number | null;
  prior_section_id: number | null;
  new_pin_id: number | null;
}

/** Puts one board's pins back where the snapshot had them, keeping everything that changed since in place. */
function restoreOrder(current: BoardOrder, prior: BoardOrder, returning: ReadonlySet<number>, leaving: ReadonlySet<number>): BoardOrder {
  const where = new Map<number, number | null>();
  current.unsectioned.forEach((id) => where.set(id, null));
  current.sections.forEach((section) => section.pins.forEach((id) => where.set(id, section.id)));
  const rebuild = (container: number | null, priorPins: number[], currentPins: number[]): number[] => {
    const settled = priorPins.filter((id) => returning.has(id) || (where.get(id) === container && !leaving.has(id)));
    const extras = currentPins.filter((id) => !settled.includes(id) && !leaving.has(id));
    return [...extras, ...settled];
  };
  const priorSection = (id: number): number[] => prior.sections.find((section) => section.id === id)?.pins ?? [];
  const restoredSections = current.sections.map((section) => ({
    ...section,
    pins: rebuild(section.id, priorSection(section.id), section.pins),
  }));
  const homeless = [...returning].filter(
    (id) => !prior.unsectioned.includes(id) && !restoredSections.some((section) => section.pins.includes(id)),
  );
  return {
    unsectioned: [...homeless, ...rebuild(null, prior.unsectioned, current.unsectioned)],
    sections: restoredSections,
  };
}

export async function undoOperation(me: SessionUser, operationId: number): Promise<OperationView> {
  return tx(async (client) => {
    const op = await one<OperationRow>(client, "SELECT * FROM operations WHERE id = $1 AND actor_id = $2 FOR UPDATE", [operationId, me.id]);
    if (!op) throw notFound();
    if (op.status === "undone") throw conflict("already_undone");
    if (!windowOpen(op, now())) throw gone("undo_expired");
    const items = await rows<ItemRow>(client, "SELECT pin_id, idx, prior_board_id, prior_section_id, new_pin_id FROM operation_items WHERE op_id = $1 ORDER BY idx", [op.id]);
    const snapshots = await rows<{ board_id: number; prior_last_saved_at: Date | null; prior_order: BoardOrder }>(
      client, "SELECT board_id, prior_last_saved_at, prior_order FROM operation_boards WHERE op_id = $1", [op.id],
    );
    const boardIds = snapshots.map((snapshot) => snapshot.board_id);
    await lockBoards(client, boardIds);
    const existing = await rows<{ id: number }>(client, "SELECT id FROM boards WHERE id = ANY($1)", [boardIds]);
    const sectionIds = items.flatMap((item) => (item.prior_section_id === null ? [] : [item.prior_section_id]));
    const sections = sectionIds.length === 0 ? [] : await rows<{ id: number }>(client, "SELECT id FROM sections WHERE id = ANY($1)", [sectionIds]);
    const subject = op.kind === "copy" ? items.flatMap((item) => (item.new_pin_id === null ? [] : [item.new_pin_id])) : items.map((item) => item.pin_id);
    const states = await rows<{ id: number; state: string; board_id: number | null; delete_op_id: number | null }>(
      client, "SELECT id, state, board_id, delete_op_id FROM pins WHERE id = ANY($1)", [subject],
    );
    const intact = states.length === subject.length && states.every((pin) => {
      if (op.kind === "delete") return pin.state === "deleted" && pin.delete_op_id === op.id;
      if (op.kind === "move") return pin.state === "live" && pin.board_id === op.board_id;
      return pin.state === "live";
    });
    if (existing.length !== boardIds.length || new Set(sectionIds).size !== sections.length || !intact) throw conflict("undo_conflict");
    for (const boardId of boardIds) authorize(await loadBoard(client, boardId, me.id), "edit_pins");
    if (op.kind !== "copy") {
      for (const boardId of new Set(items.flatMap((item) => (item.prior_board_id === null ? [] : [item.prior_board_id])))) {
        const returningIds = items.filter((item) => item.prior_board_id === boardId).map((item) => item.pin_id);
        if (await holdsRoot(client, boardId, await rootsOf(client, returningIds), returningIds)) throw conflict("undo_conflict");
      }
    }

    const first = items[0];
    const title = first ? (await one<{ title: string }>(client, "SELECT title FROM pins WHERE id = $1", [first.pin_id]))?.title : undefined;
    const firstRef = first && title !== undefined ? { id: first.pin_id, title } : null;
    const touched = new Map<number, ChangeKind>();
    if (op.kind === "delete") await client.query("UPDATE pins SET state = 'live', delete_op_id = NULL WHERE id = ANY($1)", [subject]);
    if (op.kind === "copy") await client.query("UPDATE pins SET state = 'gone', position = NULL WHERE id = ANY($1)", [subject]);
    for (const snapshot of snapshots) {
      const returning = new Set(items.filter((item) => item.prior_board_id === snapshot.board_id && op.kind !== "copy").map((item) => item.pin_id));
      const leaving = new Set(
        op.kind === "copy"
          ? subject
          : op.kind === "move" && snapshot.board_id === op.board_id
            ? items.filter((item) => item.prior_board_id !== snapshot.board_id).map((item) => item.pin_id)
            : [],
      );
      const current = await loadOrder(client, snapshot.board_id);
      if (op.kind === "copy") removeFromOrder(current, leaving);
      await writeOrder(client, snapshot.board_id, op.kind === "copy" ? current : restoreOrder(current, snapshot.prior_order, returning, leaving));
      if (snapshot.board_id === op.board_id) {
        await client.query("UPDATE boards SET last_saved_at = $2 WHERE id = $1 AND last_saved_at = $3", [snapshot.board_id, snapshot.prior_last_saved_at, op.created_at]);
      }
      touched.set(
        snapshot.board_id,
        op.kind === "copy" ? "removed" : op.kind === "delete" ? "added" : leaving.size > 0 ? "removed" : returning.size > 0 && snapshot.board_id !== op.board_id ? "added" : "moved",
      );
    }
    const actor: Actor = me;
    for (const [boardId, change] of touched) await recordChange(client, boardId, actor, change, firstRef, null);
    await client.query("UPDATE operations SET status = 'undone' WHERE id = $1", [op.id]);
    await emitCounts(client, await rootsOf(client, subject));
    return view(client, await exactlyOne<OperationRow>(client, "SELECT * FROM operations WHERE id = $1", [op.id]));
  });
}

/** Closes undo windows the business clock has passed (the opposite of `windowOpen`), tells the people who made them, and lets deleted pins go. */
export async function expireOperations(): Promise<void> {
  await tx(async (client) => {
    const closed = await rows<{ id: number; actor_id: number }>(
      client, "UPDATE operations SET status = 'expired' WHERE status = 'open' AND deadline <= $1 RETURNING id, actor_id", [now()],
    );
    for (const op of closed) await emit(client, { kind: "person", user: op.actor_id }, { type: "operation_expired", id: op.id });
    await client.query(
      `UPDATE pins SET state = 'gone' WHERE state = 'deleted' AND delete_op_id IN (SELECT id FROM operations WHERE status = 'expired')`,
    );
  });
}

/** Removes stored images no live or recently deleted pin uses any more. */
export async function purgeImages(): Promise<void> {
  const orphans = await rows<{ id: string }>(
    pool,
    `SELECT i.id FROM images i WHERE NOT i.purged
        AND NOT EXISTS (SELECT 1 FROM pins p WHERE p.image_id = i.id AND p.state IN ('live', 'deleted')) LIMIT 50`,
  );
  for (const image of orphans) {
    if (await deletePrefix(`images/${image.id}/`)) await pool.query("UPDATE images SET purged = true WHERE id = $1", [image.id]);
  }
}
