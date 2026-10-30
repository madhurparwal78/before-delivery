import type { Movement, MovementEntry, MovementKind } from '../../shared/types.js';
import { query, queryOne, type Sql } from '../db/pool.js';
import { newId } from './secrets.js';

export const PACK_QUARTERS = 80;

/** Every movement is two opposite entries whose quarters sum to zero. */
function entriesFor(kind: MovementKind, quarters: number): MovementEntry[] {
  switch (kind) {
    case 'purchase':
      return [
        { account: 'member_pack', quarters },
        { account: 'pack_sales', quarters: -quarters },
      ];
    case 'draw':
      return [
        { account: 'member_pack', quarters: -quarters },
        { account: 'hours_used', quarters },
      ];
    case 'refund':
      return [
        { account: 'member_pack', quarters },
        { account: 'hours_used', quarters: -quarters },
      ];
  }
}

export async function packBalanceQuarters(client: Sql, memberId: string): Promise<number> {
  const row = await queryOne<{ balance: string }>(
    client,
    `SELECT coalesce(sum(e.quarters), 0)::text AS balance
       FROM pack_entries e
       JOIN pack_movements m ON m.id = e.movement_id
      WHERE m.member_id = $1 AND e.account = 'member_pack'`,
    [memberId],
  );
  return row ? Number(row.balance) : 0;
}

export async function recordMovement(
  client: Sql,
  input: {
    memberId: string;
    kind: MovementKind;
    quarters: number;
    bookingId: string | null;
    reverses: string | null;
    now: Date;
  },
): Promise<string> {
  const id = newId('mov');
  await client.query(
    `INSERT INTO pack_movements (id, member_id, kind, quarters, booking_id, reverses, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.memberId, input.kind, input.quarters, input.bookingId, input.reverses, input.now],
  );
  for (const [index, entry] of entriesFor(input.kind, input.quarters).entries()) {
    await client.query(
      'INSERT INTO pack_entries (movement_id, idx, account, quarters) VALUES ($1, $2, $3, $4)',
      [id, index, entry.account, entry.quarters],
    );
  }
  return id;
}

export async function loadMovements(client: Sql, memberId: string): Promise<Movement[]> {
  const rows = await query<{
    id: string;
    kind: MovementKind;
    quarters: number;
    booking_id: string | null;
    reverses: string | null;
    created_at: Date;
  }>(
    client,
    `SELECT id, kind, quarters, booking_id, reverses, created_at
       FROM pack_movements WHERE member_id = $1 ORDER BY seq`,
    [memberId],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    quarters: row.quarters,
    booking_id: row.booking_id,
    reverses: row.reverses,
    created_at: row.created_at.toISOString(),
    entries: entriesFor(row.kind, row.quarters),
  }));
}

export async function drawsOfBooking(
  client: Sql,
  bookingId: string,
): Promise<{ id: string; quarters: number }[]> {
  return query<{ id: string; quarters: number }>(
    client,
    `SELECT m.id, m.quarters
       FROM pack_movements m
      WHERE m.booking_id = $1 AND m.kind = 'draw'
        AND NOT EXISTS (SELECT 1 FROM pack_movements r WHERE r.reverses = m.id)
      ORDER BY m.seq`,
    [bookingId],
  );
}
