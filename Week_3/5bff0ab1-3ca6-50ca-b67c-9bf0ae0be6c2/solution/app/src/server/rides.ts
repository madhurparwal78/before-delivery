import { randomUUID } from "node:crypto";
import { isHub, isModel, type HubId, type ModelId } from "../shared/catalogue.js";
import { isDate, istDate, parseInstant } from "../shared/clock.js";
import type { Ride } from "../shared/types.js";
import type { UserRow } from "./auth.js";
import { Changes, guarded, now } from "./core.js";
import { advisory, one, q, tx } from "./db.js";
import { ApiError, fail } from "./errors.js";
import { jsonObject } from "./http.js";
import { ledger } from "./ledger.js";
import { addNotice, cancelRideNotices, rideReminderDue } from "./notices.js";
import { isBookableStart, isPastCutOff, mayMark, slotMinute } from "./rules.js";
import { TAKEN_SQL, serializeRide, type RideRow } from "./views.js";

const LICENCE = /^[A-Z]{2}\d{13}$/;

export async function ownRide(rider: UserRow, id: string): Promise<RideRow> {
  const row = (await q<RideRow>("SELECT * FROM rides WHERE id=$1", [id]))[0];
  if (!row || row.rider_id !== rider.id) throw fail("not_found");
  return row;
}

/** Maps the unique indexes that guard a slot and a rider's one booked ride to their refusals. */
const refusalOf = (error: unknown): never => {
  const e = error as { code?: string; constraint?: string };
  if (e.code === "23505") throw fail(e.constraint === "rides_one_booked" ? "ride_exists" : "slot_taken");
  throw error;
};

/** Repairs a slot key that Postgres says is held, so the ledger agrees with the record that won. */
async function restoreSlotKey(hub: HubId, startMs: number): Promise<void> {
  const holder = await one<{ id: string }>(`SELECT id FROM rides WHERE hub=$1 AND starts_ms=$2 AND state='booked'`, [hub, startMs]);
  if (holder) await ledger.setSlot(hub, slotMinute(startMs), holder.id).catch(() => undefined);
}

export async function bookRide(rider: UserRow, body: unknown): Promise<{ status: 200 | 201; ride: Ride }> {
  const b = jsonObject(body);
  if (!b || !isHub(b.hub) || !isModel(b.model)) throw fail("invalid_body");
  const { hub, model } = b as { hub: HubId; model: ModelId };
  const startMs = typeof b.startsAt === "string" ? parseInstant(b.startsAt) : null;
  const at = await now();
  const booked = await one<RideRow>("SELECT * FROM rides WHERE rider_id=$1 AND model=$2 AND state='booked'", [rider.id, model]);
  if (booked) {
    if (booked.hub === hub && startMs === booked.starts_ms) return { status: 200, ride: serializeRide(booked, at) };
    throw fail("ride_exists");
  }
  const inPattern = startMs !== null && isBookableStart(hub, startMs, at);
  if (inPattern && isPastCutOff(startMs, at)) throw fail("ride_cut_off");
  if (inPattern && (await one(`SELECT 1 FROM rides WHERE hub=$1 AND starts_ms=$2 AND state IN ${TAKEN_SQL}`, [hub, startMs]))) {
    await restoreSlotKey(hub, startMs);
    throw fail("slot_taken");
  }
  if (startMs === null || typeof b.licenceNumber !== "string" || !isDate(b.licenceValidUntil) || typeof b.hasMcwg !== "boolean") throw fail("invalid_body");
  if (!inPattern) throw fail("invalid_slot");
  const licence = b.licenceNumber.replace(/[\s-]/g, "").toUpperCase();
  if (!LICENCE.test(licence)) throw fail("licence_invalid");
  if (!b.hasMcwg) throw fail("mcwg_required");
  if (b.licenceValidUntil < istDate(startMs)) throw fail("licence_expired");
  const id = randomUUID();
  const minute = slotMinute(startMs);
  const changes = new Changes();
  let gated = false;
  try {
    const ride = await guarded(hub, () =>
      tx(async (c) => {
        await advisory(c, `ride:${hub}:${startMs}`);
        const when = await now(c);
        if (isPastCutOff(startMs, when)) throw fail("ride_cut_off");
        if (!(await ledger.claimSlot(hub, minute, id))) throw fail("slot_taken");
        gated = true;
        try {
          await q("INSERT INTO rides (id, rider_id, hub, model, starts_ms, state, booked_ms, licence_last4) VALUES ($1,$2,$3,$4,$5,'booked',$6,$7)", [id, rider.id, hub, model, startMs, when, licence.slice(-4)], c);
        } catch (error) {
          refusalOf(error);
        }
        await q("UPDATE users SET licence_number=$2, licence_valid_until=$3 WHERE id=$1", [rider.id, licence, b.licenceValidUntil], c);
        const due = rideReminderDue(startMs);
        if (when < due) await addNotice(c, "ride_reminder", rider.id, { rideId: id }, due);
        changes.hub(hub).rider(rider.id);
        await changes.apply(c);
        return serializeRide((await q<RideRow>("SELECT * FROM rides WHERE id=$1", [id], c))[0] as RideRow, when);
      }),
    );
    changes.publish();
    return { status: 201, ride };
  } catch (error) {
    if (gated) await ledger.dropSlot(hub, minute, id).catch(() => undefined);
    if (error instanceof ApiError && error.code === "slot_taken") await restoreSlotKey(hub, startMs);
    throw error;
  }
}

