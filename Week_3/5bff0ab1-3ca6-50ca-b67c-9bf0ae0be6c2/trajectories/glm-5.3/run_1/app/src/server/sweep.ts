// Each sweep runs every 10 seconds of real time on every copy. It writes the
// heartbeat, compares the sequence numbers in Postgres, checks keys against
// Postgres, removes orphan members and restores missing ones. It also applies
// due app-clock instants (expiries, trims, price steps, slot cut-offs, notice sends).
import { pool, n } from "./db";
import { appNowMs, onAppClock, istDateOf, readSharedBias, readSharedFreeze } from "./clock";
import * as ledger from "./ledger";
import {
  
  deliveryClosingMs,
  
  slotCutOffMs,
  
  slotsForDay} from "./domain";
import { HUBS, MODELS, FINISHES, EARLIER_SALES } from "./seed";
import { bumpSeq, setStale, markStockAsOf } from "./store";
import { sendDueNotices } from "./notices";

let sweeping = false;

// The sweep interval.
const SWEEP_MS = 10000;

export async function runSweepOnce(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    // the app clock is shared through Postgres, so a change made through one copy
    // moves this one within a sweep interval
    await readSharedBias(pool.query.bind(pool));
    await readSharedFreeze(pool.query.bind(pool));
    const writeOk = await ledger.ledgerTestWrite();
    if (!writeOk) {
      await markAllStale();
      return;
    }
    const now = appNowMs();
    await applyDueInstants(now);
    await reconcileAllHubs(now);
    await clearStalenessIfHealthy();
    await sendDueNotices();
  } catch (err) {
    process.stderr.write(`sweep error: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    sweeping = false;
  }
}

async function markAllStale(): Promise<void> {
  for (const h of HUBS) {
    const state = await pool.query(`SELECT stale_reason FROM hub_state WHERE hub = $1`, [h.id]);
    const current = state.rowCount ? (state.rows[0] as { stale_reason: string | null }).stale_reason : null;
    if (current === null) {
      await setStale(h.id, "system");
      await bumpSeq(h.id);
    }
  }
}

async function clearStalenessIfHealthy(): Promise<void> {
  // The first good sweep after a ledger outage clears staleness everywhere, within
  // 15 seconds. Damage-based staleness is repaired by reconcileAllHubs instead,
  // which keeps it for at least one full sweep interval.
  for (const h of HUBS) {
    const state = await pool.query(`SELECT stale_reason, counting FROM hub_state WHERE hub = $1`, [h.id]);
    if (state.rowCount === 0) continue;
    const row = state.rows[0] as { stale_reason: string | null; counting: boolean };
    if (row.stale_reason === "count" && row.counting === false) {
      await setStale(h.id, null);
      await bumpSeq(h.id);
    }
  }
}

// Apply instants that fall due: lock expiries, hold trims, delivery-day closings,
// line endings, slot cut-offs and price steps, all on the app clock.
async function applyDueInstants(now: number): Promise<void> {
  // 1. Lock expiry: requested or locked locks whose expiry has passed.
  const expired = await pool.query(
    `SELECT id, ref, hub, model, finish, state, waiting_for FROM locks
     WHERE expires_at_ms IS NOT NULL AND expires_at_ms <= $1 AND state IN ('requested','locked')`,
    [now]
  );
  for (const row of expired.rows as { id: string; ref: string; hub: string; model: string; finish: string; state: string; waiting_for: string | null }[]) {
    await endExpiredLock(row.id, now);
  }

  // 2. Trim holds whose score has passed on the app clock, and free their places.
  for (const h of HUBS) {
    for (const m of MODELS) {
      for (const f of FINISHES) {
        try {
          const removed = await ledger.trimHoldsByScore(h.id, m.id, f.id, now);
          if (removed.length > 0) {
            await bumpSeq(h.id);
          }
        } catch {
          // damaged keys are handled by the reconcile pass
        }
      }
    }
  }

  // 3. Delivery-day closings: locks waiting on a day whose closing has passed leave the line.
  const staleWaiters = await pool.query(
    `SELECT id, waiting_for, hub FROM locks
     WHERE waiting_for IS NOT NULL AND wait_position IS NOT NULL AND state = 'locked'`
  );
  for (const row of staleWaiters.rows as { id: string; waiting_for: string; hub: string }[]) {
    const closing = deliveryClosingMs(row.waiting_for);
    if (now >= closing) {
      await pool.query(
        `UPDATE locks SET waiting_for = NULL, wait_position = NULL, joined_line_ms = NULL WHERE id = $1 AND state = 'locked'`,
        [row.id]
      );
    }
  }

  // 4. Sequence rises at each slot cut-off, each slot start and each lock expiry:
  // rise seq when any such instant fell due since the hub's last noticed instant.
  for (const h of HUBS) {
    await riseSeqAtInstants(h.id, now);
  }
}

async function endExpiredLock(id: string, now: number): Promise<void> {
  // The state change applies only if the lock is still in the state it started from.
  const updated = await pool.query(
    `UPDATE locks SET state = 'expired', waiting_for = NULL, wait_position = NULL, joined_line_ms = NULL
     WHERE id = $1 AND state IN ('requested','locked') RETURNING ref, hub, model, finish`,
    [id]
  );
  if (updated.rowCount === 0) return;
  const row = updated.rows[0] as { ref: string; hub: string; model: string; finish: string };
  // The ledger member is removed when the ledger answers, otherwise at the first
  // sweep after recovery, and only then does its unit return.
  try {
    await ledger.releaseHold(row.hub, row.model, row.finish, row.ref);
  } catch {
    // stays as a hold until removal is confirmed
  }
  await bumpSeq(row.hub);
  // cancel pending lock-ending notices
  await pool.query(
    `UPDATE notices SET state = 'cancelled' WHERE lock_id = $1 AND state = 'pending'`,
    [id]
  );
}

// A hub's sequence rises at each slot's cut-off, each slot's start and each lock
// expiry there. We compare the hub's last-instants marker against the current now.
async function riseSeqAtInstants(hub: string, now: number): Promise<void> {
  const key = `instants:${hub}`;
  const r = await pool.query(`SELECT value FROM app_state WHERE key = $1`, [key]);
  const parsed = r.rowCount ? Number(r.rows[0].value) : 0;
  let last = Number.isFinite(parsed) ? parsed : 0;
  if (last < 0) last = 0;
  if (now <= last) return;
  let changed = false;
  // lock expiries at this hub
  const exp = await pool.query(
    `SELECT expires_at_ms FROM locks WHERE hub = $1 AND expires_at_ms IS NOT NULL AND expires_at_ms > $2 AND expires_at_ms <= $3`,
    [hub, last, now]
  );
  if (exp.rowCount) changed = true;
  // slot cut-offs and starts inside the window
  const dates = new Set<string>();
  const from = istDateOf(Math.min(last, now));
  const to = istDateOf(now);
  let d = from;
  for (let i = 0; i < 30; i++) {
    dates.add(d);
    if (d === to) break;
    const [y, m, dd] = d.split("-").map(Number);
    d = new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);
  }
  for (const date of dates) {
    for (const s of slotsForDay(hub, date)) {
      const cut = slotCutOffMs(s);
      if (cut > last && cut <= now) changed = true;
      if (s > last && s <= now) changed = true;
    }
  }
  // whole IST hours
  const lastHour = Math.floor(last / 3600000);
  const nowHour = Math.floor(now / 3600000);
  if (nowHour > lastHour) changed = true;
  await pool.query(
    `INSERT INTO app_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, String(now)]
  );
  if (changed) await bumpSeq(hub);
}

