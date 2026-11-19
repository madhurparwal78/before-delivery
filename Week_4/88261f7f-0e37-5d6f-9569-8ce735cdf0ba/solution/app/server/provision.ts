import type { PoolClient } from "pg";
import type { Role, StayStatus } from "../shared/api";
import { isIsoDate } from "../shared/dates";
import { parsePercentHundredths } from "../shared/money";
import { hashPassword } from "./auth";
import { config } from "./config";
import { isTimeZone, nightOf } from "./clock";
import { inserted, isUniqueViolation, run, type Row } from "./db";
import { fail, isObject, type JsonObject } from "./http";
import type { HotelRecord } from "./hotel";
import { newLinkToken } from "./mailLink";
import type { PlanPrices } from "./rules/pricing";
import { ROOM_STATUSES } from "./rules/roomStatus";
import { insertNights, priceNights, trySendLink } from "./stays";

const ROLES: readonly Role[] = ["owner", "front_desk", "housekeeper"];
const STAY_STATUSES: readonly StayStatus[] = ["booked", "in_house", "checked_out", "cancelled", "no_show"];
const DEFAULT_PLANS = [
  { key: "Flexible", name: "Flexible", weeknightCents: 12000, weekendCents: 15000 },
  { key: "Corporate", name: "Corporate", weeknightCents: 12040, weekendCents: 12040 },
];
const DEFAULT_TAX_HUNDREDTHS = 875;

interface Provisioned {
  hotelId: string;
  users: Record<string, string>;
  rooms: Record<string, string>;
  ratePlans: Record<string, string>;
  guests: Record<string, string>;
  stays: Record<string, string>;
  folios: Record<string, string>;
  entries: Record<string, string>;
}

const refuse = (message: string) => fail.invalid({ setup: message });
const list = (value: unknown): JsonObject[] => (Array.isArray(value) ? value.filter(isObject) : []);
const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

function required(row: JsonObject, name: string, where: string): string {
  const value = row[name];
  if (typeof value !== "string" || value === "") throw refuse(`${where} needs ${name}.`);
  return value;
}

function lookup(map: Record<string, string>, key: unknown, where: string): string {
  const found = typeof key === "string" ? map[key] : undefined;
  if (!found) throw refuse(`${where} names an unknown key.`);
  return found;
}

/** Inserts a row and gives back its id. */
async function insertId(client: PoolClient, sql: string, values: unknown[]): Promise<string> {
  return (await inserted<Row & { id: string }>(client, `${sql} RETURNING id`, values)).id;
}

interface PlanOnFile extends PlanPrices { id: string }

async function addUsers(client: PoolClient, hotelId: string, users: JsonObject[], ids: Provisioned): Promise<void> {
  for (const user of users) {
    const role = ROLES.find((candidate) => candidate === user.role);
    if (!role) throw refuse("user needs a role.");
    try {
      ids.users[required(user, "key", "user")] = await insertId(
        client, "INSERT INTO users (hotel_id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)",
        [hotelId, required(user, "email", "user"), required(user, "name", "user"), role, await hashPassword(required(user, "password", "user"))]);
    } catch (failure) {
      if (isUniqueViolation(failure)) throw refuse("user email is already taken.");
      throw failure;
    }
  }
}

async function addRatePlans(client: PoolClient, hotelId: string, spec: JsonObject, ids: Provisioned): Promise<Map<string, PlanOnFile>> {
  const plans = new Map<string, PlanOnFile>();
  for (const plan of Array.isArray(spec.ratePlans) ? list(spec.ratePlans) : DEFAULT_PLANS) {
    const { weeknightCents, weekendCents } = plan;
    if (typeof weeknightCents !== "number" || typeof weekendCents !== "number") throw refuse("rate plan needs prices.");
    const id = await insertId(
      client, "INSERT INTO rate_plans (hotel_id, name, weeknight_cents, weekend_cents) VALUES ($1, $2, $3, $4)",
      [hotelId, required(plan, "name", "rate plan"), weeknightCents, weekendCents]);
    const key = required(plan, "key", "rate plan");
    ids.ratePlans[key] = id;
    plans.set(key, { id, weeknightCents, weekendCents });
  }
  return plans;
}

