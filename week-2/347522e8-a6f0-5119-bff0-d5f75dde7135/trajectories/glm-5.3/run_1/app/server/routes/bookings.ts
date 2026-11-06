import { ApiError } from "../errors.js";
import {
  json,
  parseJsonBody,
  route,
  requireRenter,
  requireStaff,
  requireUser,
  type RouteContext,
} from "../router.js";
import { isExclusionViolation, one, rows, withTx } from "../db.js";
import {
  addDays,
  hhmmToMinutes,
  isoInstant,
  kitchenToday,
  localInstant,
  minutesToHHMM,
  wallClock,
  zoneAbbreviation,
  cancellationCutoff,
  isValidDate,
} from "../kitchenTime.js";
import { balances, recordMovement } from "../ledger.js";
import { bookingEligibility, complianceForRenter } from "../compliance.js";
import { priceBooking } from "../pricing.js";
import { liveOccupancy, legalEndAfter } from "../occupancy.js";
import {
  displayBooking,
  effectiveStatus,
  seriesDates,
  settingsForDate,
  totalSeriesMinutes,
  validateWallTimes,
} from "../bookings.js";
import { queueNotification, emailSubjects } from "../notify.js";
import { config } from "../config.js";
import { createCharge, ensureAccount, ensurePaymentMethod } from "../killbill.js";

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");


