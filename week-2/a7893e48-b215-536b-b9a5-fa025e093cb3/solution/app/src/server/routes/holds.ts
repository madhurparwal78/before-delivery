import type pg from "pg";
import { audit } from "../audit.js";
import { requireActor, type Actor } from "../auth.js";
import { liveClaims } from "../claims.js";
import { all, newId, pool, tx } from "../db.js";
import { checkedDocuments, coverage } from "../documents.js";
import { confirmationEmail } from "../emails.js";
import { ApiError, field, invalid, json, route, type ApiRequest, type Json, type Reply } from "../http.js";
import { idempotent } from "../idempotency.js";
import { purchase, refund } from "../killbill.js";
import { lockRenter, move, packBalance } from "../ledger.js";
import { queueEmail } from "../mail.js";
import {
  authorizeHold, holdStatusAt, holdTransition, segmentLabel, segmentState, unpaidCutoff,
} from "../rules.js";
import { holdInScope, renterById, renterInScope, siteById, stationById, stationInScope, type HoldRow, type RenterRow } from "../scope.js";
import { addDays, daysBetween, datesTouched, elapsedMinutes, isLocalDate, localDate, localTime, resolveLocal } from "../time.js";
import { bookingJson, bookingView, holdJson, policyInForce, type Occurrence } from "../views.js";
import { config } from "../config.js";
import { packSplit, timeCents } from "../../shared/pricing.js";

const QUARTER = /^([01]\d|2[0-3]):(00|15|30|45)$/;
const YEAR_MS = 365 * 24 * 3600000;

interface Planned { localDate: string; start: Date; end: Date }

function instant(value: Json | undefined): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(value)) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The occurrences a hold request asks for: the local form resolves each week's wall times by the
 * clock-change rule; the UTC form takes its instants as given for the first week.
 */
function planOccurrences(body: Json, zone: string, now: Date, fields: Record<string, string>): Planned[] {
  const repeatRaw = field(body, "repeat_weeks");
  const repeat = repeatRaw === undefined ? 1 : repeatRaw;
  if (typeof repeat !== "number" || !Number.isInteger(repeat) || repeat < 1 || repeat > 12) fields.repeat_weeks = "Repeat for 1 to 12 weeks.";
  const utc = field(body, "start_at") !== undefined || field(body, "end_at") !== undefined;
  const whenField = utc ? "start_at" : "date";
  let first: Planned | null = null;
  let date = "";
  let startTime = "";
  let endTime = "";
  let endDayOffset = 0;
  if (utc) {
    const start = instant(field(body, "start_at"));
    const end = instant(field(body, "end_at"));
    if (!start || start.getTime() % 900000 !== 0) fields.start_at = "Start on a quarter hour, as UTC ISO 8601 with Z.";
    if (!end || end.getTime() % 900000 !== 0) fields.end_at = "End on a quarter hour, as UTC ISO 8601 with Z.";
    if (start && end && !fields.start_at && !fields.end_at) {
      date = localDate(zone, start);
      startTime = localTime(zone, start);
      endTime = localTime(zone, end);
      endDayOffset = daysBetween(date, localDate(zone, end));
      first = { localDate: date, start, end };
    }
  } else {
    const rawDate = field(body, "date");
    const rawStart = field(body, "start");
    const rawEnd = field(body, "end");
    if (!isLocalDate(rawDate)) fields.date = "Use a date in the form YYYY-MM-DD.";
    if (typeof rawStart !== "string" || !QUARTER.test(rawStart)) fields.start = "Start on a quarter hour (HH:00, :15, :30 or :45).";
    if (typeof rawEnd !== "string" || !QUARTER.test(rawEnd)) fields.end = "End on a quarter hour (HH:00, :15, :30 or :45).";
    if (isLocalDate(rawDate) && typeof rawStart === "string" && typeof rawEnd === "string") {
      date = rawDate;
      startTime = rawStart;
      endTime = rawEnd;
      endDayOffset = rawEnd <= rawStart ? 1 : 0;
    }
  }
  if (Object.keys(fields).length > 0 || typeof repeat !== "number") return [];
  const planned: Planned[] = [];
  for (let week = 0; week < repeat; week += 1) {
    const day = addDays(date, 7 * week);
    planned.push(week === 0 && first ? first : {
      localDate: day,
      start: resolveLocal(zone, day, startTime),
      end: resolveLocal(zone, addDays(day, endDayOffset), endTime),
    });
  }
  for (const occurrence of planned) {
    const minutes = elapsedMinutes(occurrence.start, occurrence.end);
    if (minutes < 15 || minutes > 720) fields[utc ? "end_at" : "end"] = "An occurrence lasts 15 minutes to 12 hours.";
    if (occurrence.start.getTime() <= now.getTime()) fields[whenField] = "Each occurrence must start after the current time.";
    else if (occurrence.start.getTime() > now.getTime() + YEAR_MS) fields[whenField] = "Each occurrence must start within 365 days.";
  }
  return planned;
}

