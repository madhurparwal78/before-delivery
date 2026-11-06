import { PoolClient } from "pg";
import { HoldRow } from "./views";

const HOLD_SELECT = `
  SELECT h.id::text AS id, h.item_id, i.name AS item_name, h.unit_id, u.label AS unit_label, u.lane_index,
         h.member_id, m.name AS member_name, h.status, h.start_date::text AS start_date, h.end_date::text AS end_date,
         h.ready_at, h.pickup_deadline, h.created_at
    FROM holds h
    JOIN items i ON i.id = h.item_id
    JOIN units u ON u.id = h.unit_id
    JOIN users m ON m.id = h.member_id
`;

export async function selectHoldById(client: PoolClient, holdId: string): Promise<HoldRow | null> {
  const result = await client.query(`${HOLD_SELECT} WHERE h.id = $1`, [holdId]);
  return result.rowCount === 0 ? null : (result.rows[0] as unknown as HoldRow);
}

export async function insertHold(
  client: PoolClient,
  values: { id: string; itemId: string; unitId: string; memberId: string; startDate: string; endDate: string },
): Promise<void> {
  await client.query(
    `INSERT INTO holds (id, item_id, unit_id, member_id, status, start_date, end_date)
     VALUES ($1, $2, $3, $4, 'requested', $5, $6)`,
    [values.id, values.itemId, values.unitId, values.memberId, values.startDate, values.endDate],
  );
}

export async function markHoldReady(client: PoolClient, holdId: string, pickupDeadline: Date): Promise<boolean> {
  const result = await client.query(
    `UPDATE holds SET status = 'ready', ready_at = now(), pickup_deadline = $2
      WHERE id = $1 AND status = 'requested'`,
    [holdId, pickupDeadline],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function cancelHoldRow(client: PoolClient, holdId: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE holds SET status = 'cancelled' WHERE id = $1 AND status IN ('requested','ready')`,
    [holdId],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/** Expire ready holds past their deadline; only the copy that updates a row queues its lapse email. */
export async function expireReadyHolds(client: PoolClient): Promise<{ id: string; item_name: string; unit_label: string; member_email: string; pickup_deadline: Date }[]> {
  const result = await client.query(
    `UPDATE holds SET status = 'expired'
      WHERE status = 'ready' AND pickup_deadline <= now()
      RETURNING id::text AS id, pickup_deadline`,
  );
  if (result.rowCount === 0) return [];
  const expired: { id: string; item_name: string; unit_label: string; member_email: string; pickup_deadline: Date }[] = [];
  for (const row of result.rows as { id: string; pickup_deadline: Date }[]) {
    const details = await client.query(
      `SELECT i.name AS item_name, u.label AS unit_label, m.email AS member_email
         FROM holds h JOIN items i ON i.id = h.item_id JOIN units u ON u.id = h.unit_id JOIN users m ON m.id = h.member_id
        WHERE h.id = $1`,
      [row.id],
    );
    const detail = details.rows[0];
    expired.push({
      id: row.id,
      item_name: detail.item_name,
      unit_label: detail.unit_label,
      member_email: detail.member_email,
      pickup_deadline: row.pickup_deadline,
    });
  }
  return expired;
}

export interface HoldPage {
  rows: HoldRow[];
  nextCursor: { k: string; i: string } | null;
}

export async function selectHoldPage(
  client: PoolClient,
  options: {
    memberId?: string;
    status?: string;
    limit: number;
    before?: { k: string; i: string } | null;
    viewerIsMember: boolean;
  },
): Promise<HoldPage> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  // Members see only their own records; staff see all of them.
  if (options.viewerIsMember) {
    params.push(options.memberId);
    conditions.push(`h.member_id = $${params.length}`);
  }
  if (options.status !== undefined) {
    if (options.status === "ready") {
      // A ready hold past its deadline counts as expired in every response and rule.
      conditions.push(`h.status = 'ready' AND h.pickup_deadline > now()`);
    } else {
      params.push(options.status);
      conditions.push(`h.status = $${params.length}`);
    }
  }
  if (options.before !== undefined && options.before !== null) {
    params.push(options.before.k, options.before.i);
    conditions.push(`(h.created_at, h.id) < ($${params.length - 1}, $${params.length})`);
  }
  params.push(options.limit + 1);
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  const result = await client.query(
    `${HOLD_SELECT} ${where} ORDER BY h.created_at DESC, h.id DESC LIMIT $${params.length}`,
    params,
  );
  const rows = result.rows as unknown as HoldRow[];
  let nextCursor: { k: string; i: string } | null = null;
  if (rows.length > options.limit) {
    rows.length = options.limit;
    const last = rows[rows.length - 1];
    nextCursor = { k: last.created_at.toISOString(), i: last.id };
  }
  return { rows, nextCursor };
}
