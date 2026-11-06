// Holds: place, read, release and confirm — brief: Holds, Hold placement, Hold life, Confirmation.
import { randomUUID } from "node:crypto";
import type { Hold } from "../../shared/api";
import {
  BOOK_AHEAD_DAYS,
  DAY_MINUTES,
  MAX_HOLD_MINUTES,
  MAX_WEEKS,
  MIN_HOLD_MINUTES,
  NOTES_MAX,
  STEP_MINUTES,
  type DocumentKind,
  type PayWith,
} from "../../shared/kitchen";
import { addDays, hhmm, isKitchenDate, kitchenInstant, kitchenIso, kitchenParts, parseHhmm } from "../../shared/time";
import { config } from "../config";
import { audit, lockFor, one, pool, rows, transaction, type Db, type Queryable } from "../db";
import { bookingConfirmation } from "../emails";
import { ApiError, FieldErrors, invalidTransition, notFound, tenantNotActive, validation } from "../errors";
import { route, type Ctx } from "../http";
import { accountFor } from "../killbill";
import { recordMovement } from "../ledger";
import { sendEmail } from "../mail";
import { occupying } from "../occupancy";
import { BOOKING_SELECT, bookingView, hourBalance, ownedBy, tenantRows, tenantStanding, type BookingRow, type TenantRow } from "../records";
import { bookingTransition, holdIsLive, kindsExpiringBefore, slotTaken, stationTimeCents, type RequiredDocuments } from "../rules";
import type { SessionUser } from "../sessions";
import { unitOfWork } from "../unitOfWork";
import { currentPolicy } from "./policy";

interface HoldRow {
  ref: string;
  tenant_id: string;
  station_id: string;
  weeks: number;
  created_at: Date;
  expires_at: Date;
  confirmed_at: Date | null;
}

/** 409 when any occurrence ends after a required kind's validity edge. */
function assertDocumentsCover(dates: string[], required: RequiredDocuments): void {
  const kinds = new Set<DocumentKind>();
  const blocked: string[] = [];
  for (const date of dates) {
    const expiring = kindsExpiringBefore(date, required);
    if (expiring.length > 0) blocked.push(date);
    expiring.forEach((kind) => kinds.add(kind));
  }
  if (blocked.length > 0) {
    throw new ApiError(409, "document_expires_before_booking", "A required document expires before this booking. Upload a renewal first.", {
      kinds: [...kinds],
      dates: blocked,
    });
  }
}

async function holdBookings(db: Queryable, ref: string): Promise<BookingRow[]> {
  return rows<BookingRow>(db, `${BOOKING_SELECT} WHERE b.hold_ref = $1 ORDER BY b.date`, [ref]);
}

async function holdView(db: Queryable, hold: HoldRow, user: SessionUser): Promise<Hold> {
  return {
    ref: hold.ref,
    tenant_id: hold.tenant_id,
    station_id: hold.station_id,
    weeks: hold.weeks,
    expires_at: kitchenIso(hold.expires_at.getTime()),
    bookings: (await holdBookings(db, hold.ref)).map((b) => bookingView(b, user)),
  };
}

async function loadHold(ctx: Ctx<undefined>): Promise<HoldRow> {
  const hold = await one<HoldRow>(pool, "SELECT * FROM holds WHERE ref = $1", [ctx.params.ref]);
  if (!hold || !ownedBy(ctx.user, hold.tenant_id)) throw notFound();
  return hold;
}

async function loadLiveHold(ctx: Ctx<undefined>): Promise<HoldRow> {
  const hold = await loadHold(ctx);
  if (!holdIsLive(hold, ctx.nowMs)) throw notFound();
  return hold;
}

interface Placement {
  stationId: string;
  dates: string[];
  start: number;
  end: number;
  weeks: number;
  notes: string;
  tenant: TenantRow;
}

