import { serverNow } from './clock';
import { pool, query, withTransaction } from './db';
import { claimKeysFor, enqueueFreedTables } from './domain/claims';
import { loadLayout, requireUnit } from './domain/floor';
import { offerFreedTable } from './domain/waitlist';
import { publishLiveEvent } from './services/events';
import { probeKillBill } from './services/killbill';
import { deliverQueuedEmails, queueLapsedEmail } from './services/mail';
import { deleteOfferKey, probeValkey, releaseSlots, valkeyReachable } from './services/valkey';

interface ExpiredHoldRow {
  hold_id: string;
  date: string;
  time: string;
  party_size: number;
  unit_id: string;
  window_start: Date;
  window_end: Date;
}

async function expireHolds(): Promise<void> {
  const now = serverNow();
  const layout = await loadLayout();
  const expired = await withTransaction(async (client) => {
    const rows = await query<ExpiredHoldRow>(
      client,
      `update holds set status = 'expired'
       where hold_id in (
         select hold_id from holds where status = 'live' and expires_at <= $1 limit 50
       )
       returning hold_id, to_char(date, 'YYYY-MM-DD') as date, time, party_size, unit_id,
         window_start, window_end`,
      [now],
    );
    for (const row of rows.rows) {
      const unit = requireUnit(layout, row.unit_id);
      await enqueueFreedTables(client, row.date, unit.tableIds);
    }
    return rows.rows;
  });

  for (const row of expired) {
    const unit = requireUnit(layout, row.unit_id);
    await releaseSlots(
      claimKeysFor(unit, {
        start: new Date(row.window_start),
        end: new Date(row.window_end),
      }),
      row.hold_id,
    ).catch(() => undefined);
    await publishLiveEvent({
      type: 'hold.expired',
      date: row.date,
      time: row.time,
      tableIds: unit.tableIds,
      partySize: row.party_size,
    });
  }
}

interface LapsedOfferRow {
  offer_id: string;
  entry_id: string;
  date: string;
  time: string;
  starts_at: Date;
  party_size: number;
  unit_id: string;
  window_start: Date;
  window_end: Date;
  email: string;
}

async function lapseOffers(): Promise<void> {
  const now = serverNow();
  const layout = await loadLayout();
  const lapsed = await withTransaction(async (client) => {
    const rows = await query<LapsedOfferRow>(
      client,
      `with ended as (
         update offers set status = 'lapsed'
         where offer_id in (
           select offer_id from offers where status = 'offered' and expires_at <= $1 limit 50
         )
         returning offer_id, entry_id, date, time, starts_at, party_size, unit_id,
           window_start, window_end
       )
       select e.offer_id, e.entry_id, to_char(e.date, 'YYYY-MM-DD') as date, e.time, e.starts_at,
              e.party_size, e.unit_id, e.window_start, e.window_end, w.email
       from ended e join waitlist_entries w on w.entry_id = e.entry_id`,
      [now],
    );
    for (const row of rows.rows) {
      await query(
        client,
        `update waitlist_entries set status = 'lapsed'
         where entry_id = $1 and status = 'offered'`,
        [row.entry_id],
      );
      await queueLapsedEmail(client, {
        to: row.email,
        offerId: row.offer_id,
        startsAt: new Date(row.starts_at),
      });
      const unit = requireUnit(layout, row.unit_id);
      await enqueueFreedTables(client, row.date, unit.tableIds);
    }
    return rows.rows;
  });

  for (const row of lapsed) {
    const unit = requireUnit(layout, row.unit_id);
    await releaseSlots(
      claimKeysFor(unit, {
        start: new Date(row.window_start),
        end: new Date(row.window_end),
      }),
      row.offer_id,
    ).catch(() => undefined);
    await deleteOfferKey(row.offer_id).catch(() => undefined);
    await publishLiveEvent({
      type: 'offer.lapsed',
      date: row.date,
      time: row.time,
      tableIds: unit.tableIds,
      partySize: row.party_size,
    });
  }
}

async function processFreedTables(): Promise<void> {
  if (!valkeyReachable()) return;
  for (let processed = 0; processed < 20; processed += 1) {
    const claimed = await query<{ id: string; date: string; table_id: string }>(
      pool,
      `update freed_tables set processed_at = now()
       where id = (
         select id from freed_tables where processed_at is null order by id
         for update skip locked limit 1
       )
       returning id, to_char(date, 'YYYY-MM-DD') as date, table_id`,
    );
    const job = claimed.rows[0];
    if (!job) return;
    try {
      await offerFreedTable(job.date, job.table_id);
    } catch {
      await query(pool, 'update freed_tables set processed_at = null where id = $1', [job.id]);
      return;
    }
  }
}

function repeat(action: () => Promise<void>, everyMs: number): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    action()
      .catch((error: unknown) => {
        console.error('Worker failed', error);
      })
      .finally(() => {
        running = false;
      });
  }, everyMs);
}

export function startWorkers(): NodeJS.Timeout[] {
  return [
    repeat(expireHolds, 500),
    repeat(lapseOffers, 500),
    repeat(processFreedTables, 1000),
    repeat(deliverQueuedEmails, 1000),
    repeat(async () => {
      await probeValkey();
    }, 2500),
    repeat(async () => {
      await probeKillBill();
    }, 2500),
  ];
}