route("POST", "/api/bookings", "renter", async (ctx: RouteContext) => {
  const { renterId } = requireRenter(ctx);
  const body = parseJsonBody<{ station_id?: unknown; date?: unknown; start?: unknown; end?: unknown; repeat_weeks?: unknown }>(ctx);
  const errors: Record<string, string> = {};
  const stationId = text(body.station_id);
  const date = text(body.date);
  const start = text(body.start);
  const end = text(body.end);
  const repeatWeeks = body.repeat_weeks === undefined ? 1 : Number(body.repeat_weeks);
  if (!stationId) errors.station_id = "Choose a station.";
  const station = stationId
    ? await one<{ id: string; name: string }>(ctx.db, "select id, name from stations where id = $1", [stationId])
    : null;
  if (stationId && !station) errors.station_id = "That station does not exist.";
  if (!isValidDate(date)) errors.date = "Enter the date as YYYY-MM-DD.";
  const startMinutes = hhmmToMinutes(start);
  if (startMinutes === null) errors.start = "Enter the start time as HH:MM on a 15-minute mark.";
  const endMinutes = end === "24:00" ? 1440 : hhmmToMinutes(end);
  if (endMinutes === null || endMinutes === 0) errors.end = "Enter the end time as HH:MM on a 15-minute mark.";
  if (!Number.isInteger(repeatWeeks) || repeatWeeks < 1 || repeatWeeks > 12) {
    errors.repeat_weeks = "Repeat weekly for is 1 to 12 weeks.";
  }
  if (Object.keys(errors).length > 0) throw ApiError.validationError(errors);

  const finalStart = startMinutes!;
  const finalEnd = endMinutes!;
  if (finalEnd <= finalStart) throw ApiError.validationError({ end: "End must be after start." });
  if (finalEnd - finalStart > 360) throw ApiError.validationError({ end: "A booking is at most six hours." });

  const renter = await one<{ status: string }>(ctx.db, "select status from renters where id = $1", [renterId]);
  if (!renter) throw ApiError.notFound();
  const compliance = await complianceForRenter(ctx.db, renterId, ctx.now);
  const today = kitchenToday(ctx.now);
  const eligibility = bookingEligibility(renter.status, compliance, today);
  if (eligibility === "renter_not_active") throw ApiError.renterNotActive();
  if (eligibility === "compliance_lapsed") throw ApiError.complianceLapsed();

  if (date < today) throw ApiError.validationError({ date: "Choose a day at or after today." });
  const maxDate = addDays(today, 366);
  if (date > maxDate) throw ApiError.validationError({ date: "Choose a day within the next 366 days." });
  const wallCheck = validateWallTimes(date, finalStart, finalEnd);
  if (wallCheck) {
    throw ApiError.validationError({ [finalStart !== null && start.length > 0 ? "start" : "start"]: wallCheck });
  }
  const startInstant = localInstant(date, finalStart);
  const endInstant = finalEnd === 1440 ? localInstant(addDays(date, 1), 0) : localInstant(date, finalEnd);
  if (!startInstant || !endInstant) {
    throw ApiError.validationError({ start: `That time does not exist on ${date} in the kitchen's time zone.` });
  }
  if (startInstant.getTime() <= ctx.now.getTime()) {
    throw ApiError.validationError({ start: "Choose a start after the current time." });
  }

  const settings = await settingsForDate(ctx.db, stationId!, date);
  if (!settings) throw ApiError.notFound();
  const dates = seriesDates(date, repeatWeeks);
  const seriesTotal = totalSeriesMinutes(dates, finalStart, finalEnd, settings);
  const currentBalance = await balances(ctx.db, renterId);
  if (seriesTotal > currentBalance.balanceMinutes) {
    throw ApiError.insufficientHours(currentBalance.balanceMinutes, seriesTotal);
  }

  // Insert the whole series inside one transaction. The occupancy exclusion
  // constraint decides the single winner when claims overlap (DP-19).
  const seriesId = crypto.randomUUID();
  let occupancyConflict: { date: string; legal_end: string | null; blocked_by: string; blocked_at: string } | null = null;

  try {
    await withTx(async (tx) => {
      const holdExpiresAt = new Date(ctx.now.getTime() + config.holdTtlSeconds * 1000);
      for (const weekDate of dates) {
        const weekStart = localInstant(weekDate, finalStart);
        const weekEnd = finalEnd === 1440 ? localInstant(addDays(weekDate, 1), 0) : localInstant(weekDate, finalEnd);
        if (!weekStart || !weekEnd) {
          throw ApiError.validationError({ start: `That time does not exist on ${weekDate} in the kitchen's time zone.` });
        }
        const weekSettings = await settingsForDate(tx, stationId!, weekDate);
        const weekPrice = priceBooking(weekStart, weekEnd, weekSettings ?? settings);

        const bufferEnd = new Date(weekEnd.getTime() + (weekSettings?.bufferMinutes ?? settings.bufferMinutes) * 60000);
        const inserted = await rows<{ id: string }>(
          tx,
          `insert into bookings (series_id, station_id, renter_id, status, date, start_min, end_min,
            starts_at, ends_at, buffer_minutes, buffer_ends_at, hour_weight, off_peak_percent,
            overage_usd_per_hour, minutes_debited, hold_expires_at, cancellation_cutoff_at)
           values ($1, $2, $3, 'hold', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           returning id`,
          [
            seriesId,
            stationId,
            renterId,
            weekDate,
            finalStart,
            finalEnd,
            weekStart.toISOString(),
            weekEnd.toISOString(),
            weekSettings?.bufferMinutes ?? settings.bufferMinutes,
            bufferEnd.toISOString(),
            weekSettings?.hourWeight ?? settings.hourWeight,
            weekSettings?.offPeakPercent ?? settings.offPeakPercent,
            String(weekSettings?.overageUsdPerHour ?? settings.overageUsdPerHour),
            weekPrice,
            holdExpiresAt.toISOString(),
            cancellationCutoff(weekDate, finalStart)?.toISOString() ?? weekStart.toISOString(),
          ],
        );
        const bookingId = inserted[0]!.id;
        await tx.query(
          `insert into station_occupancy (station_id, starts_at, ends_at, booking_id) values ($1, $2, $3, $4)`,
          [stationId, weekStart.toISOString(), bufferEnd.toISOString(), bookingId],
        );
        await recordMovement(tx, renterId, "booking_hold", weekPrice, { bookingId });
      }
    });
  } catch (err) {
    if (isExclusionViolation(err)) {
      // Compute the conflict answer against the current live state.
      const live = await liveOccupancy(ctx.db, stationId!);
      const requested = { startsAt: startInstant!, endsAt: endInstant! };
      const bufferOf = (range: (typeof live)[number]): Date =>
        range.blockId ? range.endsAt : new Date(range.endsAt.getTime() + settings.bufferMinutes * 60000);
      let collision: (typeof live)[number] | null = null;
      for (const range of live) {
        const rangeEnd = bufferOf(range);
        if (requested.startsAt < rangeEnd && range.startsAt < requested.endsAt) {
          collision = range;
          break;
        }
      }
      if (!collision) throw ApiError.slotConflict(date, null, "booking", "00:00");
      const wall = wallClock(collision.startsAt);
      const blockedBy = collision.blockId ? "maintenance" : requested.startsAt < collision.endsAt ? "booking" : "buffer";
      const legal = legalEndAfter(startInstant!, endInstant!, live, bufferOf);
      throw ApiError.slotConflict(
        date,
        legal ? minutesToHHMM(wallClock(legal).minutes) : null,
        blockedBy,
        minutesToHHMM(wall.minutes),
      );
    }
    throw err;
  }


  const created = await rows<Record<string, unknown>>(
    ctx.db,
    `select b.*, s.name as station_name from bookings b join stations s on s.id = b.station_id
     where b.series_id = $1 order by b.date asc`,
    [seriesId],
  );
  return json(
    { server_now: isoInstant(ctx.now), bookings: created.map((row) => displayBooking(row, ctx.now)) },
    201,
  );
});