async function readPlacement(ctx: Ctx<undefined>): Promise<Placement> {
  const body = ctx.json;
  const errors = new FieldErrors();
  const now = kitchenParts(ctx.nowMs);

  const station = typeof body.station_id === "string" ? await one<{ id: string }>(pool, "SELECT id FROM stations WHERE id = $1", [body.station_id]) : undefined;
  if (!station) errors.add("station_id", "Choose a station.");

  const date = body.date;
  if (!isKitchenDate(date)) errors.add("date", "Give the date as YYYY-MM-DD.");
  else if (date < now.date) errors.add("date", "Choose today or a later date.");
  else if (date > addDays(now.date, BOOK_AHEAD_DAYS)) errors.add("date", `Book no more than ${BOOK_AHEAD_DAYS} days ahead.`);

  const start = parseHhmm(body.start_local);
  const end = parseHhmm(body.end_local);
  if (start === null || start % STEP_MINUTES !== 0 || start >= DAY_MINUTES) errors.add("start_local", "Start must fall on :00, :15, :30 or :45.");
  if (end === null || end % STEP_MINUTES !== 0) errors.add("end_local", "End must fall on :00, :15, :30 or :45, up to 24:00.");
  if (start !== null && end !== null && !errors.has("start_local") && !errors.has("end_local")) {
    if (end <= start) errors.add("end_local", "End must be after start.");
    else if (end - start < MIN_HOLD_MINUTES || end - start > MAX_HOLD_MINUTES) errors.add("end_local", "A hold lasts from 1 to 8 hours.");
  }
  if (start !== null && date === now.date && start < now.minute - (now.minute % STEP_MINUTES)) {
    errors.add("start_local", `Start can't be before ${hhmm(now.minute - (now.minute % STEP_MINUTES))} today.`);
  }

  const weeks = body.weeks ?? 1;
  if (!Number.isInteger(weeks) || (weeks as number) < 1 || (weeks as number) > MAX_WEEKS) errors.add("weeks", `Repeat for 1 to ${MAX_WEEKS} weeks.`);

  const notes = body.notes ?? "";
  if (typeof notes !== "string" || notes.length > NOTES_MAX) errors.add("notes", `Notes are at most ${NOTES_MAX} characters.`);

  let tenant: TenantRow | undefined;
  if (ctx.user.role === "operator") {
    if (typeof body.tenant_id === "string") [tenant] = await tenantRows(pool, body.tenant_id);
    if (!tenant) errors.add("tenant_id", "Choose the tenant this hold is for.");
  } else if (body.tenant_id !== undefined) {
    errors.add("tenant_id", "Leave the tenant out; holds are placed for your own business.");
  } else {
    [tenant] = await tenantRows(pool, ctx.user.tenant_id as string);
  }

  const dates = isKitchenDate(date) && Number.isInteger(weeks) ? Array.from({ length: weeks as number }, (_, k) => addDays(date, 7 * k)) : [];
  if (start !== null && end !== null && !errors.has("start_local") && !errors.has("end_local")) {
    for (const day of dates) {
      if (kitchenInstant(day, start) === null) errors.add("start_local", `${hhmm(start)} does not exist on ${day}: the clocks go forward.`);
      if (kitchenInstant(day, end) === null) errors.add("end_local", `${hhmm(end)} does not exist on ${day}: the clocks go forward.`);
    }
  }
  errors.throwIfAny();
  return { stationId: (station as { id: string }).id, dates, start: start as number, end: end as number, weeks: weeks as number, notes: notes as string, tenant: tenant as TenantRow };
}

async function placeHold(db: Db, ctx: Ctx<undefined>, p: Placement): Promise<HoldRow> {
  await lockFor(db, "station", p.stationId);
  const standing = await tenantStanding(db, p.tenant, ctx.nowMs);
  if (standing.status !== "active") throw tenantNotActive();
  assertDocumentsCover(p.dates, standing.required);
  // The cleaning gap reaches across midnight, so each occurrence is also compared with the
  // neighbouring days' blocks, placed on its own day's minute axis.
  const neighbours = p.dates.flatMap((date) => [addDays(date, -1), date, addDays(date, 1)]);
  const taken = await occupying(db, [...new Set(neighbours)], ctx.nowMs, p.stationId);
  const conflicts = p.dates.filter((date) => {
    const shift = new Map([[addDays(date, -1), -DAY_MINUTES], [date, 0], [addDays(date, 1), DAY_MINUTES]]);
    return slotTaken(
      { tenantId: p.tenant.id, start: p.start, end: p.end },
      taken.flatMap((b) => {
        const offset = shift.get(b.date);
        return offset === undefined ? [] : [{ tenantId: b.tenant_id, start: b.start_minute + offset, end: b.end_minute + offset }];
      }),
    );
  });
  if (conflicts.length > 0) {
    throw new ApiError(409, "slot_taken", "That station isn't free for that whole time, including cleaning.", { dates: conflicts });
  }
  const seq = (await one<{ n: number }>(db, "SELECT nextval('hold_ref_seq')::integer AS n")) as { n: number };
  const ref = `SK-${seq.n}`;
  const createdAt = new Date(ctx.nowMs);
  const expiresAt = new Date(Math.floor((ctx.nowMs + config.holdTtlSeconds * 1000) / 1000) * 1000);
  await db.query("INSERT INTO holds (ref, tenant_id, station_id, weeks, created_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
    ref,
    p.tenant.id,
    p.stationId,
    p.weeks,
    ctx.user.id,
    createdAt,
    expiresAt,
  ]);
  for (const [index, date] of p.dates.entries()) {
    await db.query(
      `INSERT INTO bookings (id, ref, hold_ref, tenant_id, station_id, date, start_minute, end_minute, start_at, end_at, status, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'held', $11, $12)`,
      [
        randomUUID(),
        `${ref}-${index + 1}`,
        ref,
        p.tenant.id,
        p.stationId,
        date,
        p.start,
        p.end,
        new Date(kitchenInstant(date, p.start) as number),
        new Date(kitchenInstant(date, p.end) as number),
        p.notes,
        createdAt,
      ],
    );
  }
  await audit(db, ctx.user.id, "hold", ref, "placed", { station_id: p.stationId, dates: p.dates });
  return { ref, tenant_id: p.tenant.id, station_id: p.stationId, weeks: p.weeks, created_at: createdAt, expires_at: expiresAt, confirmed_at: null };
}