// Reconcile the ledger against Postgres: remove orphan members, restore missing ones.
async function reconcileAllHubs(now: number): Promise<void> {
  for (const h of HUBS) {
    // how long has this hub been stale? damage must persist at least one sweep interval
    const stBefore = await pool.query(`SELECT stale_reason, stale_since_ms FROM hub_state WHERE hub = $1`, [h.id]);
    const before = stBefore.rowCount
      ? (stBefore.rows[0] as { stale_reason: string | null; stale_since_ms: number | null })
      : null;
    const damageAged =
      before !== null &&
      before.stale_reason === "system" &&
      (n(before.stale_since_ms ?? 0) === 0 || now - n(before.stale_since_ms ?? 0) >= SWEEP_MS);

    let damaged = false;
    for (const m of MODELS) {
      for (const f of FINISHES) {
        try {
          const healthy = await ledger.onHandKeyHealthy(h.id, m.id, f.id);
          if (!healthy) {
            const t = await ledger.keyType(ledger.kOnHand(h.id, m.id, f.id));
            if (t !== "none" && !damageAged) {
              // a damaged key makes this hub stale; it stays stale for at least one
              // full sweep interval, then a later sweep repairs it
              damaged = true;
              continue;
            }
            // a missing key, or a damaged key after its stale interval, is restored
            const pg = await pool.query(`SELECT on_hand FROM on_hand WHERE hub = $1 AND model = $2 AND finish = $3`, [h.id, m.id, f.id]);
            const value = pg.rowCount ? n(pg.rows[0].on_hand) : 0;
            await ledger.writeOnHand(h.id, m.id, f.id, value);
            if (t !== "none") damaged = true; // repaired this sweep; the stale flag clears below
          }
        } catch {
          damaged = true;
        }
      }
    }
    if (damaged) {
      if (damageAged) {
        // the repair has been written; clear the damage staleness now
        await setStale(h.id, null);
        await markStockAsOf(h.id);
        await bumpSeq(h.id);
      } else {
        const state = await pool.query(`SELECT stale_reason FROM hub_state WHERE hub = $1`, [h.id]);
        const current = state.rowCount ? (state.rows[0] as { stale_reason: string | null }).stale_reason : null;
        if (current === null) {
          await setStale(h.id, "system");
          await bumpSeq(h.id);
        }
        continue;
      }
    }
    await reconcileHolds(h.id, now);
    await reconcileSlots(h.id);
    await reconcilePlaces(h.id);
  }
}

