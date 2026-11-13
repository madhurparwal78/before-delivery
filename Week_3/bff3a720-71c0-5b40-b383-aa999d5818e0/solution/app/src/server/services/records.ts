import { isoBrussels } from "../../shared/time";
import { crc32, deflateSync } from "node:zlib";
import type { BookingMode, IdState, RideState, Role } from "../../shared/api";
import { assignSeats } from "../../shared/seats";
import { isCity, type City } from "../../shared/towns";
import { now } from "../clock";
import { newId, type TxHandle } from "../db";
import { apiErrors } from "../http/errors";
import { isInt, isRecord, isString } from "../http/guards";
import { putObject, StorageUnavailable } from "../s3";
import { setRequestDeadline } from "../valkey";
import { deadlineOf, seatMapOf, getMemberRow, loadBooking, loadRide, type BookingRow, type MemberRow, type RideRecord } from "./views";
import { EMAIL_PATTERN, createSession, normaliseEmail } from "./auth";
import { refundAtPercent } from "../domain/refunds";
import { spanPriceCents, tripLabel } from "./bookings";
import { recordCompletion, recordDriverCancellation, recordPassengerCancellation, recordPayment, recordTopUp } from "./ledger";
import { insertRide } from "./rides";
import { settleRatings } from "./ratings";

interface MemberSpec { key: string; display_name: string; email: string; roles: Role[]; id_state: IdState; wallet_cents: number; photo: boolean }
interface VehicleSpec { key: string; owner: string; make_model: string; colour: string; seats: number }
interface RideSpec { key: string; driver: string; vehicle: string; stops: string[]; departure: string; seats: number; price_cents: number; booking_mode: BookingMode; state: RideState }
interface BookingSpec { key: string; ride: string; passenger: string; boarding: string; alighting: string; seats: number; state: string; created_at?: string; refund_percent?: number }
interface MessageSpec { booking: string; author: string; body: string; sent_at?: string }
interface RatingSpec { booking: string; by: string; stars: number; comment?: string }

export interface RecordsSpec {
  members?: MemberSpec[];
  vehicles?: VehicleSpec[];
  rides?: RideSpec[];
  bookings?: BookingSpec[];
  messages?: MessageSpec[];
  ratings?: RatingSpec[];
}

interface RecordsResult {
  now: string;
  members: Record<string, { id: string; session: string }>;
  vehicles: Record<string, string>;
  rides: Record<string, string>;
  bookings: Record<string, string>;
}

const ROLE_SETS: Role[][] = [["driver"], ["passenger"], ["driver", "passenger"], ["founder"]];
const ID_STATES: IdState[] = ["none", "pending", "verified", "rejected"];
const RIDE_STATES: RideState[] = ["published", "changed", "departed", "arrived", "cancelled"];
const BOOKING_STATES = ["held", "requested", "confirmed", "completed", "cancelled_by_passenger", "cancelled_by_driver"] as const;
type SetupBookingState = (typeof BOOKING_STATES)[number];


