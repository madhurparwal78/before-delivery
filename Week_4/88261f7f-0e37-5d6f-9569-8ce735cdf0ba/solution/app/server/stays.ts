import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { Night, Quote, RoomStatus, Stay } from "../shared/api";
import { addDays, daysBetween, isIsoDate, nightsBetween, type IsoDate } from "../shared/dates";
import { isEmailAddress } from "../shared/email";
import { notices, statusWords } from "../shared/notices";
import { database, inserted, isUniqueViolation, one, run, atomic, type Queryable, type Row } from "./db";
import { fail, isObject, isUuid, ok, type JsonObject, type Reply } from "./http";
import { hotelNow, nightOf } from "./clock";
import { loadHotel, taxRatesOf, type HotelRecord } from "./hotel";
import { emit } from "./live";
import { newLinkToken, sendCheckinLink } from "./mailLink";
import { MailUnavailable } from "./providers/smtp";
import { config } from "./config";
import { postCharge, createFolio } from "./folios";
import { cityTaxCents, nightRoomCents, type PlanPrices, type TaxRateInForce } from "./rules/pricing";
import { CANNOT_MOVE, isFinal, transition, type StayAction } from "../shared/stayStatus";
import { findStay, loadStay, nightRows, nightView, stayView, type NightRow, type StayRow } from "./stayView";

const MAX_NIGHTS = 90;
const MIN_GUESTS = 1;
const MAX_GUESTS = 6;
const KEY_MAX = 200;
const STALE = "This stay was changed by someone else. It now shows the latest.";
const NOT_WAITING = "This stay is no longer waiting for check-in.";

const justTaken = (number: string): string => `Room ${number} was just taken. Choose another room.`;
const occupiedOn = (number: string, night: IsoDate): string => `Room ${number} is occupied on ${night}.`;

interface RoomRow extends Row { id: string; number: string; type: string; status: RoomStatus }
interface PlanRow extends Row { id: string; weeknight_cents: number; weekend_cents: number }

const planPrices = (plan: PlanRow): PlanPrices => ({ weeknightCents: plan.weeknight_cents, weekendCents: plan.weekend_cents });

async function findRoom(from: Queryable, hotelId: string, roomId: unknown): Promise<RoomRow | undefined> {
  if (typeof roomId !== "string" || !isUuid(roomId)) return undefined;
  return one<RoomRow>(from, "SELECT id, number, type, status FROM rooms WHERE id = $1 AND hotel_id = $2", [roomId, hotelId]);
}

/** A room that a stored night points at: it exists by foreign key. */
export const roomOf = (from: Queryable, roomId: string): Promise<RoomRow> =>
  inserted<RoomRow>(from, "SELECT id, number, type, status FROM rooms WHERE id = $1", [roomId]);

const planOf = (from: Queryable, planId: string): Promise<PlanRow> =>
  inserted<PlanRow>(from, "SELECT id, weeknight_cents, weekend_cents FROM rate_plans WHERE id = $1", [planId]);

async function findPlan(from: Queryable, hotelId: string, planId: unknown): Promise<PlanRow | undefined> {
  if (typeof planId !== "string" || !isUuid(planId)) return undefined;
  return one<PlanRow>(from, "SELECT id, weeknight_cents, weekend_cents FROM rate_plans WHERE id = $1 AND hotel_id = $2", [planId, hotelId]);
}

interface PricedNight { night: IsoDate; roomCents: number; cityTaxCents: number }

/** The room and city tax amounts of every night of a stay, from the current plan and the stay's total nights. */
export function priceNights(plan: PlanPrices, arrival: IsoDate, departure: IsoDate, guests: number): PricedNight[] {
  const nights = nightsBetween(arrival, departure);
  return nights.map((night) => ({
    night, roomCents: nightRoomCents(plan, night, guests, nights.length), cityTaxCents: cityTaxCents(guests),
  }));
}

