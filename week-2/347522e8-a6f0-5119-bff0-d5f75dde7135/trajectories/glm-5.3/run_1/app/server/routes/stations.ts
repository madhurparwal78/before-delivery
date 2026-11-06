import { ApiError } from "../errors.js";
import { json, parseJsonBody, route, requireOperator, requireStaff, requireUser, type RouteContext } from "../router.js";
import { isExclusionViolation, one, rows, withTx } from "../db.js";
import {
  addDays,
  hhmmToMinutes,
  isoInstant,
  kitchenToday,
  isValidDate,
  minutesToHHMM,
  localInstant,
} from "../kitchenTime.js";
import { settingsForDate } from "../bookings.js";
import { recordMovement } from "../ledger.js";
import { queueDisplacementEmail } from "../bookings.js";

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");


route("GET", "/api/stations", "any", async (ctx: RouteContext) => {

  requireUser(ctx);
  const dateParam = ctx.url.searchParams.get("date");
  let date = dateParam ?? kitchenToday(ctx.now);
  if (dateParam && !isValidDate(dateParam)) throw ApiError.validationError({ date: "Enter the date as YYYY-MM-DD." });
  const stations = await rows<{ id: string; name: string; position: number }>(
    ctx.db,
    "select id, name, position from stations order by position asc",
  );
  const result = [];
  for (const station of stations) {
    const settings = await settingsForDate(ctx.db, station.id, date);
    const upcoming = await rows<Record<string, unknown>>(
      ctx.db,
      `select station_id, effective_from::text as effective_from, hour_weight, off_peak_percent,
              overage_usd_per_hour::text as overage_usd_per_hour, buffer_minutes
       from station_settings where station_id = $1 and effective_from > $2 order by effective_from asc`,
      [station.id, date],
    );
    const blocks = await rows<Record<string, unknown>>(
      ctx.db,
      `select 'booking' as kind, b.id as booking_id, b.station_id, b.start_min as start, b.end_min as end,
              b.starts_at, b.ends_at, b.buffer_ends_at, b.status, b.renter_id, r.business_name, b.buffer_minutes
       from bookings b join renters r on r.id = b.renter_id
       where b.station_id = $1 and b.date = $2 and b.status in ('hold','confirmed','checked_in','completed')
       union all
       select 'maintenance' as kind, null as booking_id, m.station_id, m.start_min as start, m.end_min as end,
              m.starts_at, m.ends_at, m.ends_at as buffer_ends_at, 'maintenance' as status, null as renter_id,
              null as business_name, 0 as buffer_minutes
       from maintenance_blocks m where m.station_id = $1 and m.date = $2
       order by start asc`,
      [station.id, date],
    );
    const user = ctx.user!;
    const blockList = blocks.map((block) => {
      const isMaintenance = block.kind === "maintenance";
      const mine = !isMaintenance && user.role === "renter" && block.renter_id === user.renter_id;
      const revealed = user.role === "operator" || user.role === "shift_lead";
      return {
        kind: isMaintenance ? "maintenance" : block.status === "hold" ? "hold" : "booking",
        start: minutesToHHMM(block.start as number),
        end: minutesToHHMM(block.end as number),
        starts_at: isoInstant(new Date(block.starts_at as string)),
        ends_at: isoInstant(new Date(block.ends_at as string)),
        buffer_ends_at: isoInstant(new Date(block.buffer_ends_at as string)),
        mine,
        booking_id: mine || revealed ? block.booking_id : null,
        renter_business_name: revealed ? block.business_name : null,
      };
    });
    result.push({
      id: station.id,
      name: station.name,
      hour_weight: settings?.hourWeight ?? 1,
      off_peak_percent: settings?.offPeakPercent ?? 100,
      overage_usd_per_hour: String(settings?.overageUsdPerHour ?? "0.00"),
      buffer_minutes: settings?.bufferMinutes ?? 0,
      upcoming_settings: upcoming.map((row) => ({
        station_id: row.station_id,
        effective_from: row.effective_from,
        hour_weight: row.hour_weight,
        off_peak_percent: row.off_peak_percent,
        overage_usd_per_hour: row.overage_usd_per_hour,
        buffer_minutes: row.buffer_minutes,
      })),
      blocks: blockList,
    });
  }
  return json({
    date,
    time_zone: "America/Chicago",
    server_now: isoInstant(ctx.now),
    stations: result,
  });
});

