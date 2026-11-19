import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { rows, one, lock, LOCK_MEMBER, type Queryable } from '../db';
import type { BalancesJson, LedgerAccount, LotJson, MovementKind, Role } from '../../shared/types';
import { addDays, daysBetween, localDateOf, localToInstant } from '../../shared/tz';

export interface Actor {
  userId: string;
  name: string;
  role: Role;
}

export interface LotAllocation {
  lotId: string;
  quarters: number;
}

export interface LotRow {
  id: string;
  purchase_id: string | null;
  pack_name: string;
  valid_through: string | null;
  remainder: number;
  seq: string;
}

const MOVEMENT_ACCOUNTS: Record<MovementKind, { from: LedgerAccount; to: LedgerAccount }> = {
  opening_balance: { from: 'opening_balance', to: 'available' },
  pack_purchase: { from: 'pack_sales', to: 'available' },
  booking_debit: { from: 'available', to: 'committed' },
  hold_release: { from: 'committed', to: 'available' },
  cancel_refund: { from: 'committed', to: 'available' },
  forfeit: { from: 'committed', to: 'forfeited' },
  usage: { from: 'committed', to: 'used' },
  late_checkout: { from: 'available', to: 'used' },
  pack_expiry: { from: 'available', to: 'expired' },
};

export function movementAccounts(kind: MovementKind): { from: LedgerAccount; to: LedgerAccount } {
  return MOVEMENT_ACCOUNTS[kind];
}

/** +1 when the movement puts hours into `available`, -1 when it takes them out, 0 otherwise. */
export function lotDirection(kind: MovementKind): number {
  const accounts = MOVEMENT_ACCOUNTS[kind];
  if (accounts.to === 'available') return 1;
  if (accounts.from === 'available') return -1;
  return 0;
}

export interface RecordMovementInput {
  tenantId: string;
  memberId: string;
  kind: MovementKind;
  quarters: number;
  createdAtMs: number;
  actor: Actor | null;
  bookingId?: string | null;
  purchaseId?: string | null;
  lots?: LotAllocation[];
}

export async function recordMovement(
  client: PoolClient,
  input: RecordMovementInput,
): Promise<string> {
  const accounts = MOVEMENT_ACCOUNTS[input.kind];
  const movementId = randomUUID();
  const createdAt = new Date(input.createdAtMs).toISOString();
  await client.query(
    `insert into movements (id, tenant_id, member_id, kind, booking_id, purchase_id, quarters,
       created_at, actor_user_id, actor_name, actor_role)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      movementId,
      input.tenantId,
      input.memberId,
      input.kind,
      input.bookingId ?? null,
      input.purchaseId ?? null,
      input.quarters,
      createdAt,
      input.actor === null ? null : input.actor.userId,
      input.actor === null ? null : input.actor.name,
      input.actor === null ? null : input.actor.role,
    ],
  );
  await client.query(
    `insert into movement_entries (movement_id, member_id, account, quarters, position)
     values ($1,$2,$3,$4,0), ($1,$2,$5,$6,1)`,
    [movementId, input.memberId, accounts.from, -input.quarters, accounts.to, input.quarters],
  );
  const direction = lotDirection(input.kind);
  const allocations = input.lots ?? [];
  for (let index = 0; index < allocations.length; index += 1) {
    const allocation = allocations[index] as LotAllocation;
    await client.query(
      `insert into movement_lots (movement_id, lot_id, quarters, direction, position)
       values ($1,$2,$3,$4,$5)`,
      [movementId, allocation.lotId, allocation.quarters, direction, index],
    );
  }
  return movementId;
}

export async function createLot(
  client: PoolClient,
  input: {
    memberId: string;
    purchaseId: string | null;
    packName: string;
    validThrough: string | null;
    createdAtMs: number;
  },
): Promise<string> {
  const lotId = randomUUID();
  await client.query(
    `insert into lots (id, member_id, purchase_id, pack_name, valid_through, created_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      lotId,
      input.memberId,
      input.purchaseId,
      input.packName,
      input.validThrough,
      new Date(input.createdAtMs).toISOString(),
    ],
  );
  return lotId;
}

