import type { Queryable } from '../db.js';
import { iso, isoRequired } from '../clock.js';
import type { Board } from '../../shared/types.js';
import { boardOrder, coverPinId, loadPinsInOrder, orderedPinIds } from './pins.js';
import { roleOf, type BoardRecord } from './visibility.js';

export async function serializeBoard(
  db: Queryable,
  board: BoardRecord,
  viewerId: number,
): Promise<Board> {
  const order = await boardOrder(db, board.id);
  const ids = orderedPinIds(order);
  const pins = await loadPinsInOrder(db, ids, viewerId);
  const followers = await db.query<{ n: number }>(
    'select count(*)::int as n from follows_boards where board_id = $1',
    [board.id],
  );
  const following = await db.query<{ n: number }>(
    'select count(*)::int as n from follows_boards where board_id = $1 and follower_id = $2',
    [board.id, viewerId],
  );
  const cover = await coverPinId(db, board.id, board.cover_pin_id);
  return {
    id: board.id,
    name: board.name,
    visibility: board.visibility,
    owner: { id: board.owner_id, name: board.owner_name, handle: board.owner_handle },
    role: roleOf(board, viewerId),
    seq: board.seq,
    pin_count: ids.length,
    followers: followers.rows[0]?.n ?? 0,
    following: (following.rows[0]?.n ?? 0) > 0,
    cover,
    created_at: isoRequired(board.created_at),
    last_saved_at: iso(board.last_saved_at),
    order,
    pins,
  };
}

/** The `Last saved to` order: newest first, nulls last, ties by id ascending. */
export const LAST_SAVED_ORDER = 'order by b.last_saved_at desc nulls last, b.id asc';