route("GET", "/api/bookings", "any", async (ctx: RouteContext) => {
  const user = requireUser(ctx);
  const date = ctx.url.searchParams.get("date");
  const status = ctx.url.searchParams.get("status");
  if (date && !isValidDate(date)) throw ApiError.validationError({ date: "Enter the date as YYYY-MM-DD." });
  const params: unknown[] = [];
  let where = "1 = 1";
  if (user.role === "renter") {
    params.push(user.renter_id);
    where += ` and b.renter_id = $${params.length}`;
  }
  if (date) {
    params.push(date);
    where += ` and b.date = $${params.length}`;
  }
  const found = await rows<Record<string, unknown>>(
    ctx.db,
    `select b.*, s.name as station_name from bookings b join stations s on s.id = b.station_id
     where ${where} order by b.date asc, b.start_min asc`,
    params,
  );
  const filtered = found.filter((row) => {
    const live = effectiveStatus(row, ctx.now);
    if (status && live !== status) return false;
    return true;
  });
  return json({ server_now: isoInstant(ctx.now), bookings: filtered.map((row) => displayBooking(row, ctx.now)) });
});

route("GET", "/api/bookings/{booking_id}", "any", async (ctx: RouteContext) => {
  const bookingId = ctx.url.pathname.split("/")[3]!;
  const user = requireUser(ctx);
  const found = await one<Record<string, unknown>>(
    ctx.db,
    `select b.*, s.name as station_name from bookings b join stations s on s.id = b.station_id where b.id = $1`,
    [bookingId],
  );
  if (!found) throw ApiError.notFound();
  if (user.role === "renter") {
    if (found.renter_id !== user.renter_id) throw ApiError.notFound();
  } else if (user.role !== "operator" && user.role !== "shift_lead") {
    throw ApiError.forbidden();
  }
  return json({ server_now: isoInstant(ctx.now), booking: displayBooking(found, ctx.now) });
});


route("POST", "/api/bookings/{booking_id}/confirm", "renter", async (ctx: RouteContext) => {
  const { renterId } = requireRenter(ctx);
  const bookingId = ctx.url.pathname.split("/")[3]!;
  const series = await confirmOrRelease(ctx, bookingId, renterId, "confirmed", "hold");
  return json({ server_now: isoInstant(ctx.now), bookings: series });
});

route("POST", "/api/bookings/{booking_id}/release", "renter", async (ctx: RouteContext) => {
  const { renterId } = requireRenter(ctx);
  const bookingId = ctx.url.pathname.split("/")[3]!;
  const series = await confirmOrRelease(ctx, bookingId, renterId, "expired", "hold", "hold_release");
  return json({ server_now: isoInstant(ctx.now), bookings: series });
});