function quoteNights(priced: readonly PricedNight[], room: RoomRow, rates: readonly TaxRateInForce[]): Night[] {
  return priced.map((line) => nightView(
    { night: line.night, room_id: room.id, room_number: room.number, room_cents: line.roomCents, city_tax_cents: line.cityTaxCents, tax_cents: null, posted: false },
    rates,
  ));
}

/** The first night in `nights` that another stay holds in the room, or null. */
async function firstHeldNight(from: Queryable, roomId: string, nights: readonly IsoDate[], exceptStayId: string | null): Promise<IsoDate | null> {
  if (nights.length === 0) return null;
  const held = await one<Row & { night: IsoDate }>(
    from,
    `SELECT min(night) AS night FROM stay_nights
     WHERE room_id = $1 AND holds AND night = ANY($2::date[]) AND ($3::uuid IS NULL OR stay_id <> $3)`,
    [roomId, nights, exceptStayId],
  );
  return held?.night ?? null;
}

interface StayFields {
  arrival: IsoDate | null;
  departure: IsoDate | null;
  guests: number | null;
  room: RoomRow | null;
  plan: PlanRow | null;
}

interface FieldContext { businessDate: IsoDate; inHouse: boolean; arrival: IsoDate | null }

/** Validates the stay fields that were sent; unsent fields (null in `sent`) are not judged. */
async function checkFields(
  from: Queryable, hotelId: string, body: JsonObject, sent: readonly string[], context: FieldContext, errors: Record<string, string>,
): Promise<StayFields> {
  const has = (name: string): boolean => sent.includes(name);
  const arrival = isIsoDate(body.arrival) ? body.arrival : null;
  const departure = isIsoDate(body.departure) ? body.departure : null;
  const effectiveArrival = has("arrival") ? arrival : context.arrival;
  if (has("arrival") && (arrival === null || arrival < context.businessDate)) errors.arrival = "Arrival cannot be before the business date.";
  if (has("departure")) {
    if (departure === null || effectiveArrival === null || departure <= effectiveArrival) errors.departure = "Departure must be after arrival.";
    else if (daysBetween(effectiveArrival, departure) > MAX_NIGHTS) errors.departure = "Stays are limited to 90 nights.";
    else if (context.inHouse && departure < context.businessDate) errors.departure = "Departure cannot be before the business date.";
  }
  const guests = typeof body.guests === "number" && Number.isInteger(body.guests) ? body.guests : null;
  if (has("guests") && (guests === null || guests < MIN_GUESTS || guests > MAX_GUESTS)) errors.guests = "Guests must be between 1 and 6.";
  const room = has("roomId") ? (await findRoom(from, hotelId, body.roomId)) ?? null : null;
  if (has("roomId") && !room) errors.roomId = "Choose a room.";
  const plan = has("ratePlanId") ? (await findPlan(from, hotelId, body.ratePlanId)) ?? null : null;
  if (has("ratePlanId") && !plan) errors.ratePlanId = "Choose a rate plan.";
  return { arrival, departure, guests, room, plan };
}

const CREATE_FIELDS = ["arrival", "departure", "guests", "roomId", "ratePlanId"];

export async function quoteStay(hotelId: string, body: JsonObject): Promise<Reply> {
  const hotel = await loadHotel(database(), hotelId);
  const errors: Record<string, string> = {};
  const fields = await checkFields(database(), hotelId, body, CREATE_FIELDS, { businessDate: hotel.businessDate, inHouse: false, arrival: null }, errors);
  if (Object.keys(errors).length > 0 || !fields.arrival || !fields.departure || !fields.guests || !fields.room || !fields.plan) throw fail.invalid(errors);
  const priced = priceNights(planPrices(fields.plan), fields.arrival, fields.departure, fields.guests);
  const nightly = quoteNights(priced, fields.room, await taxRatesOf(database(), hotelId));
  const quote: Quote = { nightly, totalCents: nightly.reduce((sum, night) => sum + night.totalCents, 0) };
  return ok(quote);
}

