import type { PoolClient } from 'pg';

/**
 * The hour bank: allowance minus that month's hour ledger, computed on the
 * server. Confirms and moves for one member and month are settled one at a
 * time; requests that change several months take them in ascending order.
 */

export async function lockMemberMonth(client: PoolClient, memberId: string, month: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [memberId, month]);
}

export async function ledgerSum(client: PoolClient, memberId: string, month: string): Promise<number> {
  const result = await client.query<{ sum: string | null }>(
    `SELECT COALESCE(sum(hours),0)::text AS sum FROM hour_ledger WHERE member_id=$1 AND month=$2`,
    [memberId, month],
  );
  return Number(result.rows[0].sum ?? 0);
}

export interface HourBank {
  month: string;
  allowanceHours: number;
  usedHours: number;
  balanceHours: number;
}

export async function hourBank(client: PoolClient, memberId: string, month: string): Promise<HourBank> {
  const member = await client.query<{ allowance_hours: number }>(`SELECT allowance_hours FROM members WHERE id=$1`, [memberId]);
  const allowance = member.rows[0].allowance_hours;
  const used = await ledgerSum(client, memberId, month);
  const balance = Math.max(0, allowance - used);
  return { month, allowanceHours: allowance, usedHours: used, balanceHours: balance };
}

/** usedHours per month equals the member's bookings' hours in confirmed, checked_in, completed or no_show whose current block starts that month. */
export async function usedHours(client: PoolClient, memberId: string, month: string): Promise<number> {
  const result = await client.query<{ sum: string | null }>(
    `SELECT COALESCE(sum(hours),0)::text AS sum FROM bookings
      WHERE member_id=$1 AND status IN ('confirmed','checked_in','completed','no_show')
        AND to_char(local_date,'YYYY-MM')=$2`,
    [memberId, month],
  );
  return Number(result.rows[0].sum ?? 0);
}