interface RawLotRow {
  id: string;
  purchase_id: string | null;
  pack_name: string;
  valid_through: string | null;
  remainder: string | null;
  seq: string;
}

/**
 * The member's lots in drawing order: earliest valid-through first, ties by earlier
 * purchase, the opening lot last.
 */
export async function lotRows(client: Queryable, memberId: string): Promise<LotRow[]> {
  const found = await rows<RawLotRow>(
    client,
    `select l.id, l.purchase_id, l.pack_name,
            to_char(l.valid_through, 'YYYY-MM-DD') as valid_through,
            coalesce(sum(ml.quarters * ml.direction), 0) as remainder,
            l.seq::text as seq
       from lots l
       left join movement_lots ml on ml.lot_id = l.id
      where l.member_id = $1
      group by l.id, l.purchase_id, l.pack_name, l.valid_through, l.seq
      order by l.valid_through asc nulls last, l.seq asc`,
    [memberId],
  );
  return found.map((row) => ({
    id: row.id,
    purchase_id: row.purchase_id,
    pack_name: row.pack_name,
    valid_through: row.valid_through,
    remainder: Number(row.remainder ?? 0),
    seq: row.seq,
  }));
}

export async function accountQuarters(
  client: Queryable,
  memberId: string,
  account: LedgerAccount,
): Promise<number> {
  const row = await one<{ total: string | null }>(
    client,
    `select coalesce(sum(quarters), 0) as total from movement_entries
      where member_id = $1 and account = $2`,
    [memberId, account],
  );
  return Number(row?.total ?? 0);
}

/** The instant a lot's hours stop counting: home-site midnight after its valid-through date. */
export function lotExpiryInstant(validThrough: string, homeZone: string): number {
  return localToInstant(homeZone, addDays(validThrough, 1), 0);
}

export function isLotExpired(
  validThrough: string | null,
  homeZone: string,
  nowMs: number,
): boolean {
  if (validThrough === null) return false;
  return nowMs >= lotExpiryInstant(validThrough, homeZone);
}

/** A lot is expiring soon when its valid-through is 0 to 14 home-site days away. */
export function isExpiringSoon(
  validThrough: string | null,
  homeZone: string,
  nowMs: number,
): boolean {
  if (validThrough === null) return false;
  const today = localDateOf(homeZone, nowMs);
  const daysLeft = daysBetween(today, validThrough);
  return daysLeft >= 0 && daysLeft <= 14;
}

/**
 * Expires every lot of the member whose hours have run out of time, in exactly one
 * pack_expiry movement per lot remainder. The caller holds the member lock.
 */
export async function expireMemberLots(
  client: PoolClient,
  member: { id: string; tenant_id: string; home_zone: string },
  nowMs: number,
): Promise<void> {
  const lots = await lotRows(client, member.id);
  for (const lot of lots) {
    if (lot.remainder <= 0) continue;
    if (!isLotExpired(lot.valid_through, member.home_zone, nowMs)) continue;
    await recordMovement(client, {
      tenantId: member.tenant_id,
      memberId: member.id,
      kind: 'pack_expiry',
      quarters: lot.remainder,
      createdAtMs: nowMs,
      actor: null,
      lots: [{ lotId: lot.id, quarters: lot.remainder }],
    });
  }
}

export async function withMemberLock<Result>(
  client: PoolClient,
  memberId: string,
  run: () => Promise<Result>,
): Promise<Result> {
  await lock(client, LOCK_MEMBER, memberId);
  return run();
}

/** Lots with hours left, in drawing order, ignoring hours that have run out of time. */
export async function liveLots(
  client: Queryable,
  memberId: string,
  homeZone: string,
  nowMs: number,
): Promise<LotRow[]> {
  const lots = await lotRows(client, memberId);
  return lots.filter(
    (lot) => lot.remainder > 0 && !isLotExpired(lot.valid_through, homeZone, nowMs),
  );
}

export async function availableQuarters(
  client: Queryable,
  memberId: string,
  homeZone: string,
  nowMs: number,
): Promise<number> {
  const lots = await liveLots(client, memberId, homeZone, nowMs);
  return lots.reduce((total, lot) => total + lot.remainder, 0);
}