async function addStays(client: PoolClient, hotel: HotelRecord, spec: JsonObject, plans: Map<string, PlanOnFile>, ids: Provisioned, origin: string): Promise<void> {
  for (const stay of list(spec.stays)) {
    const status = STAY_STATUSES.find((candidate) => candidate === (stay.status ?? "booked"));
    if (!status || !isIsoDate(stay.arrival) || !isIsoDate(stay.departure) || stay.departure <= stay.arrival) throw refuse("stay needs a status and dates.");
    const roomId = lookup(ids.rooms, stay.room, "stay");
    const guestId = lookup(ids.guests, stay.guest, "stay");
    const plan = plans.get(text(stay.ratePlan));
    if (!plan) throw refuse("stay names an unknown rate plan.");
    const guests = typeof stay.guests === "number" ? stay.guests : 1;
    const token = stay.checkinLink === true ? newLinkToken() : null;
    const checkedIn = status === "in_house" || status === "checked_out" ? stay.arrival : null;
    const stayId = await insertId(
      client,
      `INSERT INTO stays (hotel_id, guest_id, rate_plan_id, guests, arrival, departure, status, checked_in_night, link_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [hotel.id, guestId, plan.id, guests, stay.arrival, stay.departure, status, checkedIn, token]);
    ids.stays[required(stay, "key", "stay")] = stayId;
    await insertNights(client, stayId, roomId, priceNights(plan, stay.arrival, stay.departure, guests));
    if (status === "cancelled" || status === "no_show") await run(client, "UPDATE stay_nights SET holds = false WHERE stay_id = $1", [stayId]);
    if (token) {
      const guest = await inserted<Row & { email: string }>(client, "SELECT email FROM guests WHERE id = $1", [guestId]);
      await trySendLink(client, hotel, stayId, guest.email, token, origin);
    }
  }
}

async function addFolios(client: PoolClient, hotelId: string, spec: JsonObject, ids: Provisioned): Promise<void> {
  const listed = new Set(list(spec.folios).map((folio) => folio.stay));
  for (const [key, stayId] of Object.entries(ids.stays)) {
    if (listed.has(key)) continue;
    await run(
      client,
      `INSERT INTO folios (hotel_id, stay_id, name, payer_name, payer_email)
       SELECT $1, s.id, 'Folio A', g.name, g.email FROM stays s JOIN guests g ON g.id = s.guest_id WHERE s.id = $2`,
      [hotelId, stayId]);
  }
  for (const folio of list(spec.folios)) {
    const folioId = await insertId(
      client, "INSERT INTO folios (hotel_id, stay_id, name, payer_name, payer_email) VALUES ($1, $2, $3, $4, $5)",
      [hotelId, lookup(ids.stays, folio.stay, "folio"), required(folio, "name", "folio"), required(folio, "payerName", "folio"), text(folio.payerEmail)]);
    ids.folios[required(folio, "key", "folio")] = folioId;
    for (const entry of list(folio.entries)) {
      if (!isIsoDate(entry.date) || typeof entry.amountCents !== "number") throw refuse("entry needs a date and an amount.");
      ids.entries[required(entry, "key", "entry")] = await insertId(
        client, "INSERT INTO entries (folio_id, kind, date, description, amount_cents, room_number) VALUES ($1, $2, $3, $4, $5, $6)",
        [folioId, entry.kind === "payment" ? "payment" : "charge", entry.date, required(entry, "description", "entry"), entry.amountCents, typeof entry.roomNumber === "string" ? entry.roomNumber : null]);
    }
  }
}

/** Creates one hotel with everything in its description; any unknown key, overlap or bad value refuses the whole setup. */
export async function provisionHotel(client: PoolClient, spec: JsonObject, origin: string): Promise<Provisioned> {
  const hotelSpec = isObject(spec.hotel) ? spec.hotel : {};
  const name = required(hotelSpec, "name", "hotel");
  const timeZone = text(hotelSpec.timeZone, config.defaultTimeZone);
  if (!isTimeZone(timeZone)) throw refuse("hotel timeZone is not a time zone.");
  const clockNow = typeof hotelSpec.now === "string" ? new Date(hotelSpec.now) : null;
  if (clockNow && Number.isNaN(clockNow.getTime())) throw refuse("hotel now is not a moment.");
  const named = hotelSpec.businessDate;
  if (named !== undefined && named !== null && !isIsoDate(named)) throw refuse("hotel businessDate is not a date.");
  const businessDate = isIsoDate(named) ? named : nightOf(clockNow ?? new Date(), timeZone);
  const hotelId = await insertId(client, "INSERT INTO hotels (name, time_zone, business_date, clock_now) VALUES ($1, $2, $3, $4)", [name, timeZone, businessDate, clockNow]);
  const ids: Provisioned = { hotelId, users: {}, rooms: {}, ratePlans: {}, guests: {}, stays: {}, folios: {}, entries: {} };

  await addUsers(client, hotelId, list(spec.users), ids);
  for (const room of list(spec.rooms)) {
    const status = ROOM_STATUSES.find((candidate) => candidate === (room.status ?? "clean"));
    if (!status) throw refuse("room status is not a status.");
    ids.rooms[required(room, "key", "room")] = await insertId(
      client, "INSERT INTO rooms (hotel_id, number, type, status) VALUES ($1, $2, $3, $4)",
      [hotelId, required(room, "number", "room"), required(room, "type", "room"), status]);
  }
  const plans = await addRatePlans(client, hotelId, spec, ids);
  await run(client, "INSERT INTO tax_rates (hotel_id, hundredths, start_date) VALUES ($1, $2, NULL)", [hotelId, DEFAULT_TAX_HUNDREDTHS]);
  for (const rate of list(spec.taxRates)) {
    const hundredths = parsePercentHundredths(text(rate.percent));
    if (hundredths === null || !isIsoDate(rate.startDate)) throw refuse("tax rate needs a percent and a start date.");
    await run(client, "INSERT INTO tax_rates (hotel_id, hundredths, start_date) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [hotelId, hundredths, rate.startDate]);
  }
  for (const guest of list(spec.guests)) {
    ids.guests[required(guest, "key", "guest")] = await insertId(
      client, "INSERT INTO guests (hotel_id, name, email, phone, company, address) VALUES ($1, $2, $3, $4, $5, $6)",
      [hotelId, required(guest, "name", "guest"), text(guest.email), text(guest.phone), text(guest.company), text(guest.address)]);
  }
  await addStays(client, { id: hotelId, name, timeZone, businessDate, clockNow }, spec, plans, ids, origin);
  await addFolios(client, hotelId, spec, ids);
  return ids;
}