const confirmOrRelease = async (
  ctx: RouteContext,
  bookingId: string,
  renterId: string,
  toStatus: "confirmed" | "expired",
  fromStatus: string,
  movementKind?: string,
): Promise<ReturnType<typeof displayBooking>[]> => {
  const found = await one<Record<string, unknown>>(
    ctx.db,
    `select b.*, s.name as station_name from bookings b join stations s on s.id = b.station_id where b.id = $1`,
    [bookingId],
  );
  if (!found) throw ApiError.notFound();
  if (found.renter_id !== renterId) throw ApiError.notFound();
  const live = effectiveStatus(found, ctx.now);
  if (live !== "hold") {
    if (found.status === "hold") throw ApiError.holdExpired();
    throw ApiError.invalidTransition(live, toStatus);
  }
  const seriesId = found.series_id as string;
  const renterEmail = (await one<{ email: string }>(ctx.db, "select email from renters where id = $1", [renterId]))!.email;
  if (toStatus === "confirmed") {
    await ctx.db.query("update bookings set status = 'confirmed' where series_id = $1 and status = 'hold'", [seriesId]);
    const all = await rows<Record<string, unknown>>(
      ctx.db,
      `select b.*, s.name as station_name from bookings b join stations s on s.id = b.station_id where b.series_id = $1 order by b.date asc`,
      [seriesId],
    );
    const stationName = found.station_name as string;
    const lines = all
      .map((row) => {
        const startInstant = new Date(row.starts_at as string);
        const startWall = wallClock(startInstant);
        const zone = zoneAbbreviation(startInstant);
        const startHm = minutesToHHMM(startWall.minutes);
        const endMin = row.end_min as number;
        const endHm = endMin === 1440 ? "24:00" : minutesToHHMM(endMin);
        return `${row.date} ${startHm}–${endHm} ${zone}`;
      })
      .join("\n");
    const bufferMinutes = found.buffer_minutes as number;
    const bufferEndWall = wallClock(new Date(found.buffer_ends_at as string));
    await queueNotification(
      ctx.db,
      "booking_confirmed",
      renterEmail,
      emailSubjects.bookingConfirmed(stationName, found.date as string),
      `${lines}\nSanitation buffer: ${bufferMinutes} minutes, until ${minutesToHHMM(bufferEndWall.minutes)}.`,
    );
    return all.map((row) => displayBooking(row, ctx.now));
  }
  await withTx(async (tx) => {
    const seriesRows = await rows<{ id: string; minutes_debited: number }>(
      tx,
      "select id, minutes_debited from bookings where series_id = $1 and status = 'hold'",
      [seriesId],
    );
    await tx.query("update bookings set status = 'expired' where series_id = $1 and status = 'hold'", [seriesId]);
    await tx.query("delete from station_occupancy where booking_id in (select id from bookings where series_id = $1)", [
      seriesId,
    ]);
    for (const row of seriesRows) {
      await recordMovement(tx, renterId, "hold_release", row.minutes_debited, { bookingId: row.id });
    }
  });
  const all = await rows<Record<string, unknown>>(
    ctx.db,
    `select b.*, s.name as station_name from bookings b join stations s on s.id = b.station_id where b.series_id = $1 order by b.date asc`,
    [seriesId],
  );
  void movementKind;
  void fromStatus;
  return all.map((row) => displayBooking(row, ctx.now));
};

route("POST", "/api/bookings/{booking_id}/cancel", "renter", async (ctx: RouteContext) => {
  const { renterId } = requireRenter(ctx);
  const bookingId = ctx.url.pathname.split("/")[3]!;
  const found = await one<Record<string, unknown>>(
    ctx.db,
    `select b.*, s.name as station_name from bookings b join stations s on s.id = b.station_id where b.id = $1`,
    [bookingId],
  );
  if (!found) throw ApiError.notFound();
  if (found.renter_id !== renterId) throw ApiError.notFound();
  const live = effectiveStatus(found, ctx.now);
  if (live !== "confirmed") throw ApiError.invalidTransition(live, "cancelled");
  const cutoff = new Date(found.cancellation_cutoff_at as string);
  const credited = ctx.now.getTime() < cutoff.getTime();
  const minutesDebited = found.minutes_debited as number;
  await withTx(async (tx) => {
    await tx.query("update bookings set status = 'cancelled' where id = $1", [bookingId]);
    await tx.query("delete from station_occupancy where booking_id = $1", [bookingId]);
    if (credited) {
      await recordMovement(tx, renterId, "cancellation_credit", minutesDebited, { bookingId });
    } else {
      await recordMovement(tx, renterId, "cancellation_forfeit", minutesDebited, { bookingId });
    }
  });
  const after = await one<Record<string, unknown>>(
    ctx.db,
    `select b.*, s.name as station_name from bookings b join stations s on s.id = b.station_id where b.id = $1`,
    [bookingId],
  );
  return json({
    booking: displayBooking(after!, ctx.now),
    outcome: credited ? "credited" : "forfeited",
    minutes: minutesDebited,
  });
});