async function holdReply(status: number, hold: HoldRow, now: Date): Promise<Reply> {
  const view = await holdJson(pool, hold, holdStatusAt(hold.status, hold.expires_at, now), now);
  if (hold.status === "held") await pool.query("UPDATE holds SET quoted_pack_minutes = $2 WHERE id = $1", [hold.id, view.packMinutes]);
  return json(status, { hold: view.json });
}

route("POST", "/api/holds", async (request) => {
  const actor = await requireActor(request);
  const stationId = field(request.body, "station_id");
  if (typeof stationId !== "string") throw invalid({ station_id: "Choose a station." });
  const { station, site } = await stationInScope(pool, actor, stationId);
  const renterField = field(request.body, "renter_id");
  let renter: RenterRow | null = null;
  if (typeof renterField === "string") renter = await renterInScope(pool, actor, renterField);
  else if (actor.role === "renter" && actor.renterId) renter = await renterById(pool, actor.renterId);
  const fields: Record<string, string> = {};
  if (!renter) fields.renter_id = "Choose the renter this hold is for.";
  const planned = planOccurrences(request.body, site.time_zone, new Date(), fields);
  if (!renter || Object.keys(fields).length > 0) throw invalid(fields);
  const holder = renter;
  const hold = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`station:${station.id}`]);
    const now = new Date();
    for (const occurrence of planned) {
      const blocker = (await liveClaims(client, { stationIds: [station.id] }, occurrence.start, occurrence.end, now))[0];
      if (blocker) {
        const state = segmentState(blocker.kind, actor.role === "renter" && blocker.renter_id === actor.renterId);
        throw new ApiError(409, "slot_taken", {
          blocker: {
            state, start_at: blocker.start_at.toISOString(), end_at: blocker.end_at.toISOString(),
            label: segmentLabel(state, site.time_zone, blocker.start_at, blocker.end_at), date: occurrence.localDate,
          },
        });
      }
    }
    const row: HoldRow = {
      id: newId("hd"), site_id: site.id, station_id: station.id, renter_id: holder.id, status: "held",
      created_at: now, expires_at: new Date(now.getTime() + config.holdTtlSeconds * 1000), quoted_pack_minutes: 0,
    };
    await client.query(
      "INSERT INTO holds (id, site_id, station_id, renter_id, status, created_at, expires_at) VALUES ($1,$2,$3,$4,'held',$5,$6)",
      [row.id, row.site_id, row.station_id, row.renter_id, row.created_at, row.expires_at]);
    for (const [position, occurrence] of planned.entries()) {
      await client.query("INSERT INTO hold_occurrences (hold_id, position, local_date, start_at, end_at) VALUES ($1,$2,$3,$4,$5)",
        [row.id, position, occurrence.localDate, occurrence.start, occurrence.end]);
    }
    await audit(client, { holdId: row.id, actor, action: "place_hold", from: null, to: "held", at: now });
    return row;
  });
  return holdReply(201, hold, new Date());
});

route("GET", "/api/holds/:id", async (request) => {
  const actor = await requireActor(request);
  return holdReply(200, await holdInScope(pool, actor, request.params.id ?? ""), new Date());
});

