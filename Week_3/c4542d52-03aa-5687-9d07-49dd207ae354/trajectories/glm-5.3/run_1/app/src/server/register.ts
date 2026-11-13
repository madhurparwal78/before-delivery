import type { PoolClient } from 'pg';
import { markDate, vestedOn, type VestingInputs } from './vesting.js';
import { readGrants } from './grantReader.js';
import { serverDate } from './time.js';

export type GrantState = 'draft' | 'board_queue' | 'approved' | 'offered' | 'accepted' | 'expired';
export type Role = 'founder_admin' | 'board_member' | 'option_holder' | 'leaver' | 'investor';
export type Access = 'active' | 'removed' | 'none';

export interface GrantRow {
  id: string;
  holder_id: string;
  holder_name: string;
  options: number;
  strike: string;
  vesting_type: 'standard' | 'monthly';
  vesting_start: string;
  state: GrantState;
  draft_version: number;
  offered_at: Date | null;
  offer_expires_at: Date | null;
  accepted_at: Date | null;
  agreement_document_id: string | null;
  forfeited: number;
  cancelled: number;
  created_at: Date;
  termination_date: string | null;
  window_ends_at: Date | null;
}

export interface PersonRec {
  id: string;
  name: string;
  first_name: string;
  email: string;
  role: Role;
  access: Access;
  terminated_at: Date | null;
  termination_date: string | null;
  window_ends_at: Date | null;
}

export async function personById(client: PoolClient | undefined, id: string): Promise<PersonRec | null> {
  const { pool } = await import('./db.js');
  const query = client ? client.query.bind(client) : pool.query.bind(pool);
  const r = await query<PersonRec>('SELECT * FROM people WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

export async function personByEmail(email: string): Promise<(PersonRec & { password_hash: string }) | null> {
  const { pool } = await import('./db.js');
  const r = await pool.query('SELECT * FROM people WHERE email = $1', [email.toLowerCase()]);
  return r.rows[0] ?? null;
}

export interface GrantFigures {
  vested: number;
  exercised: number;
  in_open_orders: number;
  exercisable: number;
}

export async function grantFigures(client: PoolClient, grant: GrantRow, at: Date): Promise<GrantFigures> {
  const exercised = await sumExercised(client, grant.id);
  const open = await sumOpenOrders(client, grant.id);
  const vested = grossVested(grant, serverDate(at));
  const exercisable = vested - exercised - grant.cancelled - open;
  return { vested, exercised, in_open_orders: open, exercisable: Math.max(0, exercisable) };
}

export function grossVested(grant: GrantRow, serverDateStr: string): number {
  const inputs: VestingInputs = {
    options: Number(grant.options),
    vestingType: grant.vesting_type,
    vestingStart: grant.vesting_start,
  };
  return vestedOn(inputs, serverDateStr);
}

export async function sumExercised(client: PoolClient, grantId: string): Promise<number> {
  const r = await client.query<{ total: string | null }>(
    "SELECT coalesce(sum(options),0)::text AS total FROM exercise_orders WHERE grant_id = $1 AND state = 'issued'",
    [grantId],
  );
  return Number(r.rows[0]?.total ?? 0);
}

export async function sumOpenOrders(client: PoolClient, grantId: string): Promise<number> {
  const r = await client.query<{ total: string | null }>(
    "SELECT coalesce(sum(options),0)::text AS total FROM exercise_orders WHERE grant_id = $1 AND state IN ('pending','held')",
    [grantId],
  );
  return Number(r.rows[0]?.total ?? 0);
}

/** Pool figures per Business rules. */
export async function poolFigures(client: PoolClient): Promise<{
  authorized: number; outstanding: number; exercised: number; reserved: number; available: number; unallocated: number;
}> {
  const auth = await client.query<{ authorized: string }>('SELECT authorized::text FROM option_pool WHERE id = 1');
  const authorized = Number(auth.rows[0]?.authorized ?? 0);
  let outstanding = 0;
  let exercised = 0;
  let reserved = 0;
  const grants = await readGrants(client);
  for (const g of grants) {
    const ex = await sumExercised(client, g.id);
    const openOrders = await sumOpenOrders(client, g.id);
    if (g.state === 'accepted') {
      outstanding += Number(g.options) - ex - g.cancelled - g.forfeited - openOrders;
    } else if (g.state === 'board_queue' || g.state === 'approved' || g.state === 'offered') {
      reserved += Number(g.options);
    }
    exercised += ex;
  }
  const available = authorized - outstanding - exercised - reserved;
  const unallocated = authorized - outstanding - exercised;
  return { authorized, outstanding, exercised, reserved, available, unallocated };
}

/** Fully diluted total = every issued share + every outstanding option + unallocated pool. */
export async function fullyDilutedTotal(client: PoolClient): Promise<number> {
  const shares = await client.query<{ total: string }>('SELECT coalesce(sum(shares),0)::text AS total FROM share_holdings');
  const pool = await poolFigures(client);
  return Number(shares.rows[0]?.total ?? 0) + pool.outstanding + pool.unallocated;
}

/** Issued shares per holder per class. */
export async function holdingsByHolder(client: PoolClient): Promise<Map<string, number>> {
  const r = await client.query<{ person_id: string; total: string }>(
    'SELECT person_id, coalesce(sum(shares),0)::text AS total FROM share_holdings GROUP BY person_id',
  );
  const map = new Map<string, number>();
  for (const row of r.rows) map.set(row.person_id, Number(row.total));
  return map;
}

/** Options outstanding per holder (accepted grants only, net of exercised/cancelled/forfeited). */
export async function optionsOutstandingByHolder(client: PoolClient): Promise<Map<string, number>> {
  const rows = await readGrants(client, "g.state = 'accepted'");
  const map = new Map<string, number>();
  for (const g of rows) {
    const ex = await sumExercised(client, g.id);
    const open = await sumOpenOrders(client, g.id);
    const net = Number(g.options) - ex - g.cancelled - g.forfeited - open;
    map.set(g.holder_id, (map.get(g.holder_id) ?? 0) + Math.max(0, net));
  }
  return map;
}

export function trancheDates(grant: GrantRow): string[] {
  const dates: string[] = [];
  for (let m = 1; m <= 48; m++) dates.push(markDate(grant.vesting_start, m));
  return dates;
}