route("POST", "/api/bookings/{booking_id}/check-in", "staff", async (ctx: RouteContext) => {
  requireStaff(ctx);
  const bookingId = ctx.url.pathname.split("/")[3]!;
  const body = parseJsonBody<{ actual_start?: unknown }>(ctx);
  const actual = text(body.actual_start);
  const actualMinutes = hhmmToMinutes(actual);
  if (actualMinutes === null) {
    throw ApiError.validationError({ actual_start: "Enter the actual start as HH:MM on a 15-minute mark." });
  }
  const found = await one<Record<string, unknown>>(
    ctx.db,
    `select b.*, s.name as station_name from bookings b join stations s on s.id = b.station_id where b.id = $1`,
    [bookingId],
  );
  if (!found) throw ApiError.notFound();
  const live = effectiveStatus(found, ctx.now);
  if (live !== "confirmed") throw ApiError.invalidTransition(live, "checked_in");
  await ctx.db.query("update bookings set status = 'checked_in', actual_start = $1 where id = $2", [
    actual,
    bookingId,
  ]);
  const after = await one<Record<string, unknown>>(
    ctx.db,
    `select b.*, s.name as station_name from bookings b join stations s on s.id = b.station_id where b.id = $1`,
    [bookingId],
  );
  return json({ booking: displayBooking(after!, ctx.now) });
});

route("POST", "/api/bookings/{booking_id}/check-out", "staff", async (ctx: RouteContext) => {
  requireStaff(ctx);
  const bookingId = ctx.url.pathname.split("/")[3]!;
  const body = parseJsonBody<{ actual_end?: unknown }>(ctx);
  const actual = text(body.actual_end);
  const actualMinutes = hhmmToMinutes(actual);
  if (actualMinutes === null) {
    throw ApiError.validationError({ actual_end: "Enter the actual end as HH:MM on a 15-minute mark." });
  }
  const found = await one<Record<string, unknown>>(
    ctx.db,
    `select b.*, s.name as station_name from bookings b join stations s on s.id = b.station_id where b.id = $1`,
    [bookingId],
  );
  if (!found) throw ApiError.notFound();
  const live = effectiveStatus(found, ctx.now);
  if (live !== "checked_in") throw ApiError.invalidTransition(live, "completed");
  const actualStart = hhmmToMinutes(found.actual_start as string)!;
  if (actualMinutes <= actualStart) {
    throw ApiError.validationError({ actual_end: "The actual end must be after the actual start." });
  }
  // Overage (DP-26): whole 15-minute units past the booked end, at the
  // booking's own rate. The billing charge must be accepted before the
  // check-out is recorded.
  const bookedEnd = found.end_min as number;
  const elapsedPast = actualMinutes - bookedEnd;
  const overageUnits = elapsedPast > 0 ? Math.ceil(elapsedPast / 15) : 0;
  const rate = Number(found.overage_usd_per_hour as string);
  const overageUsd = overageUnits > 0 ? (overageUnits * rate) / 4 : 0;
  const roundedUsd = Math.round(overageUsd * 100) / 100;
  if (overageUnits > 0) {
    const account = await ensureKillbillAccountFor(ctx, found.renter_id as string);
    if (!account) throw ApiError.billingUnavailable();
    const charge = await createCharge(
      account,
      roundedUsd,
      `Overage: ${found.station_name} ${found.date}, ${overageUnits} × 15 min`,
      `overage-${bookingId}-${actualMinutes}`,
    );
    if (charge.kind === "unavailable") throw ApiError.billingUnavailable();
  }
  await withTx(async (tx) => {
    await tx.query(
      "update bookings set status = 'completed', actual_end = $1, overage_units = $2, overage_usd = $3 where id = $4",
      [actual, overageUnits, roundedUsd.toFixed(2), bookingId],
    );
    await recordMovement(tx, found.renter_id as string, "checkout", found.minutes_debited as number, { bookingId });
  });
  const after = await one<Record<string, unknown>>(
    ctx.db,
    `select b.*, s.name as station_name from bookings b join stations s on s.id = b.station_id where b.id = $1`,
    [bookingId],
  );
  return json({ booking: displayBooking(after!, ctx.now) });
});

export const ensureKillbillAccountFor = async (ctx: RouteContext, renterId: string): Promise<string | null> => {
  const renterRow = await one<{ business_name: string; email: string }>(
    ctx.db,
    "select business_name, email from renters where id = $1",
    [renterId],
  );
  if (!renterRow) return null;
  const externalKey = `renter-${renterId}`;
  const account = await ensureAccount(externalKey, renterRow.business_name, renterRow.email);
  if (account.kind === "unavailable") return null;
  const method = await ensurePaymentMethod(account.value);
  if (method.kind === "unavailable") return null;
  return account.value.accountId;
};