route("DELETE", "/api/holds/:id", async (request) => {
  const actor = await requireActor(request);
  await holdInScope(pool, actor, request.params.id ?? "");
  authorizeHold("release", actor.role);
  await tx(async (client) => {
    const hold = await holdInScope(client, actor, request.params.id ?? "", true);
    const now = new Date();
    const to = holdTransition("release", hold.status, hold.expires_at, now);
    await client.query("UPDATE holds SET status = $2, ended_at = $3 WHERE id = $1", [hold.id, to, now]);
    await audit(client, { holdId: hold.id, actor, action: "release", from: "held", to, at: now });
  });
  return { status: 204 };
});

route("POST", "/api/holds/:id/override", async (request) => {
  const actor = await requireActor(request);
  await holdInScope(pool, actor, request.params.id ?? "");
  authorizeHold("override_release", actor.role);
  const hold = await tx(async (client) => {
    const locked = await holdInScope(client, actor, request.params.id ?? "", true);
    const now = new Date();
    const to = holdTransition("override_release", locked.status, locked.expires_at, now);
    const reason = overrideReason(request.body, "release");
    await client.query("UPDATE holds SET status = $2, ended_at = $3 WHERE id = $1", [locked.id, to, now]);
    await audit(client, { holdId: locked.id, actor, action: "override_release", from: "held", to, at: now, reason });
    return { ...locked, status: to };
  });
  return holdReply(200, hold, new Date());
});

/** A manager override's action and reason (5 to 500 characters), or the validation error. */
export function overrideReason(body: Json, action: string): string {
  const fields: Record<string, string> = {};
  if (field(body, "action") !== action) fields.action = `The action must be ${action}.`;
  const reason = field(body, "reason");
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < 5 || text.length > 500) fields.reason = "Give a reason of at least 5 characters.";
  if (Object.keys(fields).length > 0) throw invalid(fields);
  return text;
}

route("POST", "/api/holds/:id/confirm", async (request) => {
  const actor = await requireActor(request);
  const hold = await holdInScope(pool, actor, request.params.id ?? "");
  authorizeHold("confirm", actor.role);
  return idempotent(request, actor, () => confirmHold(request, actor, hold.id));
});

interface Payment { paymentId: string; cents: number }

/** Refunds, in full, every Kill Bill payment a failed confirmation made. */
async function undo(payments: Payment[]): Promise<void> {
  for (const payment of payments) await refund(payment.paymentId, payment.cents);
}

/** Dates any occurrence touches that no readable liability certificate covers. */
async function uncoveredDates(client: pg.PoolClient, renterId: string, zone: string, occurrences: Occurrence[]): Promise<string[]> {
  const dates = [...new Set(occurrences.flatMap((occurrence) => datesTouched(zone, occurrence.start_at, occurrence.end_at)))].sort();
  const certificates = await checkedDocuments(client, renterId, "liability");
  return dates.filter((date) => coverage(certificates, date).status !== "current");
}

