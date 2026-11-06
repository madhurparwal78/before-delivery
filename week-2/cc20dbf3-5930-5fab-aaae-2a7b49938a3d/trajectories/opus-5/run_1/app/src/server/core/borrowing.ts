import type { Queryable } from '../db/queryable.js';
import { fail } from '../http/apiError.js';
import type { LibrarySettings } from './library.js';

/** A member's borrowing is paused while any of their loans is overdue now. */
export async function borrowingIsPaused(
  db: Queryable,
  memberId: string,
  now: Date,
): Promise<boolean> {
  const result = await db.query<{ one: number }>(
    `select 1 as one from loan
     where member_id = $1 and status = 'out' and due_at < $2 limit 1`,
    [memberId, now],
  );
  return result.rows.length > 0;
}

/** Requested holds, ready holds still collectable, and loans out or overdue. */
export async function activeCount(db: Queryable, memberId: string, now: Date): Promise<number> {
  const result = await db.query<{ total: string }>(
    `select (
       (select count(*) from hold
        where member_id = $1
          and (status = 'requested' or (status = 'ready' and pickup_deadline > $2)))
       +
       (select count(*) from loan where member_id = $1 and status = 'out')
     ) as total`,
    [memberId, now],
  );
  return Number(result.rows[0]?.total ?? '0');
}

/** The two checks a member must pass before taking a new hold or a new loan. */
export async function requireBorrowingAllowed(
  db: Queryable,
  library: LibrarySettings,
  memberId: string,
  now: Date,
  checkLimit: boolean,
): Promise<void> {
  if (await borrowingIsPaused(db, memberId, now)) throw fail('borrowing_paused');
  if (!checkLimit) return;
  const count = await activeCount(db, memberId, now);
  if (count >= library.maxActivePerMember) throw fail('borrowing_limit');
}