const fingerprintOf = (body: JsonObject): string => createHash("sha256").update(canonical(body)).digest("hex");

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

interface GuestInput { name: string; email: string; phone: string }

function checkGuest(body: JsonObject, errors: Record<string, string>): GuestInput | { id: string } | null {
  if (typeof body.guestId === "string") {
    if (isUuid(body.guestId)) return { id: body.guestId };
    errors["guest.name"] = "Enter the guest's name.";
    return null;
  }
  const guest = isObject(body.guest) ? body.guest : {};
  const name = typeof guest.name === "string" ? guest.name.trim() : "";
  const email = typeof guest.email === "string" ? guest.email.trim() : "";
  const phone = typeof guest.phone === "string" ? guest.phone.trim() : "";
  if (!name) errors["guest.name"] = "Enter the guest's name.";
  const validEmail = isEmailAddress(email);
  if (!validEmail) errors["guest.email"] = "Enter a valid email address.";
  return name && validEmail ? { name, email, phone } : null;
}

async function guestFor(client: PoolClient, hotelId: string, input: GuestInput | { id: string }): Promise<string | null> {
  if ("id" in input) return (await one<Row & { id: string }>(client, "SELECT id FROM guests WHERE id = $1 AND hotel_id = $2", [input.id, hotelId]))?.id ?? null;
  const existing = await one<Row & { id: string }>(client, "SELECT id FROM guests WHERE hotel_id = $1 AND lower(email) = lower($2)", [hotelId, input.email]);
  if (existing) return existing.id;
  const created = await inserted<Row & { id: string }>(
    client, "INSERT INTO guests (hotel_id, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING id", [hotelId, input.name, input.email, input.phone]);
  return created.id;
}

export async function insertNights(client: Queryable, stayId: string, roomId: string, priced: readonly PricedNight[]): Promise<void> {
  for (const line of priced) {
    await run(client, "INSERT INTO stay_nights (stay_id, night, room_id, room_cents, city_tax_cents) VALUES ($1, $2, $3, $4, $5)",
      [stayId, line.night, roomId, line.roomCents, line.cityTaxCents]);
  }
}

/** Tries the link mail inside the transaction; the link counts as sent only once the mail service accepted it. */
export async function trySendLink(client: Queryable, hotel: HotelRecord, stayId: string, email: string, token: string, origin: string): Promise<boolean> {
  try {
    await sendCheckinLink(hotel.name, email, token, origin);
  } catch (failure) {
    if (failure instanceof MailUnavailable) return false;
    throw failure;
  }
  const expires = new Date(hotelNow(hotel.clockNow).getTime() + config.linkTtlSeconds * 1000);
  await run(client, "UPDATE stays SET link_state = 'sent', link_token = $2, link_expires_at = $3 WHERE id = $1", [stayId, token, expires]);
  return true;
}