export async function moveRide(rider: UserRow, id: string, body: unknown): Promise<Ride> {
  const first = await ownRide(rider, id);
  const at = await now();
  if (first.state !== "booked") throw fail("illegal_state");
  if (isPastCutOff(first.starts_ms, at)) throw fail("ride_cut_off");
  const b = jsonObject(body);
  const startMs = b && typeof b.startsAt === "string" ? parseInstant(b.startsAt) : null;
  if (startMs === first.starts_ms) throw fail("illegal_state");
  const inPattern = startMs !== null && isBookableStart(first.hub, startMs, at);
  if (inPattern && isPastCutOff(startMs, at)) throw fail("ride_cut_off");
  if (inPattern && (await one(`SELECT 1 FROM rides WHERE hub=$1 AND starts_ms=$2 AND state IN ${TAKEN_SQL}`, [first.hub, startMs]))) {
    await restoreSlotKey(first.hub, startMs);
    throw fail("slot_taken");
  }
  if (startMs === null) throw fail("invalid_body");
  if (!inPattern) throw fail("invalid_slot");
  if ((rider.licence_valid_until ?? "") < istDate(startMs)) throw fail("licence_expired");
  const minute = slotMinute(startMs);
  const oldMinute = slotMinute(first.starts_ms);
  const changes = new Changes();
  let gated = false;
  try {
    const ride = await guarded(first.hub, () =>
      tx(async (c) => {
        await advisory(c, `ride:${first.hub}:${startMs}`);
        const row = (await q<RideRow>("SELECT * FROM rides WHERE id=$1 FOR UPDATE", [id], c))[0] as RideRow;
        const when = await now(c);
        if (row.state !== "booked") throw fail("illegal_state");
        if (isPastCutOff(row.starts_ms, when)) throw fail("ride_cut_off");
        if (isPastCutOff(startMs, when)) throw fail("ride_cut_off");
        if (!(await ledger.claimSlot(row.hub, minute, id))) throw fail("slot_taken");
        gated = true;
        await ledger.dropSlot(row.hub, oldMinute, id);
        try {
          await q("UPDATE rides SET starts_ms=$2, moved_from_ms=$3 WHERE id=$1", [id, startMs, row.starts_ms], c);
        } catch (error) {
          refusalOf(error);
        }
        const due = rideReminderDue(startMs);
        await q("UPDATE notices SET due_ms=$2 WHERE ride_id=$1 AND state='pending'", [id, due], c);
        changes.hub(row.hub).rider(row.rider_id);
        await changes.apply(c);
        return serializeRide((await q<RideRow>("SELECT * FROM rides WHERE id=$1", [id], c))[0] as RideRow, when);
      }),
    );
    changes.publish();
    return ride;
  } catch (error) {
    if (gated) {
      await ledger.dropSlot(first.hub, minute, id).catch(() => undefined);
      await ledger.setSlot(first.hub, oldMinute, id).catch(() => undefined);
    }
    throw error;
  }
}

export async function cancelRide(rider: UserRow, id: string): Promise<Ride> {
  const first = await ownRide(rider, id);
  const changes = new Changes();
  const ride = await guarded(first.hub, () =>
    tx(async (c) => {
      const row = (await q<RideRow>("SELECT * FROM rides WHERE id=$1 FOR UPDATE", [id], c))[0] as RideRow;
      const when = await now(c);
      if (row.state !== "booked") throw fail("illegal_state");
      if (isPastCutOff(row.starts_ms, when)) throw fail("ride_cut_off");
      await ledger.dropSlot(row.hub, slotMinute(row.starts_ms), id);
      await q("UPDATE rides SET state='cancelled' WHERE id=$1", [id], c);
      await cancelRideNotices(c, id);
      changes.hub(row.hub).rider(row.rider_id);
      await changes.apply(c);
      return serializeRide({ ...row, state: "cancelled" }, when);
    }),
  );
  changes.publish();
  return ride;
}

export async function hostMark(host: UserRow, id: string, body: unknown): Promise<Ride> {
  const row = (await q<RideRow>("SELECT * FROM rides WHERE id=$1", [id]))[0];
  if (!row || row.hub !== host.hub) throw fail("not_found");
  const b = jsonObject(body);
  const changes = new Changes();
  const ride = await tx(async (c) => {
    const fresh = (await q<RideRow>("SELECT * FROM rides WHERE id=$1 FOR UPDATE", [id], c))[0] as RideRow;
    const at = await now(c);
    if (fresh.state !== "booked") throw fail("illegal_state");
    if (!mayMark(fresh.starts_ms, at)) throw fail("too_early");
    if (!b || (b.outcome !== "ridden" && b.outcome !== "no_show")) throw fail("invalid_body");
    await q("UPDATE rides SET state=$2 WHERE id=$1", [id, b.outcome], c);
    await cancelRideNotices(c, id);
    changes.hub(fresh.hub).rider(fresh.rider_id);
    await changes.apply(c);
    return serializeRide({ ...fresh, state: b.outcome }, at);
  });
  changes.publish();
  return ride;
}
