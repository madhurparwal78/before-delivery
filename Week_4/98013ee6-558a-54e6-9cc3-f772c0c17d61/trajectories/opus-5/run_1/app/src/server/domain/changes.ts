import type { Queryable } from '../db.js';
import { publish } from '../live.js';
import type { BoardChange } from '../../shared/types.js';

export interface Actor {
  id: number;
  name: string;
}

/** Every board change raises the board's sequence by exactly one and sends one message. */
export async function recordBoardChange(
  db: Queryable,
  boardId: number,
  actor: Actor,
  change: BoardChange,
  pin: { id: number; title: string } | null = null,
  section: { id: number; name: string } | null = null,
): Promise<number> {
  const result = await db.query<{ seq: number }>(
    'update boards set seq = seq + 1 where id = $1 returning seq',
    [boardId],
  );
  const seq = result.rows[0]?.seq ?? 0;
  await publish(
    { k: 'board', board_id: boardId, seq, actor: { id: actor.id, name: actor.name }, change, pin, section },
    db,
  );
  return seq;
}

export async function setLastSaved(
  db: Queryable,
  boardId: number,
  at: Date | null,
): Promise<void> {
  await db.query('update boards set last_saved_at = $2 where id = $1', [
    boardId,
    at === null ? null : at.toISOString(),
  ]);
}

export async function announceCounts(db: Queryable, pinId: number): Promise<void> {
  await publish({ k: 'counts', pin_id: pinId }, db);
}