export async function createStay(hotelId: string, origin: string, idempotencyKey: string | undefined, body: JsonObject): Promise<Reply> {
  const errors: Record<string, string> = {};
  const key = idempotencyKey && idempotencyKey.length >= 1 && idempotencyKey.length <= KEY_MAX ? idempotencyKey : null;
  if (!key) errors.idempotencyKey = "Send an Idempotency-Key header.";
  const fingerprint = fingerprintOf(body);
  if (key) {
    const replay = await replayOf(hotelId, key, fingerprint);
    if (replay) return replay;
  }
  const hotel = await loadHotel(database(), hotelId);
  const fields = await checkFields(database(), hotelId, body, CREATE_FIELDS, { businessDate: hotel.businessDate, inHouse: false, arrival: null }, errors);
  const guest = checkGuest(body, errors);
  const nights = fields.arrival && fields.departure && !errors.arrival && !errors.departure ? nightsBetween(fields.arrival, fields.departure) : [];
  if (fields.room && nights.length > 0) {
    const held = await firstHeldNight(database(), fields.room.id, nights, null);
    if (held) throw fail.conflict(justTaken(fields.room.number));
  }
  if (Object.keys(errors).length > 0 || !guest || !fields.arrival || !fields.departure || !fields.guests || !fields.room || !fields.plan || !key) throw fail.invalid(errors);
  const { arrival, departure, guests, room, plan } = fields;
  try {
    const first = await atomic(async (client) => {
      // Shared with other creates, exclusive against the close: a stay is booked before the close or refused after it.
      const current = await loadHotel(client, hotelId, "share");
      if (arrival < current.businessDate) throw fail.invalid({ arrival: "Arrival cannot be before the business date." });
      const claimed = await run(client, "INSERT INTO idempotency_keys (hotel_id, key, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [hotelId, key, fingerprint]);
      if (claimed === 0) return null;
      const guestId = await guestFor(client, hotelId, guest);
      if (!guestId) throw fail.invalid({ "guest.name": "Enter the guest's name." });
      const token = newLinkToken();
      const created = await inserted<Row & { id: string }>(
        client,
        `INSERT INTO stays (hotel_id, guest_id, rate_plan_id, guests, arrival, departure, status, link_token)
         VALUES ($1, $2, $3, $4, $5, $6, 'booked', $7) RETURNING id`,
        [hotelId, guestId, plan.id, guests, arrival, departure, token]);
      const id = created.id;
      await insertNights(client, id, room.id, priceNights(planPrices(plan), arrival, departure, guests));
      const holder = await inserted<Row & { name: string; email: string }>(client, "SELECT name, email FROM guests WHERE id = $1", [guestId]);
      await createFolio(client, hotelId, id, holder.name, holder.email);
      await trySendLink(client, hotel, id, holder.email, token, origin);
      const response = await loadStay(client, hotelId, id);
      await run(client, "UPDATE idempotency_keys SET stay_id = $3, response = $4 WHERE hotel_id = $1 AND key = $2", [hotelId, key, id, JSON.stringify(response)]);
      await emit(client, hotelId, { type: "stay", stayId: id, roomId: room.id, notice: notices.stayCreated(holder.name, room.number) }, [room.id]);
      return response;
    });
    if (first === null) return (await replayOf(hotelId, key, fingerprint)) as Reply;
    return ok(first, 201);
  } catch (failure) {
    if (isUniqueViolation(failure, "stay_nights_hold")) throw fail.conflict(justTaken(room.number));
    throw failure;
  }
}

async function replayOf(hotelId: string, key: string, fingerprint: string): Promise<Reply | null> {
  const stored = await one<Row & { fingerprint: string; stay_id: string | null; response: Stay | null }>(
    database(), "SELECT fingerprint, stay_id, response FROM idempotency_keys WHERE hotel_id = $1 AND key = $2", [hotelId, key]);
  if (!stored) return null;
  if (stored.fingerprint !== fingerprint) throw fail.conflict("This request was already used for a different stay.");
  return ok(stored.response ?? (await loadStay(database(), hotelId, stored.stay_id as string)), 201);
}

interface Locked { hotel: HotelRecord; row: StayRow }

async function lockStay(client: PoolClient, hotelId: string, stayId: string): Promise<Locked> {
  const row = await findStay(client, hotelId, stayId, true);
  if (!row) throw fail.notFound();
  return { hotel: await loadHotel(client, hotelId), row };
}

/** 409 for a final stay, then 409 for a stale version; a malformed version is a 422. */
function checkVersion(row: StayRow, version: unknown, errors: Record<string, string>): void {
  if (isFinal(row.status)) throw fail.conflict(CANNOT_MOVE);
  if (typeof version !== "number" || !Number.isInteger(version)) {
    errors.version = "Send the version you read.";
    return;
  }
  if (version !== row.version) throw fail.conflict(STALE);
}

export async function patchStay(hotelId: string, stayId: string, body: JsonObject): Promise<Reply> {
  try {
    return await patchStayOnce(hotelId, stayId, body);
  } catch (failure) {
    if (isUniqueViolation(failure, "stay_nights_hold")) throw fail.conflict(STALE);
    throw failure;
  }
}

async function patchStayOnce(hotelId: string, stayId: string, body: JsonObject): Promise<Reply> {
  await atomic(async (client) => {
    const { hotel, row } = await lockStay(client, hotelId, stayId);
    const errors: Record<string, string> = {};
    checkVersion(row, body.version, errors);
    const inHouse = row.status === "in_house";
    if (inHouse && typeof body.arrival === "string" && body.arrival !== row.arrival) throw fail.conflict("An in-house stay cannot change its arrival.");
    const sent = ["arrival", "departure", "guests", "ratePlanId"].filter((name) => name in body && !(inHouse && (name === "arrival" || name === "ratePlanId")));
    const fields = await checkFields(client, hotelId, body, sent, { businessDate: hotel.businessDate, inHouse, arrival: row.arrival }, errors);
    const arrival = sent.includes("arrival") ? fields.arrival : row.arrival;
    const departure = sent.includes("departure") ? fields.departure : row.departure;
    const nights = await nightRows(client, stayId);
    const first = nights[0] as NightRow;
    const last = nights[nights.length - 1] as NightRow;
    if (arrival && departure && departure > arrival && !errors.arrival && !errors.departure) {
      const wanted = nightsBetween(arrival, departure);
      const existing = new Set(nights.map((night) => night.night));
      const before = wanted.filter((night) => !existing.has(night) && night < first.night);
      const after = wanted.filter((night) => !existing.has(night) && night > last.night);
      for (const [roomId, number, added] of [[first.room_id, first.room_number, before], [last.room_id, last.room_number, after]] as const) {
        const held = await firstHeldNight(client, roomId, added, stayId);
        if (held) throw fail.conflict(occupiedOn(number, held));
      }
    }
    if (Object.keys(errors).length > 0 || !arrival || !departure) throw fail.invalid(errors);
    const guests = sent.includes("guests") && fields.guests ? fields.guests : row.guests;
    const planRow = fields.plan ?? (await planOf(client, row.rate_plan_id));
    await reprice(client, stayId, nights, { arrival, departure, guests, plan: planRow, firstRoom: first.room_id, lastRoom: last.room_id });
    await run(client, "UPDATE stays SET arrival = $2, departure = $3, guests = $4, rate_plan_id = $5, version = version + 1 WHERE id = $1",
      [stayId, arrival, departure, guests, planRow.id]);
    await emit(client, hotelId, { type: "stay", stayId, notice: notices.stayUpdated(row.guest_name) }, [first.room_id, last.room_id]);
  });
  return ok(await loadStay(database(), hotelId, stayId));
}

interface Repricing { arrival: IsoDate; departure: IsoDate; guests: number; plan: PlanRow; firstRoom: string; lastRoom: string }

/** Unposted nights are priced again from the current plan and new total nights; posted nights never change. */
async function reprice(client: PoolClient, stayId: string, current: readonly NightRow[], next: Repricing): Promise<void> {
  const priced = priceNights(planPrices(next.plan), next.arrival, next.departure, next.guests);
  const existing = new Map(current.map((night) => [night.night, night]));
  const wanted = new Set(priced.map((line) => line.night));
  for (const night of current) {
    if (!wanted.has(night.night) && !night.posted) await run(client, "DELETE FROM stay_nights WHERE stay_id = $1 AND night = $2", [stayId, night.night]);
  }
  for (const line of priced) {
    const old = existing.get(line.night);
    if (old?.posted) continue;
    if (old) {
      await run(client, "UPDATE stay_nights SET room_cents = $3, city_tax_cents = $4 WHERE stay_id = $1 AND night = $2", [stayId, line.night, line.roomCents, line.cityTaxCents]);
    } else {
      const roomId = line.night < (current[0]?.night ?? line.night) ? next.firstRoom : next.lastRoom;
      await insertNights(client, stayId, roomId, [line]);
    }
  }
}

export async function moveStay(hotelId: string, stayId: string, body: JsonObject): Promise<Reply> {
  try {
    return await moveStayOnce(hotelId, stayId, body);
  } catch (failure) {
    if (isUniqueViolation(failure, "stay_nights_hold")) {
      const row = await findStay(database(), hotelId, stayId);
      const room = await findRoom(database(), hotelId, body.roomId);
      const nights = row ? nightsBetween(row.arrival, row.departure) : [];
      const held = room ? await firstHeldNight(database(), room.id, nights, stayId) : null;
      throw fail.conflict(room && held ? occupiedOn(room.number, held) : STALE);
    }
    throw failure;
  }
}

async function moveStayOnce(hotelId: string, stayId: string, body: JsonObject): Promise<Reply> {
  await atomic(async (client) => {
    const { hotel, row } = await lockStay(client, hotelId, stayId);
    const errors: Record<string, string> = {};
    checkVersion(row, body.version, errors);
    const hasArrival = "arrival" in body && body.arrival !== undefined;
    const hasFromNight = "fromNight" in body && body.fromNight !== undefined;
    if (hasArrival && hasFromNight) throw fail.invalid({ arrival: "Send arrival or fromNight, not both." });
    const room = await findRoom(client, hotelId, body.roomId);
    if (!room) errors.roomId = "Choose a room.";
    const nights = await nightRows(client, stayId);
    const inHouse = row.status === "in_house";
    let moving: IsoDate[] = [];
    let newArrival: IsoDate | null = null;
    if (hasArrival) {
      if (row.status !== "booked") errors.arrival = "Only a booked stay can change its dates this way.";
      else if (!isIsoDate(body.arrival) || body.arrival < hotel.businessDate) errors.arrival = "Arrival cannot be before the business date.";
      else newArrival = body.arrival;
    } else {
      const from = hasFromNight ? body.fromNight : inHouse ? hotel.businessDate : row.arrival;
      const own = nights.map((night) => night.night);
      if (typeof from !== "string" || !own.includes(from) || from < hotel.businessDate) errors.fromNight = "Choose a night of this stay that is not before the business date.";
      else moving = own.filter((night) => night >= from);
    }
    if (room && newArrival) {
      const length = nights.length;
      const held = await firstHeldNight(client, room.id, nightsBetween(newArrival, addDays(newArrival, length)), stayId);
      if (held) throw fail.conflict(occupiedOn(room.number, held));
    } else if (room && moving.length > 0) {
      const held = await firstHeldNight(client, room.id, moving, stayId);
      if (held) throw fail.conflict(occupiedOn(room.number, held));
    }
    const leaving = nights.find((night) => night.night === hotel.businessDate && moving.includes(night.night) && room && night.room_id !== room.id);
    if (room && inHouse && leaving && room.status !== "clean" && room.status !== "inspected") {
      throw fail.conflict(`Room ${room.number} is ${statusWords(room.status)} and cannot take an in-house guest.`);
    }
    if (Object.keys(errors).length > 0 || !room) throw fail.invalid(errors);
    const touched = new Set<string>([room.id, ...nights.map((night) => night.room_id)]);
    if (newArrival) {
      const plan = await planOf(client, row.rate_plan_id);
      const departure = addDays(newArrival, nights.length);
      await run(client, "DELETE FROM stay_nights WHERE stay_id = $1", [stayId]);
      await insertNights(client, stayId, room.id, priceNights(planPrices(plan), newArrival, departure, row.guests));
      await run(client, "UPDATE stays SET arrival = $2, departure = $3 WHERE id = $1", [stayId, newArrival, departure]);
    } else {
      await run(client, "UPDATE stay_nights SET room_id = $3 WHERE stay_id = $1 AND night = ANY($2::date[])", [stayId, moving, room.id]);
    }
    if (inHouse && leaving) {
      await run(client, "UPDATE rooms SET status = 'dirty' WHERE id = $1", [leaving.room_id]);
    }
    await run(client, "UPDATE stays SET version = version + 1 WHERE id = $1", [stayId]);
    await emit(client, hotelId, { type: "stay", stayId, roomId: room.id, notice: notices.moved(row.guest_name, room.number) }, [...touched]);
  });
  return ok(await loadStay(database(), hotelId, stayId));
}

/** The night of a stay whose room check-in (first) or check-out (last) concerns. */
async function edgeNight(client: Queryable, stayId: string, which: "first" | "last"): Promise<NightRow> {
  const nights = await nightRows(client, stayId);
  return which === "first" ? nights[0] as NightRow : nights[nights.length - 1] as NightRow;
}

const ACTION_FOR: Record<"check-in" | "check-out" | "cancel", StayAction> = { "check-in": "check_in", "check-out": "check_out", cancel: "cancel" };

export async function changeStayStatus(hotelId: string, stayId: string, verb: "check-in" | "check-out" | "cancel"): Promise<Reply> {
  await atomic(async (client) => {
    const { hotel, row } = await lockStay(client, hotelId, stayId);
    const action = ACTION_FOR[verb];
    const room = await edgeNight(client, stayId, verb === "check-out" ? "last" : "first");
    const roomRecord = await roomOf(client, room.room_id);
    const result = transition(action, {
      status: row.status, arrival: row.arrival, departure: row.departure, businessDate: hotel.businessDate,
      roomNumber: room.room_number, roomStatus: roomRecord.status,
    });
    if ("refusal" in result) throw fail.conflict(result.refusal);
    const full = await stayView(client, hotel, row);
    await run(client, "UPDATE stays SET status = $2, version = version + 1 WHERE id = $1", [stayId, result.to]);
    if (row.link_state === "sent") await run(client, "UPDATE stays SET link_state = 'ended' WHERE id = $1", [stayId]);
    let notice: string;
    if (verb === "check-in") {
      await run(client, "UPDATE stays SET checked_in_night = $2 WHERE id = $1", [stayId, nightOf(hotelNow(hotel.clockNow), hotel.timeZone)]);
      notice = notices.checkedIn(row.guest_name, room.room_number);
    } else if (verb === "check-out") {
      await run(client, "UPDATE rooms SET status = 'dirty' WHERE id = $1", [room.room_id]);
      notice = notices.checkedOut(row.guest_name, room.room_number);
    } else {
      const fee = full.cancellation?.feeCents ?? 0;
      await run(client, "UPDATE stay_nights SET holds = false WHERE stay_id = $1", [stayId]);
      if (fee > 0) await postCharge(client, hotelId, stayId, hotel.businessDate, "Late cancellation fee", fee, room.room_number);
      notice = notices.cancelled(row.guest_name, fee);
    }
    await emit(client, hotelId, { type: "stay", stayId, roomId: room.room_id, notice }, [room.room_id]);
  });
  return ok(await loadStay(database(), hotelId, stayId));
}

export async function resendLink(hotelId: string, stayId: string, origin: string): Promise<Reply> {
  await atomic(async (client) => {
    const { hotel, row } = await lockStay(client, hotelId, stayId);
    if (row.status !== "booked" || row.checked_in_online) throw fail.conflict(NOT_WAITING);
    const token = newLinkToken();
    const sent = await trySendLink(client, hotel, stayId, row.guest_email, token, origin);
    if (!sent) throw fail.unavailable(notices.linkNotSent);
    await run(client, "UPDATE stays SET version = version + 1 WHERE id = $1", [stayId]);
    await emit(client, hotelId, { type: "stay", stayId, notice: notices.linkSent(row.guest_name) });
  });
  return ok(await loadStay(database(), hotelId, stayId));
}

export async function stayDetail(hotelId: string, stayId: string): Promise<Reply> {
  const stay: Stay | undefined = await loadStay(database(), hotelId, stayId);
  if (!stay) throw fail.notFound();
  return ok(stay);
}

