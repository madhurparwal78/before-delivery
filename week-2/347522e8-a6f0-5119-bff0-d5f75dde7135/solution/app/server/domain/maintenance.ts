// Maintenance blocks: a block displaces every overlapping hold and confirmed booking, with a full
// hour credit and one displacement email each, unless someone is checked in.

import { randomUUID } from "node:crypto";
import type { MaintenanceBlockView } from "../../shared/api.js";
import { formatHours } from "../../shared/hours.js";
import { MINUTES_PER_DAY, clockTimeOf, formatHHMM, isIsoDate, parseHHMM, wallClockInstant } from "../../shared/kitchenTime.js";
import { canTransition } from "../../shared/bookingStatus.js";
import { firstCollision } from "../../shared/occupancy.js";
import { iso, now } from "../clock.js";
import { pool, transaction } from "../db.js";
import type { JsonObject } from "../http/body.js";
import { FieldErrors, fail } from "../http/errors.js";
import { bookingsOverlapping, effectiveStatus, expireDueHolds, freeOccupancy, occupiedRanges, timesLine } from "./bookings.js";
import { lockRenterHours, recordMovement } from "./ledger.js";
import { queueNotice } from "./outbox.js";
import { renterRow } from "./renters.js";

export async function blockStation(stationId: string, body: JsonObject): Promise<{ block: MaintenanceBlockView; displaced_booking_ids: string[] }> {
  const errors = new FieldErrors();
  const date = typeof body.date === "string" ? body.date : "";
  if (!isIsoDate(date)) errors.add("date", "Use a date like 2026-11-07.");
  const start = typeof body.start === "string" ? parseHHMM(body.start) : null;
  const end = typeof body.end === "string" ? parseHHMM(body.end) : null;
  if (start === null || start >= MINUTES_PER_DAY) errors.add("start", "Use a time on a 15-minute mark, like 10:00.");
  if (end === null) errors.add("end", "Use a time on a 15-minute mark, like 11:00.");
  else if (start !== null && end <= start) errors.add("end", "Until must be after From.");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 1 || reason.length > 200) errors.add("reason", "Give a reason of up to 200 characters.");
  const from = start === null || !isIsoDate(date) ? null : wallClockInstant(date, start);
  const to = end === null || !isIsoDate(date) ? null : wallClockInstant(date, end);
  if (start !== null && from === null) errors.add("start", `That time does not exist on ${date} in the kitchen's time zone.`);
  if (end !== null && to === null) errors.add("end", `That time does not exist on ${date} in the kitchen's time zone.`);
  if (from === null || to === null || start === null || end === null || !errors.empty) throw errors.error();

  await expireDueHolds(stationId);
  return transaction(async (tx) => {
    const at = now();
    const overlapping = await bookingsOverlapping(tx, stationId, from, to);
    if (overlapping.some((row) => row.status === "checked_in")) throw fail(409, "station_in_use");
    const ranges = (await occupiedRanges(tx, stationId, from, to)).filter((range) => range.kind === "maintenance");
    const conflict = (blockedBy: "maintenance" | "booking", startsAt: number) =>
      fail(409, "slot_conflict", { date, legal_end: null, blocked_by: blockedBy, blocked_at: clockTimeOf(startsAt) });
    const otherBlock = firstCollision(ranges, from, to);
    if (otherBlock) throw conflict("maintenance", otherBlock.range.start);
    const completed = overlapping.find((row) => row.status === "completed");
    if (completed) throw conflict("booking", completed.starts_at.getTime());
    const displaced = overlapping.filter((row) => canTransition(effectiveStatus(row, at), "displaced"));
    for (const row of displaced) {
      await lockRenterHours(tx, row.renter_id);
      await tx.query("UPDATE bookings SET status = 'displaced' WHERE id = $1", [row.id]);
      await freeOccupancy(tx, row.id);
      await recordMovement(tx, row.renter_id, "displacement_credit", row.minutes_debited, { bookingId: row.id });
      const renter = await renterRow(tx, row.renter_id);
      await queueNotice(tx, {
        kind: "booking_displaced",
        to: renter.email,
        subject: `Booking displaced: ${row.station_name} on ${row.date}`,
        body: [
          `Your booking on ${row.station_name} was displaced because the station is blocked for maintenance.`,
          "",
          timesLine(row),
          `Reason: ${reason}`,
          "",
          `${formatHours(row.minutes_debited)} hours returned to your balance.`,
        ].join("\n"),
      });
    }
    const id = randomUUID();
    await tx.query(
      `INSERT INTO maintenance_blocks (id, station_id, date, start_minute, end_minute, starts_at, ends_at, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, stationId, date, start, end, iso(from), iso(to), reason, iso(at)],
    );
    await tx.query("INSERT INTO station_occupancy (station_id, occupied, maintenance_block_id) VALUES ($1, tstzrange($2, $3), $4)", [
      stationId,
      iso(from),
      iso(to),
      id,
    ]);
    return {
      block: { id, station_id: stationId, date, start: formatHHMM(start), end: formatHHMM(end), reason },
      displaced_booking_ids: displaced.map((row) => row.id),
    };
  });
}

/** Frees the block's time (its occupancy row cascades); displaced bookings stay displaced. */
export async function deleteBlock(blockId: string): Promise<void> {
  await pool.query("DELETE FROM maintenance_blocks WHERE id = $1", [blockId]);
}
