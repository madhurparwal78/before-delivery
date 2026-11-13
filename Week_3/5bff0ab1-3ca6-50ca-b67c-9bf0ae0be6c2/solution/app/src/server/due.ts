import { FINISHES, HUBS, MODELS, type HubId } from "../shared/catalogue.js";
import { istParts } from "../shared/clock.js";
import { Changes, allStatuses, markLedgerDown, nudge } from "./core.js";
import { q, tx, type Db } from "./db.js";
import { LedgerDamaged, LedgerDown, ledger } from "./ledger.js";
import { deliveryClosesAt, isPastCutOff, slotsOf } from "./rules.js";

/**
 * Work that falls due with the app clock: a hub's sequence at each instant that changes what screens show, lock expiry,
 * the end of a wait line and the removal of ended holds from the ledger. Every step is idempotent across copies.
 */

/** Changes whenever something time-driven on a hub's screens changes: each IST hour, slot start and slot cut-off. */
function hubSignature(nowMs: number): string {
  const p = istParts(nowMs);
  const slots = slotsOf(p.date);
  const passed = slots.filter((start) => start <= nowMs).length + slots.filter((start) => isPastCutOff(start, nowMs)).length;
  return `${p.date}T${p.hour}:${passed}`;
}

async function syncHubClocks(nowMs: number): Promise<void> {
  const signature = hubSignature(nowMs);
  const bumped = await q<{ hub: string; seq: number }>(
    "UPDATE hub_state SET sig=$1, seq = seq + (CASE WHEN sig = '' THEN 0 ELSE 1 END) WHERE sig <> $1 RETURNING hub, seq",
    [signature],
  );
  for (const b of bumped) ledger.publishLive(b.hub, b.seq);
  if (bumped.length > 0) nudge();
}

export async function expireLocks(nowMs: number): Promise<boolean> {
  const probe = await q("SELECT 1 FROM locks WHERE state IN ('requested','locked') AND expires_ms <= $1 LIMIT 1", [nowMs]);
  if (probe.length === 0) return false;
  const changes = new Changes();
  const ended = await tx(async (c) => {
    const rows = await q<{ id: string; hub: HubId; rider_id: string; waiting_for: string | null }>(
      "SELECT id, hub, rider_id, waiting_for FROM locks WHERE state IN ('requested','locked') AND expires_ms <= $1 ORDER BY id FOR UPDATE",
      [nowMs],
      c,
    );
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    await q("UPDATE locks SET state='expired', waiting_for=NULL, wait_seq=NULL WHERE id = ANY($1)", [ids], c);
    await q("UPDATE notices SET state='cancelled' WHERE lock_id = ANY($1) AND state='pending'", [ids], c);
    for (const r of rows) {
      changes.hub(r.hub).rider(r.rider_id);
      if (r.waiting_for) await lineMates(changes, r.hub, r.waiting_for, c);
    }
    await changes.apply(c);
    return rows.length;
  });
  if (ended > 0) changes.publish();
  return ended > 0;
}

/** Riders waiting behind a lock that left a line see their number change. */
export async function lineMates(changes: Changes, hub: HubId, date: string, c: Db): Promise<void> {
  const mates = await q<{ rider_id: string }>("SELECT rider_id FROM locks WHERE hub=$1 AND waiting_for=$2 AND state='locked'", [hub, date], c);
  changes.rider(...mates.map((m) => m.rider_id));
}

async function endLines(nowMs: number): Promise<void> {
  const waiting = await q<{ id: string; hub: HubId; rider_id: string; waiting_for: string }>("SELECT id, hub, rider_id, waiting_for FROM locks WHERE waiting_for IS NOT NULL");
  const closed = waiting.filter((w) => deliveryClosesAt(w.waiting_for) <= nowMs);
  if (closed.length === 0) return;
  const changes = new Changes();
  await tx(async (c) => {
    const done = await q<{ id: string }>("UPDATE locks SET waiting_for=NULL, wait_seq=NULL WHERE id = ANY($1) AND waiting_for IS NOT NULL RETURNING id", [closed.map((w) => w.id)], c);
    const ids = new Set(done.map((d) => d.id));
    for (const w of closed) if (ids.has(w.id)) changes.hub(w.hub).rider(w.rider_id);
    await changes.apply(c);
  });
  changes.publish();
}

/** Takes ended holds out of the ledger; a unit returns only once the ledger confirms removal. */
async function removeEndedHolds(nowMs: number, trim: boolean): Promise<void> {
  const pending = await q<{ id: string; ref: string; hub: HubId; model: string; finish: string }>("SELECT id, ref, hub, model, finish FROM locks WHERE state='expired' AND in_ledger LIMIT 200");
  if (pending.length === 0 && !trim) return;
  const status = await allStatuses();
  if (status.some((s) => s.ledgerDown)) return;
  try {
    const changes = new Changes();
    const confirmed: string[] = [];
    for (const l of pending) {
      await ledger.removeHold(l.hub, l.model, l.finish, l.ref);
      confirmed.push(l.id);
      changes.hub(l.hub);
    }
    if (trim) {
      for (const hub of HUBS) for (const m of MODELS) for (const f of FINISHES) await ledger.trimHolds(hub.id, m.id, f.id, nowMs);
    }
    if (confirmed.length > 0) {
      await tx(async (c) => {
        await q("UPDATE locks SET in_ledger=false WHERE id = ANY($1)", [confirmed], c);
        await changes.apply(c);
      });
      changes.publish();
    }
  } catch (error) {
    if (error instanceof LedgerDown) await markLedgerDown();
    else if (!(error instanceof LedgerDamaged)) throw error;
  }
}

export async function runDue(nowMs: number, trim = false): Promise<void> {
  await syncHubClocks(nowMs);
  const expired = await expireLocks(nowMs);
  await endLines(nowMs);
  await removeEndedHolds(nowMs, trim || expired);
}