async function reconcileHolds(hub: string, now: number): Promise<void> {
  const active = await pool.query(
    `SELECT ref, model, finish, expires_at_ms, state FROM locks
     WHERE hub = $1 AND state IN ('requested','locked','delivery_set')`,
    [hub]
  );
  const expected = new Map<string, { model: string; finish: string; score: number }>();
  for (const row of active.rows as { ref: string; model: string; finish: string; expires_at_ms: number | null; state: string }[]) {
    // A hold's score is its expiry on the app clock, or infinity once a delivery day is set.
    const score = row.state === "delivery_set" ? Number.MAX_SAFE_INTEGER : n(row.expires_at_ms);
    expected.set(row.ref, { model: row.model, finish: row.finish, score });
  }
  for (const m of MODELS) {
    for (const f of FINISHES) {
      const members: { value: string; score: number }[] = [];
      try {
        members.push(...(await ledger.holdsMembersWithScores(hub, m.id, f.id)));
      } catch {
        continue;
      }
      for (const mem of members) {
        if (!expected.has(mem.value)) {
          await ledger.releaseHold(hub, m.id, f.id, mem.value);
        }
      }
    }
  }
  for (const [ref, info] of expected) {
    try {
      await ledger.addHoldIfMissing(hub, info.model, info.finish, ref, info.score);
    } catch {
      // a claim in progress never loses its member to a sweep
    }
  }
}

async function reconcileSlots(hub: string): Promise<void> {
  // Slots are rebuilt from Postgres booked rides.
  const booked = await pool.query(
    `SELECT id, starts_at_ms FROM rides WHERE hub = $1 AND state = 'booked'`,
    [hub]
  );
  for (const row of booked.rows as { id: string; starts_at_ms: string | number }[]) {
    await ledger.setSlotIfMissing(hub, n(row.starts_at_ms), row.id);
  }
}

async function reconcilePlaces(hub: string): Promise<void> {
  // Places are locks in delivery_set or delivered at that hub and date, plus earlier sales.
  const taken = await pool.query(
    `SELECT ref, delivery_date FROM locks WHERE hub = $1 AND state IN ('delivery_set','delivered') AND delivery_date IS NOT NULL`,
    [hub]
  );
  const byDate = new Map<string, Set<string>>();
  for (const sale of EARLIER_SALES) {
    if (sale.hub !== hub) continue;
    const set = byDate.get(sale.date) ?? new Set<string>();
    for (let i = 1; i <= sale.count; i++) set.add(`earlier-sale-${i}`);
    byDate.set(sale.date, set);
  }
  for (const row of taken.rows as { ref: string; delivery_date: string }[]) {
    const set = byDate.get(row.delivery_date) ?? new Set<string>();
    set.add(row.ref);
    byDate.set(row.delivery_date, set);
  }
  // read current ledger places per date within the window
  const dates = new Set<string>(byDate.keys());
  for (const [date] of dates) {
    try {
      const members = await ledger.placesMembers(hub, date);
      const expected = byDate.get(date) ?? new Set<string>();
      for (const mem of members) {
        if (!expected.has(mem)) await ledger.removePlace(hub, date, mem);
      }
      for (const mem of expected) {
        await ledger.addPlaceIfMissing(hub, date, mem);
      }
    } catch {
      // a later sweep retries
    }
  }
}

export function startSweep(): void {
  void runSweepOnce();
  const timer = setInterval(() => {
    void runSweepOnce();
  }, SWEEP_MS);
  timer.unref?.();
  onAppClock(() => {
    void runSweepOnce();
  });
}
