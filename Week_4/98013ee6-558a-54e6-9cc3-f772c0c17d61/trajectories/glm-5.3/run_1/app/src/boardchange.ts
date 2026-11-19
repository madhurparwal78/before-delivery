import type { Db } from "./db";
import { businessNow } from "./clock";
import { boardOrder, boardPinCount } from "./boardjson";
import {
  broadcastBoard,
  type BoardChangeKind,
} from "./live";
import type { UserRef } from "./domain";

export interface ChangePin { id: number; title: string }
export interface ChangeSection { id: number; name: string }

/**
 * Each board change raises seq by one and sends exactly one board message (DP-49, DP-50).
 * Returns the new seq. `lastSaved` sets last_saved_at per the Last saved to rule.
 */
export async function applyBoardChange(
  db: Db,
  args: {
    boardId: number;
    actor: UserRef;
    change: BoardChangeKind;
    pin?: ChangePin | null;
    section?: ChangeSection | null;
    lastSaved?: boolean;
  }
): Promise<number> {
  const now = businessNow();
  const seq = await db.queryOne<{ seq: string }>(
    `update boards set seq = seq + 1${args.lastSaved ? ", last_saved_at = $2" : ""} where id = $1 returning seq`,
    args.lastSaved ? [args.boardId, now] : [args.boardId]
  );
  const newSeq = Number(seq!.seq);
  const [order, pinCount] = await Promise.all([
    boardOrder(db, args.boardId),
    boardPinCount(db, args.boardId),
  ]);
  await broadcastBoard({
    type: "board",
    board_id: args.boardId,
    seq: newSeq,
    actor: { id: args.actor.id, name: args.actor.name },
    change: args.change,
    pin: args.pin ?? null,
    section: args.section ?? null,
    pin_count: pinCount,
    order,
  });
  return newSeq;
}

export async function bumpSeq(db: Db, boardId: number): Promise<void> {
  await db.query(`update boards set seq = seq + 1 where id = $1`, [boardId]);
}
