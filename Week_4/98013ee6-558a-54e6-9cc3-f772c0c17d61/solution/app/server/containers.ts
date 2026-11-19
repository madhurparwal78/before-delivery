import { exactlyOne, rows, type Db } from "./db.js";
import { emit } from "./events.js";
import { flatten } from "../shared/order.js";
import type { BoardOrder, ChangeKind } from "../shared/types.js";

/** Pins and sections hold positions 1 to n within their container; every write renumbers without gaps. */

export async function loadOrder(db: Db, boardId: number): Promise<BoardOrder> {
  const sections = await rows<{ id: number; name: string }>(
    db,
    "SELECT id, name FROM sections WHERE board_id = $1 ORDER BY position, id",
    [boardId],
  );
  const pins = await rows<{ id: number; section_id: number | null }>(
    db,
    "SELECT id, section_id FROM pins WHERE board_id = $1 AND state = 'live' ORDER BY position, id",
    [boardId],
  );
  const order: BoardOrder = { unsectioned: [], sections: sections.map((section) => ({ ...section, pins: [] })) };
  for (const pin of pins) {
    const target = pin.section_id === null ? order.unsectioned : order.sections.find((section) => section.id === pin.section_id)?.pins;
    (target ?? order.unsectioned).push(pin.id);
  }
  return order;
}

export async function writeOrder(db: Db, boardId: number, order: BoardOrder): Promise<void> {
  await db.query(
    "UPDATE sections s SET position = v.position FROM unnest($1::bigint[], $2::int[]) AS v(id, position) WHERE s.id = v.id",
    [order.sections.map((section) => section.id), order.sections.map((_section, index) => index + 1)],
  );
  const ids: number[] = [];
  const sectionIds: (number | null)[] = [];
  const positions: number[] = [];
  const place = (pins: number[], sectionId: number | null): void => {
    pins.forEach((id, index) => {
      ids.push(id);
      sectionIds.push(sectionId);
      positions.push(index + 1);
    });
  };
  place(order.unsectioned, null);
  for (const section of order.sections) place(section.pins, section.id);
  if (ids.length === 0) return;
  await db.query(
    `UPDATE pins p SET board_id = $1, section_id = v.section_id, position = v.position
       FROM unnest($2::bigint[], $3::bigint[], $4::int[]) AS v(id, section_id, position) WHERE p.id = v.id`,
    [boardId, ids, sectionIds, positions],
  );
}

/** Renumbers a board's containers to 1..n. New pins are inserted with a position below 1 and land first. */
export async function renumber(db: Db, boardId: number): Promise<BoardOrder> {
  const order = await loadOrder(db, boardId);
  await writeOrder(db, boardId, order);
  return order;
}

export interface Actor {
  id: number;
  name: string;
}

/**
 * Raises the board's sequence by exactly one and sends exactly one `board` message for it.
 * Call after the change has been written, inside the same transaction.
 */
export async function recordChange(
  db: Db,
  boardId: number,
  actor: Actor,
  change: ChangeKind,
  pin: { id: number; title: string } | null,
  section: { id: number; name: string } | null,
): Promise<number> {
  const { seq } = await exactlyOne<{ seq: number }>(db, "UPDATE boards SET seq = seq + 1 WHERE id = $1 RETURNING seq", [boardId]);
  const order = await loadOrder(db, boardId);
  await emit(
    db,
    { kind: "board", board: boardId },
    {
      type: "board",
      board_id: boardId,
      seq,
      actor,
      change,
      pin,
      section,
      pin_count: flatten(order).length,
      order,
    },
  );
  return seq;
}

export async function lockBoards(db: Db, boardIds: number[]): Promise<void> {
  await db.query("SELECT id FROM boards WHERE id = ANY($1) ORDER BY id FOR UPDATE", [[...new Set(boardIds)]]);
}
