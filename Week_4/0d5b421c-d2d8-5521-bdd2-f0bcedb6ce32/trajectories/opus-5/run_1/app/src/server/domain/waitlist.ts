import { serverNow } from '../clock';
import { config } from '../config';
import { pool, query, withTransaction, type Db } from '../db';
import { publishLiveEvent } from '../services/events';
import { queueOfferEmail } from '../services/mail';
import { claimSlots, releaseSlots, setOfferKey } from '../services/valkey';
import { addSeconds } from '../time';
import { claimKeysFor } from './claims';
import { fitsBySeatRange, loadLayout, requireRoom, type Unit } from './floor';
import { eveningWindows, unitFreeForWindow } from './occupancy';
import { depositCents, isBookable, newToken, SLOT_TIMES, slotStartsAt, turnWindow } from './rules';

export interface WaitlistEntryRow {
  entry_id: string;
  seq: string;
  date: string;
  email: string;
  email_lower: string;
  name: string;
  party_size: number;
  earliest: string;
  latest: string;
  status: string;
}

export const ENTRY_COLUMNS = `
  entry_id, seq, to_char(date, 'YYYY-MM-DD') as date, email, email_lower, name, party_size,
  earliest, latest, status
`;

/** 1 plus the number of waiting or offered entries for that date that joined earlier. */
export async function entryPosition(db: Db, date: string, seq: string): Promise<number> {
  const result = await query<{ count: string }>(
    db,
    `select count(*)::text as count from waitlist_entries
     where date = $1 and status in ('waiting', 'offered') and seq < $2`,
    [date, seq],
  );
  return Number(result.rows[0]?.count ?? '0') + 1;
}

function unitsContaining(tableId: string, partySize: number, units: Unit[]): Unit[] {
  return units.filter(
    (unit) => unit.tableIds.includes(tableId) && fitsBySeatRange(unit, partySize),
  );
}

interface OfferPlan {
  entry: WaitlistEntryRow;
  unit: Unit;
  time: string;
  startsAt: Date;
}

/**
 * The waitlist rule for a freed table: the earliest waiting entry whose party fits the table and
 * whose window has a bookable slot with the table free is offered that slot.
 */
export async function offerFreedTable(date: string, tableId: string): Promise<void> {
  const now = serverNow();
  const layout = await loadLayout();
  const entries = await query<WaitlistEntryRow>(
    pool,
    `select ${ENTRY_COLUMNS} from waitlist_entries
     where date = $1 and status = 'waiting' order by seq`,
    [date],
  );
  if (entries.rows.length === 0) return;
  const windows = await eveningWindows(pool, date, now);

  let plan: OfferPlan | null = null;
  for (const entry of entries.rows) {
    const candidates = unitsContaining(tableId, entry.party_size, layout.units);
    if (candidates.length === 0) continue;
    const times = SLOT_TIMES.filter(
      (time) => time >= entry.earliest && time <= entry.latest && isBookable(date, time, now),
    );
    for (const time of times) {
      const startsAt = slotStartsAt(date, time);
      const window = turnWindow(entry.party_size, startsAt);
      const unit = candidates.find((candidate) => unitFreeForWindow(windows, candidate, window));
      if (unit) {
        plan = { entry, unit, time, startsAt };
        break;
      }
    }
    if (plan) break;
  }
  if (!plan) return;

  const offerId = newToken();
  const token = newToken();
  const window = turnWindow(plan.entry.party_size, plan.startsAt);
  const keys = claimKeysFor(plan.unit, window);
  const ttlMs = config.offerSeconds * 1000;
  const claimed = await claimSlots(keys, offerId, ttlMs);
  if (!claimed) return;
  await setOfferKey(offerId, ttlMs);

  const createdAt = serverNow();
  const expiresAt = addSeconds(createdAt, config.offerSeconds);
  const deposit = depositCents(plan.entry.party_size, plan.unit.roomId);
  const room = requireRoom(layout, plan.unit.roomId);
  try {
    await withTransaction(async (client) => {
      const claimedEntry = await query<{ entry_id: string }>(
        client,
        `update waitlist_entries set status = 'offered'
         where entry_id = $1 and status = 'waiting' returning entry_id`,
        [plan.entry.entry_id],
      );
      if (claimedEntry.rowCount === 0) throw new Error('entry already offered');
      await query(
        client,
        `insert into offers(offer_id, entry_id, token, date, time, starts_at, window_start,
           window_end, party_size, unit_id, pair_id, deposit_cents, status, expires_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'offered', $13, now())`,
        [
          offerId,
          plan.entry.entry_id,
          token,
          date,
          plan.time,
          plan.startsAt,
          window.start,
          window.end,
          plan.entry.party_size,
          plan.unit.unitId,
          plan.unit.isPair ? plan.unit.unitId : null,
          deposit,
          expiresAt,
        ],
      );
      for (const id of plan.unit.tableIds) {
        await query(client, 'insert into offer_tables(offer_id, table_id) values ($1, $2)', [
          offerId,
          id,
        ]);
      }
      await queueOfferEmail(client, {
        to: plan.entry.email,
        offerId,
        startsAt: plan.startsAt,
        expiresAt,
        partySize: plan.entry.party_size,
        tableLabel: plan.unit.unitId,
        room: room.name,
        token,
        depositCents: deposit,
      });
    });
  } catch (error) {
    await releaseSlots(keys, offerId).catch(() => undefined);
    throw error;
  }

  await publishLiveEvent({
    type: 'offer.created',
    date,
    time: plan.time,
    tableIds: plan.unit.tableIds,
    partySize: plan.entry.party_size,
    expiresAt,
  });
}