function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** A small valid PNG (an 8×8 grey square) for generated photos and ID documents. */
function smallPng(shade: number): Buffer {
  const size = 8;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 0, 0, 0, 0], 8);
  const rows = Buffer.concat(Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(size, shade)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

async function storeGenerated(db: TxHandle, memberId: string, kind: "photo" | "id_document", shade: number): Promise<string | null> {
  const fileId = newId();
  const key = `${kind === "photo" ? "photos" : "id-documents"}/${memberId}/${fileId}`;
  const data = smallPng(shade);
  try {
    await putObject(key, data, "image/png");
  } catch (error) {
    if (error instanceof StorageUnavailable) return null;
    throw error;
  }
  await db.query("INSERT INTO files (id, owner_id, kind, object_key, content_type, size_bytes, created_at) VALUES ($1, $2, $3, $4, 'image/png', $5, $6)", [fileId, memberId, kind, key, data.length, now()]);
  return fileId;
}

function invalid(field: string): never {
  throw apiErrors.validation({ [field]: "This value is not valid." });
}

function list(spec: unknown, field: string): Record<string, unknown>[] {
  if (spec === undefined) return [];
  if (!Array.isArray(spec) || !spec.every(isRecord)) return invalid(field);
  return spec;
}

function at(value: unknown, field: string): Date {
  if (value === undefined) return now();
  if (!isString(value) || Number.isNaN(Date.parse(value))) return invalid(field);
  return new Date(Date.parse(value));
}

/** Create members, cars, rides, bookings, messages and ratings in one transaction; anything invalid creates nothing. */
export async function createRecords(db: TxHandle, raw: unknown, options: { sessions: boolean }): Promise<RecordsResult> {
  if (!isRecord(raw)) return invalid("body");
  const result: RecordsResult = { now: "", members: {}, vehicles: {}, rides: {}, bookings: {} };
  const rows = new Map<string, MemberRow>();
  const rideRecords = new Map<string, RideRecord>();
  const bookingRows = new Map<string, BookingRow>();
  const seenEmails = new Set<string>();

  for (const spec of list(raw.members, "members")) {
    const { key, display_name: name, email: rawEmail, roles, id_state: idState, wallet_cents: wallet, photo } = spec;
    if (!isString(key) || rows.has(key) || !isString(name) || name.trim().length < 1 || name.length > 60) return invalid("members");
    if (!isString(rawEmail) || !EMAIL_PATTERN.test(rawEmail.trim())) return invalid("members");
    const email = normaliseEmail(rawEmail);
    const taken = await db.query("SELECT 1 FROM members WHERE email = $1", [email]);
    if (taken.rows.length || seenEmails.has(email)) return invalid("members");
    seenEmails.add(email);
    const roleList = Array.isArray(roles) ? (roles as Role[]) : [];
    const allowed = ROLE_SETS.some((set) => set.length === roleList.length && set.every((role) => roleList.includes(role)));
    if (!allowed || !ID_STATES.includes(idState as IdState) || !isInt(wallet) || wallet < 0) return invalid("members");
    const id = newId();
    await db.query("INSERT INTO members (id, email, display_name, roles, id_state, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [id, email, name.trim(), roleList, idState, now()]);
    const session = options.sessions ? await createSession(db, id) : "";
    if (wallet > 0) await recordTopUp(db, id, wallet, now());
    if (photo === true) {
      const fileId = await storeGenerated(db, id, "photo", 200);
      if (fileId) await db.query("UPDATE members SET photo_file_id = $2 WHERE id = $1", [id, fileId]);
    }
    if (idState === "pending" || idState === "rejected") {
      const fileId = await storeGenerated(db, id, "id_document", 120);
      if (fileId) {
        const reason = idState === "rejected" ? "The document could not be read." : null;
        await db.query("INSERT INTO id_documents (id, member_id, file_id, state, reason, uploaded_at) VALUES ($1, $2, $3, $4, $5, $6)", [newId(), id, fileId, idState, reason, now()]);
        if (reason) await db.query("UPDATE members SET id_reason = $2 WHERE id = $1", [id, reason]);
      }
    }
    rows.set(key, (await getMemberRow(db, id)) as MemberRow);
    result.members[key] = { id, session };
  }

  const memberOf = (key: unknown): MemberRow => {
    const found = isString(key) ? rows.get(key) : undefined;
    return found ?? invalid("members");
  };

  const cars = new Map<string, { id: string; owner: string; seats: number }>();
  for (const spec of list(raw.vehicles, "vehicles")) {
    const { key, make_model: makeModel, colour, seats } = spec;
    if (!isString(key) || cars.has(key) || !isString(makeModel) || !isString(colour) || !isInt(seats) || seats < 1 || seats > 4) return invalid("vehicles");
    const owner = memberOf(spec.owner);
    const id = newId();
    await db.query("INSERT INTO vehicles (id, owner_id, make_model, colour, seats, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [id, owner.id, makeModel, colour, seats, now()]);
    cars.set(key, { id, owner: owner.id, seats });
    result.vehicles[key] = id;
  }

  for (const spec of list(raw.rides, "rides")) {
    const { key, stops, seats, price_cents: price, booking_mode: mode, state } = spec;
    if (!isString(key) || rideRecords.has(key) || !Array.isArray(stops) || !stops.every(isCity) || new Set(stops).size !== stops.length || stops.length < 2) return invalid("rides");
    const driver = memberOf(spec.driver);
    const car = isString(spec.vehicle) ? cars.get(spec.vehicle) : undefined;
    if (!car || car.owner !== driver.id || !isInt(seats) || seats < 1 || seats > car.seats || !isInt(price) || price < 0) return invalid("rides");
    if ((mode !== "instant" && mode !== "request") || !RIDE_STATES.includes(state as RideState)) return invalid("rides");
    const departure = at(spec.departure, "rides");
    const record = await insertRide(db, { driverId: driver.id, vehicleId: car.id, cities: stops as City[], departure, seats, priceCents: price, bookingMode: mode }, state as RideState);
    rideRecords.set(key, record);
    result.rides[key] = record.row.id;
  }

  for (const spec of list(raw.bookings, "bookings")) {
    const { key, seats, state } = spec;
    if (!isString(key) || bookingRows.has(key) || !isInt(seats) || seats < 1 || seats > 4 || !BOOKING_STATES.includes(state as SetupBookingState)) return invalid("bookings");
    const ride = isString(spec.ride) ? rideRecords.get(spec.ride) : undefined;
    if (!ride) return invalid("bookings");
    const passenger = memberOf(spec.passenger);
    const boardingIndex = ride.route.cities.indexOf(spec.boarding as City);
    const alightingIndex = ride.route.cities.indexOf(spec.alighting as City);
    if (boardingIndex < 0 || alightingIndex <= boardingIndex) return invalid("bookings");
    const created = at(spec.created_at, "bookings");
    const span = { boardingIndex, alightingIndex, seats };
    const free = assignSeats(await seatMapOf(db, ride, created), boardingIndex, alightingIndex, seats);
    if (!free) return invalid("bookings");
    const bookingState = state as SetupBookingState;
    const id = newId();
    const price = spanPriceCents(ride, span);
    await db.query(
      `INSERT INTO bookings (id, ride_id, passenger_id, boarding_index, alighting_index, seats, seat_numbers, price_cents, state, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, ride.row.id, passenger.id, boardingIndex, alightingIndex, seats, free, price, bookingState, created],
    );
    const request = ride.row.booking_mode === "request";
    const trail: string[] = [request ? "requested" : "held"];
    if (bookingState !== "held" && bookingState !== "requested") trail.push(...(request ? ["accepted"] : []), "confirmed");
    if (bookingState === "completed" || bookingState === "cancelled_by_passenger" || bookingState === "cancelled_by_driver") trail.push(bookingState);
    for (const step of trail) await db.query("INSERT INTO booking_history (booking_id, state, at) VALUES ($1, $2, $3)", [id, step, created]);
    const booking = (await loadBooking(db, id)) as BookingRow;
    const label = tripLabel(ride, booking);
    if (bookingState !== "held") await recordPayment(db, id, passenger.id, price, `${request ? "Seat requested" : "Seat booked"}: ${label}`, created);
    if (bookingState === "requested") {
      const deadline = deadlineOf(ride, booking);
      db.afterCommit(() => setRequestDeadline(id, deadline.getTime()));
    }
    if (bookingState === "completed") await recordCompletion(db, id, ride.row.driver_id, price, created);
    if (bookingState === "cancelled_by_driver") await recordDriverCancellation(db, id, passenger.id, ride.row.driver_id, price, `Refund 100%: ${label}`, created);
    if (bookingState === "cancelled_by_passenger") {
      const percent = spec.refund_percent;
      if (percent !== 0 && percent !== 50 && percent !== 100) return invalid("bookings");
      await recordPassengerCancellation(db, id, passenger.id, ride.row.driver_id, price, refundAtPercent(price, percent), `Refund ${percent}%: ${label}`, created);
    }
    bookingRows.set(key, booking);
    result.bookings[key] = id;
  }

  for (const spec of list(raw.messages, "messages")) {
    const booking = isString(spec.booking) ? bookingRows.get(spec.booking) : undefined;
    if (!booking || !isString(spec.body) || spec.body.length < 1 || spec.body.length > 1000) return invalid("messages");
    await db.query("INSERT INTO messages (id, booking_id, author_id, body, sent_at) VALUES ($1, $2, $3, $4, $5)", [newId(), booking.id, memberOf(spec.author).id, spec.body, at(spec.sent_at, "messages")]);
  }

  const given = new Set<string>();
  for (const spec of list(raw.ratings, "ratings")) {
    const booking = isString(spec.booking) ? bookingRows.get(spec.booking) : undefined;
    if (!booking || !isInt(spec.stars) || spec.stars < 1 || spec.stars > 5) return invalid("ratings");
    const comment = spec.comment === undefined ? "" : spec.comment;
    if (!isString(comment) || comment.length > 280) return invalid("ratings");
    await db.query("INSERT INTO ratings (id, booking_id, by_member_id, stars, comment, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [newId(), booking.id, memberOf(spec.by).id, spec.stars, comment, now()]);
    given.add(booking.id);
  }
  for (const bookingId of given) {
    const booking = (await loadBooking(db, bookingId)) as BookingRow;
    if (booking.state === "completed") await settleRatings(db, (await loadRide(db, booking.ride_id)) as RideRecord, booking);
  }

  result.now = isoBrussels(now());
  return result;
}