/** Confirmation, in the brief's order, all or nothing (brief: Business rules, Confirmation). */
async function confirmHold(request: ApiRequest, actor: Actor, holdId: string): Promise<Reply> {
  const arrived = new Date();
  return tx(async (client) => {
    const hold = await holdInScope(client, actor, holdId, true);
    holdTransition("confirm", hold.status, hold.expires_at, arrived);
    const usePack = field(request.body, "use_pack");
    const payNow = field(request.body, "pay_now");
    const fields: Record<string, string> = {};
    if (typeof usePack !== "boolean") fields.use_pack = "Say whether to use pack hours.";
    if (typeof payNow !== "boolean") fields.pay_now = "Choose Pay now or Pay later.";
    if (Object.keys(fields).length > 0) throw invalid(fields);
    const site = await siteById(client, hold.site_id);
    const station = await stationById(client, hold.station_id);
    const renter = await renterById(client, hold.renter_id);
    const zone = site.time_zone;
    const occurrences = await all<Occurrence>(client, "SELECT * FROM hold_occurrences WHERE hold_id = $1 ORDER BY start_at", [hold.id]);

    const uncovered = await uncoveredDates(client, renter.id, zone, occurrences);
    if (uncovered.length > 0) throw new ApiError(422, "certificate_required", { dates: uncovered });

    await lockRenter(client, renter.id);
    const available = usePack ? (await packBalance(client, renter.id)).available : 0;
    if (usePack && available === 0 && hold.quoted_pack_minutes > 0) throw new ApiError(422, "pack_insufficient");
    const minutes = occurrences.map((occurrence) => elapsedMinutes(occurrence.start_at, occurrence.end_at));
    const pack = packSplit(minutes, available);
    const planned = occurrences.map((occurrence, index) => {
      const total = minutes[index] ?? 0;
      const packMinutes = pack[index] ?? 0;
      const cardMinutes = total - packMinutes;
      return {
        id: newId("bk"), occurrence, minutes: total, packMinutes, cardMinutes,
        cardCents: timeCents(cardMinutes, station.rate_cents), depositCents: cardMinutes > 0 ? site.deposit_cents : 0,
        cutoffAt: unpaidCutoff(zone, occurrence.start_at), depositPaymentId: null as string | null, timePaymentId: null as string | null,
      };
    });
    if (!payNow && planned.some((booking) => booking.cardMinutes > 0 && booking.cutoffAt.getTime() <= arrived.getTime())) {
      throw new ApiError(422, "pay_now_required");
    }

    const made: Payment[] = [];
    try {
      for (const booking of planned.filter((candidate) => candidate.cardMinutes > 0)) {
        booking.depositPaymentId = await purchase(renter.id, `hs-deposit-${booking.id}`, booking.depositCents);
        made.push({ paymentId: booking.depositPaymentId, cents: booking.depositCents });
        if (payNow) {
          booking.timePaymentId = await purchase(renter.id, `hs-booking-${booking.id}`, booking.cardCents);
          made.push({ paymentId: booking.timePaymentId, cents: booking.cardCents });
        }
      }
      const confirmedAt = new Date();
      const policy = await policyInForce(client, site.id, confirmedAt);
      await client.query("UPDATE holds SET status = 'confirmed', ended_at = $2 WHERE id = $1", [hold.id, confirmedAt]);
      await audit(client, { holdId: hold.id, actor, action: "confirm", from: "held", to: "confirmed", at: confirmedAt });
      for (const booking of planned) {
        await client.query(
          `INSERT INTO bookings (id, hold_id, site_id, station_id, renter_id, status, start_at, end_at, minutes, pack_minutes, card_minutes,
             card_cents, deposit_cents, cutoff_at, deposit_payment_id, time_payment_id, policy_version_id, confirmed_at)
           VALUES ($1,$2,$3,$4,$5,'confirmed',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [booking.id, hold.id, site.id, station.id, renter.id, booking.occurrence.start_at, booking.occurrence.end_at, booking.minutes,
            booking.packMinutes, booking.cardMinutes, booking.cardCents, booking.depositCents, booking.cutoffAt,
            booking.depositPaymentId, booking.timePaymentId, policy.id, confirmedAt]);
        await audit(client, { bookingId: booking.id, holdId: hold.id, actor, action: "confirm", from: "held", to: "confirmed", at: confirmedAt });
        if (booking.depositPaymentId) await audit(client, { bookingId: booking.id, actor, action: "charge_deposit", from: "confirmed", to: "confirmed", at: confirmedAt });
        if (booking.timePaymentId) await audit(client, { bookingId: booking.id, actor, action: "charge_time", from: "confirmed", to: "confirmed", at: confirmedAt });
        if (booking.packMinutes > 0) await move(client, { renterId: renter.id, reason: "reserve", minutes: booking.packMinutes, at: confirmedAt, bookingId: booking.id });
      }
      const email = confirmationEmail(site.name, zone, station.name, policy.notice_hours, planned.map((booking) => ({
        localDate: booking.occurrence.local_date, startAt: booking.occurrence.start_at, endAt: booking.occurrence.end_at,
        minutes: booking.minutes, packMinutes: booking.packMinutes, cardCents: booking.cardCents, depositCents: booking.depositCents,
        paid: booking.cardMinutes === 0 || booking.timePaymentId !== null, cutoffAt: booking.cutoffAt,
      })));
      await queueEmail(client, renter.email, email.subject, email.body);
      const bookings = [];
      for (const booking of planned) bookings.push(bookingJson(await bookingView(client, booking.id), confirmedAt));
      return json(201, { bookings, email: "queued" });
    } catch (error) {
      await undo(made);
      throw error;
    }
  });
}
