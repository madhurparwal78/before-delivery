import { PoolClient } from "pg";

/**
 * The one borrowing-pause rule: a member is paused while any of their
 * loans is not yet returned and now is strictly after its due instant.
 */
export async function isBorrowingPaused(client: PoolClient, memberId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM loans l, library lib
      WHERE l.member_id = $1 AND l.status = 'out'
        AND now() > ((l.due_date::text || ' ' || lib.closing_time)::timestamp AT TIME ZONE lib.time_zone)
      LIMIT 1`,
    [memberId],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * The one borrowing-limit rule: requested holds, plus ready holds whose
 * pickup deadline has not passed, plus out and overdue loans.
 * A slot is judged free the moment a hold is cancelled, a loan is checked
 * in or a pickup deadline passes, without waiting for the sweeper.
 */
export async function activeCount(client: PoolClient, memberId: string): Promise<number> {
  const result = await client.query(
    `SELECT
       (SELECT count(*) FROM holds
         WHERE member_id = $1
           AND (status = 'requested' OR (status = 'ready' AND pickup_deadline > now())))::int
       +
       (SELECT count(*) FROM loans
         WHERE member_id = $1 AND status = 'out')::int AS count`,
    [memberId],
  );
  return result.rows[0].count as number;
}

export async function maxActivePerMember(client: PoolClient): Promise<number> {
  const result = await client.query("SELECT max_active_per_member FROM library WHERE id = 'library'");
  return result.rows[0].max_active_per_member as number;
}
