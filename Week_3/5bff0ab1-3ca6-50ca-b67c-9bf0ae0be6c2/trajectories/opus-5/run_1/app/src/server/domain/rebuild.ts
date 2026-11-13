import {
  FINISHES,
  HUBS,
  MODELS,
  type FinishId,
  type HubId,
  type ModelId,
} from '../../shared/catalogue.js';
import { addIstDays, istDate, istSlotKey } from '../clock.js';
import { query } from '../db.js';
import {
  readOnHand,
  readPlaces,
  writeHolds,
  writeOnHand,
  writePlaces,
  writeSlot,
} from '../ledger.js';
import { deliveryWindow } from './calendar.js';

export interface HoldMember {
  ref: string;
  score: number | 'inf';
}

export async function holdMembersFromPostgres(
  hub: HubId,
  model: ModelId,
  finish: FinishId,
): Promise<HoldMember[]> {
  const rows = await query<{ ref: string; expires_at: Date | null; state: string }>(
    `select ref, expires_at, state from locks
      where hub = $1 and model = $2 and finish = $3 and hold_active`,
    [hub, model, finish],
  );
  return rows.map((row) => ({
    ref: row.ref,
    score: row.expires_at === null ? ('inf' as const) : row.expires_at.getTime(),
  }));
}

/** Keys a claim needs are rebuilt from Postgres when they have gone missing. */
export async function ensureHoldKeys(
  hub: HubId,
  model: ModelId,
  finish: FinishId,
): Promise<void> {
  const onHand = await readOnHand(hub, model, finish);
  if (onHand !== null) return;
  await rebuildHoldKeys(hub, model, finish);
}

export async function rebuildHoldKeys(
  hub: HubId,
  model: ModelId,
  finish: FinishId,
): Promise<void> {
  const row = await query<{ on_hand: number }>(
    'select on_hand from stock where hub = $1 and model = $2 and finish = $3',
    [hub, model, finish],
  );
  await writeOnHand(hub, model, finish, row[0]?.on_hand ?? 0);
  await writeHolds(hub, model, finish, await holdMembersFromPostgres(hub, model, finish));
}

export async function placeMembersFromPostgres(hub: HubId, date: string): Promise<string[]> {
  const seeded = await query<{ taken: number }>(
    'select taken from delivery_seed where hub = $1 and delivery_date = $2',
    [hub, date],
  );
  const members: string[] = [];
  const taken = seeded[0]?.taken ?? 0;
  for (let i = 1; i <= taken; i += 1) members.push(`earlier-sale-${i}`);
  const locks = await query<{ ref: string }>(
    `select ref from locks where hub = $1 and delivery_date = $2 and state in ('delivery_set','delivered')`,
    [hub, date],
  );
  for (const lock of locks) members.push(lock.ref);
  return members;
}

export async function ensurePlacesKey(hub: HubId, date: string): Promise<void> {
  const expected = await placeMembersFromPostgres(hub, date);
  if (expected.length === 0) return;
  const held = await readPlaces(hub, date);
  if (held.length === expected.length) return;
  await writePlaces(hub, date, expected);
}

export async function rebuildAllKeys(): Promise<void> {
  for (const h of HUBS) {
    for (const m of MODELS) {
      for (const f of FINISHES) await rebuildHoldKeys(h.id, m.id, f.id);
    }
  }
  const rides = await query<{ hub: string; starts_at: Date; id: string }>(
    `select hub, starts_at, id from rides where state = 'booked'`,
  );
  for (const ride of rides) {
    await writeSlot(ride.hub as HubId, istSlotKey(ride.starts_at), ride.id);
  }
  const dates = new Set<string>();
  const seeded = await query<{ hub: string; delivery_date: string }>(
    'select hub, delivery_date from delivery_seed',
  );
  for (const row of seeded) dates.add(`${row.hub}:${row.delivery_date}`);
  const held = await query<{ hub: string; delivery_date: string }>(
    `select distinct hub, delivery_date from locks where delivery_date is not null`,
  );
  for (const row of held) dates.add(`${row.hub}:${row.delivery_date}`);
  for (const entry of dates) {
    const [hub, date] = entry.split(':') as [HubId, string];
    await writePlaces(hub, date, await placeMembersFromPostgres(hub, date));
  }
}

export async function liveDeliveryDates(now: Date): Promise<Map<HubId, string[]>> {
  const today = istDate(now);
  const byHub = new Map<HubId, string[]>();
  for (const h of HUBS) byHub.set(h.id, deliveryWindow(now).concat([today, addIstDays(today, 1)]));
  const rows = await query<{ hub: string; delivery_date: string }>(
    `select distinct hub, delivery_date from locks where delivery_date is not null
     union select hub, delivery_date from delivery_seed`,
  );
  for (const row of rows) {
    const list = byHub.get(row.hub as HubId) ?? [];
    if (!list.includes(row.delivery_date)) list.push(row.delivery_date);
    byHub.set(row.hub as HubId, list);
  }
  return byHub;
}