route("POST", "/api/stations/{station_id}/settings", "operator", async (ctx: RouteContext) => {
  requireOperator(ctx);
  const stationId = ctx.url.pathname.split("/")[3]!;
  const station = await one<{ id: string }>(ctx.db, "select id from stations where id = $1", [stationId]);
  if (!station) throw ApiError.notFound();
  const body = parseJsonBody<Record<string, unknown>>(ctx);
  const errors: Record<string, string> = {};
  const effectiveFrom = text(body.effective_from);
  const hourWeight = Number(body.hour_weight);
  const offPeakPercent = Number(body.off_peak_percent);
  const overage = text(body.overage_usd_per_hour);
  const bufferMinutes = Number(body.buffer_minutes);
  const today = kitchenToday(ctx.now);
  if (!isValidDate(effectiveFrom)) errors.effective_from = "Enter the effective date as YYYY-MM-DD.";
  else if (effectiveFrom < today) errors.effective_from = "The effective date is today or later.";
  if (![1, 2, 3].includes(hourWeight)) errors.hour_weight = "Hour weight is 1, 2 or 3.";
  if (![50, 60, 70, 80, 90, 100].includes(offPeakPercent)) {
    errors.off_peak_percent = "Off-peak percent is 50, 60, 70, 80, 90 or 100.";
  }
  if (!/^\d+\.\d{2}$/.test(overage) || Number(overage) < 0 || Number(overage) > 500) {
    errors.overage_usd_per_hour = "Enter the overage rate from 0.00 to 500.00.";
  }
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 120 || bufferMinutes % 15 !== 0) {
    errors.buffer_minutes = "Buffer minutes are 0 to 120 in multiples of 15.";
  }
  if (Object.keys(errors).length > 0) throw ApiError.validationError(errors);
  await ctx.db.query(
    `insert into station_settings (station_id, effective_from, hour_weight, off_peak_percent, overage_usd_per_hour, buffer_minutes)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (station_id, effective_from)
     do update set hour_weight = excluded.hour_weight, off_peak_percent = excluded.off_peak_percent,
       overage_usd_per_hour = excluded.overage_usd_per_hour, buffer_minutes = excluded.buffer_minutes`,
    [stationId, effectiveFrom, hourWeight, offPeakPercent, overage, bufferMinutes],
  );
  const settings = await one<Record<string, unknown>>(
    ctx.db,
    `select station_id, effective_from::text as effective_from, hour_weight, off_peak_percent,
            overage_usd_per_hour::text as overage_usd_per_hour, buffer_minutes
     from station_settings where station_id = $1 and effective_from = $2`,
    [stationId, effectiveFrom],
  );
  return json({ settings }, 201);
});

route("POST", "/api/stations/{station_id}/maintenance", "staff", async (ctx: RouteContext) => {
  requireStaff(ctx);
  const stationId = ctx.url.pathname.split("/")[3]!;
  const station = await one<{ id: string; name: string }>(ctx.db, "select id, name from stations where id = $1", [
    stationId,
  ]);
  if (!station) throw ApiError.notFound();
  const body = parseJsonBody<Record<string, unknown>>(ctx);
  const errors: Record<string, string> = {};
  const date = text(body.date);
  const start = text(body.start);
  const end = text(body.end);
  const reason = text(body.reason);
  const startMinutes = hhmmToMinutes(start);
  const endMinutes = end === "24:00" ? 1440 : hhmmToMinutes(end);
  if (!isValidDate(date)) errors.date = "Enter the date as YYYY-MM-DD.";
  if (startMinutes === null) errors.start = "Enter the from time as HH:MM.";
  if (endMinutes === null) errors.end = "Enter the until time as HH:MM.";
  if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
    errors.end = "The until time must be after the from time.";
  }
  if (reason.length < 1 || reason.length > 200) errors.reason = "Enter the reason, 1 to 200 characters.";
  if (Object.keys(errors).length > 0) throw ApiError.validationError(errors);

  const startsAt = localInstant(date, startMinutes!);
  const endsAt = endMinutes === 1440 ? localInstant(addDays(date, 1), 0) : localInstant(date, endMinutes!);
  if (!startsAt || !endsAt) throw ApiError.validationError({ start: "That time does not exist." });

  const overlapping = await rows<Record<string, unknown>>(
    ctx.db,
    `select b.id, b.renter_id, b.status, b.station_id, b.starts_at, b.ends_at, b.buffer_ends_at,
            b.minutes_debited, r.email, r.business_name, s.name as station_name, b.date
     from bookings b join renters r on r.id = b.renter_id join stations s on s.id = b.station_id
     where b.station_id = $1 and b.status in ('hold','confirmed','checked_in')
       and b.buffer_ends_at > $2 and b.starts_at < $3`,
    [stationId, startsAt.toISOString(), endsAt.toISOString()],
  );
  const inUse = overlapping.some((row) => row.status === "checked_in");
  if (inUse) throw ApiError.stationInUse();

  const displaced: string[] = [];
  let blockId = "";
  try {
    await withTx(async (tx) => {
      const inserted = await rows<{ id: string }>(
        tx,
        `insert into maintenance_blocks (station_id, date, start_min, end_min, reason, starts_at, ends_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [stationId, date, startMinutes, endMinutes, reason, startsAt.toISOString(), endsAt.toISOString()],
      );
      blockId = inserted[0]!.id;
      await tx.query(
        "insert into station_occupancy (station_id, starts_at, ends_at, block_id) values ($1, $2, $3, $4)",
        [stationId, startsAt.toISOString(), endsAt.toISOString(), blockId],
      );
      for (const row of overlapping) {
        if (row.status === "checked_in") continue;
        const bookingId = row.id as string;
        await tx.query("update bookings set status = 'displaced' where id = $1", [bookingId]);
        await tx.query("delete from station_occupancy where booking_id = $1", [bookingId]);
        await recordMovement(tx, row.renter_id as string, "displacement_credit", row.minutes_debited as number, {
          bookingId,
        });
        await queueDisplacementEmail(
          tx,
          row.email as string,
          row.station_name as string,
          row.date as string,
          reason,
          (row.minutes_debited as number) / 60,
        );
        displaced.push(bookingId);
      }
    });
  } catch (err) {
    if (isExclusionViolation(err)) throw ApiError.slotConflict(date, null, "maintenance", start);
    throw err;
  }
  return json(
    {
      block: {
        id: blockId,
        station_id: stationId,
        date,
        start,
        end,
        reason,
      },
      displaced_booking_ids: displaced,
    },
    201,
  );
});