async function confirmHold(ctx: Ctx<HoldRow>, payWith: PayWith): Promise<{ ref: string; bookings: ReturnType<typeof bookingView>[] }> {
  const ref = ctx.loaded.ref;
  return unitOfWork(async (db, effects) => {
    if (payWith === "hour_pack") await lockFor(db, "hour-pack", ctx.loaded.tenant_id);
    const hold = (await one<HoldRow>(db, "SELECT * FROM holds WHERE ref = $1 FOR UPDATE", [ref])) as HoldRow;
    if (hold.confirmed_at) throw invalidTransition();
    if (!holdIsLive(hold, ctx.nowMs)) throw new ApiError(410, "hold_expired", "This hold expired. Place it again if the time is still free.");
    const [tenant] = await tenantRows(db, hold.tenant_id);
    const standing = await tenantStanding(db, tenant, ctx.nowMs);
    if (standing.status !== "active") throw tenantNotActive();
    const bookings = await holdBookings(db, ref);
    assertDocumentsCover(
      bookings.map((b) => b.date),
      standing.required,
    );
    if (payWith === "hour_pack") {
      const needed = bookings.reduce((sum, b) => sum + b.elapsed_minutes, 0);
      const balance = await hourBalance(db, tenant.id);
      if (needed > balance) {
        throw new ApiError(409, "insufficient_hours", "Your hour pack has too few hours for this booking.", { needed_minutes: needed, balance_minutes: balance });
      }
    }
    const policy = await currentPolicy(db);
    const confirmedAt = new Date(ctx.nowMs);
    for (const b of bookings) {
      const amount = payWith === "account" ? stationTimeCents(b.elapsed_minutes, b.hourly_rate_cents) : null;
      await db.query("UPDATE bookings SET status = $2, pay_with = $3, amount_cents = $4, policy_version = $5 WHERE id = $1", [
        b.id,
        bookingTransition(b.status, "confirm"),
        payWith,
        amount,
        policy.version,
      ]);
      if (payWith === "hour_pack") await recordMovement(db, tenant.id, -b.elapsed_minutes, "booking", b.id, confirmedAt);
    }
    await db.query("UPDATE holds SET confirmed_at = $2 WHERE ref = $1", [ref, confirmedAt]);
    await audit(db, ctx.user.id, "hold", ref, "confirmed", { pay_with: payWith, policy_version: policy.version });
    const confirmed = await holdBookings(db, ref);
    if (payWith === "account") {
      const account = { tenantId: tenant.id, accountId: await accountFor(tenant) };
      for (const b of confirmed) await effects.bill(account, "charge", b.amount_cents as number, `Station time ${b.ref}`);
    }
    await sendEmail(bookingConfirmation(tenant, ref, confirmed, payWith, policy));
    return { ref, bookings: confirmed.map((b) => bookingView(b, ctx.user)) };
  });
}

export const holdRoutes = [
  route({
    method: "POST",
    path: "/api/holds",
    roles: ["operator", "owner", "cook"],
    body: "json",
    async handle(ctx) {
      const placement = await readPlacement(ctx);
      const hold = await transaction((db) => placeHold(db, ctx, placement));
      return { status: 201, json: await holdView(pool, hold, ctx.user) };
    },
  }),
  route<HoldRow>({
    method: "GET",
    path: "/api/holds/:ref",
    roles: ["operator", "owner", "cook"],
    load: loadLiveHold,
    async handle(ctx) {
      return { status: 200, json: await holdView(pool, ctx.loaded, ctx.user) };
    },
  }),
  route<HoldRow>({
    method: "DELETE",
    path: "/api/holds/:ref",
    roles: ["operator", "owner", "cook"],
    load: loadLiveHold,
    async handle(ctx) {
      await transaction(async (db) => {
        await db.query("DELETE FROM holds WHERE ref = $1", [ctx.loaded.ref]);
        await audit(db, ctx.user.id, "hold", ctx.loaded.ref, "released");
      });
      return { status: 204 };
    },
  }),
  route<HoldRow>({
    method: "POST",
    path: "/api/holds/:ref/confirm",
    roles: ["operator", "owner", "cook"],
    body: "json",
    idempotent: true,
    load: loadHold,
    async handle(ctx) {
      const payWith = ctx.json.pay_with;
      if (payWith !== "account" && payWith !== "hour_pack") throw validation({ pay_with: "Pay with account or hour_pack." });
      return { status: 200, json: await confirmHold(ctx, payWith) };
    },
  }),
];