/** Draws hours in lot drawing order. Returns null when the member has too few. */
export async function drawFromLots(
  client: Queryable,
  memberId: string,
  homeZone: string,
  nowMs: number,
  quarters: number,
): Promise<LotAllocation[] | null> {
  const lots = await liveLots(client, memberId, homeZone, nowMs);
  const allocations: LotAllocation[] = [];
  let remaining = quarters;
  for (const lot of lots) {
    if (remaining === 0) break;
    const take = Math.min(remaining, lot.remainder);
    if (take > 0) {
      allocations.push({ lotId: lot.id, quarters: take });
      remaining -= take;
    }
  }
  if (remaining > 0) return null;
  return allocations;
}

/**
 * Returns hours to the lots a booking drew from, latest valid-through first, capped by
 * what the booking still owes each lot.
 */
export async function returnToLots(
  client: Queryable,
  bookingId: string,
  quarters: number,
): Promise<LotAllocation[]> {
  const drawn = await rows<{
    lot_id: string;
    drawn: string;
    returned: string;
    valid_through: string | null;
    seq: string;
  }>(
    client,
    `select l.id as lot_id,
            coalesce(sum(case when ml.direction = -1 then ml.quarters else 0 end), 0) as drawn,
            coalesce(sum(case when ml.direction = 1 then ml.quarters else 0 end), 0) as returned,
            to_char(l.valid_through, 'YYYY-MM-DD') as valid_through,
            l.seq::text as seq
       from movement_lots ml
       join movements m on m.id = ml.movement_id
       join lots l on l.id = ml.lot_id
      where m.booking_id = $1
      group by l.id, l.valid_through, l.seq
      order by l.valid_through desc nulls first, l.seq desc`,
    [bookingId],
  );
  const allocations: LotAllocation[] = [];
  let remaining = quarters;
  for (const row of drawn) {
    if (remaining === 0) break;
    const owed = Number(row.drawn) - Number(row.returned);
    const give = Math.min(remaining, owed);
    if (give > 0) {
      allocations.push({ lotId: row.lot_id, quarters: give });
      remaining -= give;
    }
  }
  return allocations;
}

/** Expires hours that landed back in a lot whose time had already run out. */
export async function expireReturnedHours(
  client: PoolClient,
  member: { id: string; tenant_id: string; home_zone: string },
  allocations: LotAllocation[],
  nowMs: number,
): Promise<void> {
  if (allocations.length === 0) return;
  const lots = await lotRows(client, member.id);
  const expiredAllocations: LotAllocation[] = [];
  for (const allocation of allocations) {
    const lot = lots.find((candidate) => candidate.id === allocation.lotId);
    if (lot === undefined) continue;
    if (!isLotExpired(lot.valid_through, member.home_zone, nowMs)) continue;
    expiredAllocations.push({
      lotId: allocation.lotId,
      quarters: Math.min(allocation.quarters, lot.remainder),
    });
  }
  const total = expiredAllocations.reduce((sum, item) => sum + item.quarters, 0);
  if (total <= 0) return;
  await recordMovement(client, {
    tenantId: member.tenant_id,
    memberId: member.id,
    kind: 'pack_expiry',
    quarters: total,
    createdAtMs: nowMs,
    actor: null,
    lots: expiredAllocations,
  });
}

export async function balancesJson(
  client: Queryable,
  member: { id: string; home_zone: string },
  nowMs: number,
): Promise<BalancesJson> {
  const lots = await lotRows(client, member.id);
  const available = await accountQuarters(client, member.id, 'available');
  const committed = await accountQuarters(client, member.id, 'committed');
  const lotJson: LotJson[] = lots
    .filter((lot) => lot.remainder > 0)
    .map((lot) => ({
      purchase_id: lot.purchase_id,
      pack_name: lot.pack_name,
      hours: lot.remainder / 4,
      valid_through: lot.valid_through,
      expiring_soon: isExpiringSoon(lot.valid_through, member.home_zone, nowMs),
    }));
  return {
    available_hours: available / 4,
    committed_hours: committed / 4,
    lots: lotJson,
  };
}
