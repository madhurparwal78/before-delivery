// Demo locator, slots, bookings and the demo credit (brief: Locations, demo days and demo credit).
import { pool, transaction, type Db } from "../db.ts";
import { ApiError, assertValid, invalid, type Fields } from "../errors.ts";
import { addSeconds, iso, now, parseIsoUtc, SECONDS } from "../clock.ts";
import type { Role, User } from "../http.ts";
import { slotLabel } from "../zones.ts";
import { isRowId } from "../patterns.ts";
import { demoBooked } from "./notices.ts";

const EARTH_RADIUS_KM = 6371.0;
const DEFAULT_RADIUS_KM = 100;
const MAX_RADIUS_KM = 500;
const DEMO_CREDIT_CENTS = 20000;
const MAX_CAPACITY = 20;

type BookingStatus = "booked" | "cancelled" | "attended";
/** The booking transition table; the time edges are checked beside each move. */
const BOOKING_TRANSITIONS = {
  cancel: { from: "booked", to: "cancelled" },
  attend: { from: "booked", to: "attended" },
} as const satisfies Record<string, { from: BookingStatus; to: BookingStatus }>;

interface LocationRow {
  id: number;
  name: string;
  city: string;
  country: string;
  timezone: string;
  opening_hours: string;
  lat: string;
  lon: string;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Rounds the shortest decimal form of a distance half up to one decimal place. */
function oneDecimalHalfUp(value: number): number {
  const text = String(value);
  if (text.includes("e")) return 0;
  const [whole = "0", fraction = ""] = text.split(".");
  const tenths = Number(whole) * 10 + Number(fraction[0] ?? "0") + (Number(fraction[1] ?? "0") >= 5 ? 1 : 0);
  return tenths / 10;
}

function coordinate(raw: string | null, limit: number): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

export async function searchLocations(db: Db, query: URLSearchParams): Promise<object[]> {
  const fields: Fields = {};
  const hasPoint = query.has("lat") || query.has("lon");
  const lat = coordinate(query.get("lat"), 90);
  const lon = coordinate(query.get("lon"), 180);
  if (hasPoint && lat === null) fields.lat = "Enter a valid coordinate.";
  if (hasPoint && lon === null) fields.lon = "Enter a valid coordinate.";
  const radiusRaw = query.get("radius_km");
  const radius = radiusRaw === null ? DEFAULT_RADIUS_KM : /^\d{1,3}$/.test(radiusRaw) ? Number(radiusRaw) : 0;
  if (radius < 1 || radius > MAX_RADIUS_KM) fields.radius_km = "Choose a radius up to 500 km.";
  assertValid(fields);
  const country = query.get("country");
  const rows = (await db.query<LocationRow>("SELECT * FROM locations ORDER BY id")).rows.filter((l) => !country || l.country === country);
  const view = (l: LocationRow, distance: number | null) => ({
    id: l.id, name: l.name, city: l.city, country: l.country, timezone: l.timezone, opening_hours: l.opening_hours,
    lat: Number(l.lat), lon: Number(l.lon), distance_km: distance,
  });
  const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (!hasPoint) return rows.map((l) => view(l, null)).sort(byName);
  return rows
    .map((l) => view(l, oneDecimalHalfUp(haversineKm(lat as number, lon as number, Number(l.lat), Number(l.lon)))))
    .filter((l) => (l.distance_km as number) <= radius)
    .sort((a, b) => (a.distance_km as number) - (b.distance_km as number) || byName(a, b));
}

interface SlotRow {
  id: number;
  location_id: number;
  starts_at: Date;
  ends_at: Date;
  capacity: number;
  taken: number;
  timezone: string;
  location_name: string;
}

const SLOT_SELECT = `SELECT s.id, s.location_id, s.starts_at, s.ends_at, s.capacity, l.timezone, l.name AS location_name,
  (SELECT count(*)::int FROM bookings b WHERE b.slot_id = s.id AND b.status IN ('booked', 'attended')) AS taken
  FROM slots s JOIN locations l ON l.id = s.location_id`;

function slotView(s: SlotRow) {
  return {
    id: s.id, location_id: s.location_id, starts_at: iso(s.starts_at), ends_at: iso(s.ends_at), capacity: s.capacity,
    seats_left: Math.max(0, s.capacity - s.taken), timezone: s.timezone, label: slotLabel(s.starts_at, s.ends_at, s.timezone),
  };
}

async function locationExists(db: Db, id: string): Promise<number> {
  const found = /^\d{1,9}$/.test(id) ? (await db.query<{ id: number }>("SELECT id FROM locations WHERE id = $1", [id])).rows[0] : undefined;
  if (!found) throw new ApiError("not_found");
  return found.id;
}

export async function upcomingSlots(db: Db, locationId: string): Promise<object[]> {
  const id = await locationExists(db, locationId);
  const { rows } = await db.query<SlotRow>(`${SLOT_SELECT} WHERE s.location_id = $1 AND s.starts_at > $2 ORDER BY s.starts_at, s.id`, [id, now()]);
  return rows.map(slotView);
}

export async function addSlot(locationId: string, body: Record<string, unknown>): Promise<object> {
  const id = await locationExists(pool, locationId);
  const fields: Fields = {};
  const starts = parseIsoUtc(body.starts_at);
  const ends = parseIsoUtc(body.ends_at);
  if (!starts || !(starts > now())) fields.starts_at = "Choose a start after now.";
  if (!ends || (starts && !(ends > starts))) fields.ends_at = "Choose an end after the start.";
  const capacity = body.capacity;
  if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) fields.capacity = "Choose 1 to 20 seats.";
  assertValid(fields);
  return transaction(async (tx) => {
    const { rows } = await tx.query<{ id: number }>(
      "INSERT INTO slots (location_id, starts_at, ends_at, capacity) VALUES ($1, $2, $3, $4) RETURNING id",
      [id, starts, ends, capacity],
    );
    const slot = (await tx.query<SlotRow>(`${SLOT_SELECT} WHERE s.id = $1`, [rows[0]!.id])).rows[0]!;
    return slotView(slot);
  });
}

interface BookingRow {
  id: number;
  slot_id: number;
  user_id: number;
  status: BookingStatus;
  customer_email: string;
  starts_at: Date;
  ends_at: Date;
  timezone: string;
  location_name: string;
}

const BOOKING_SELECT = `SELECT b.id, b.slot_id, b.user_id, b.status, u.email AS customer_email, s.starts_at, s.ends_at, l.timezone, l.name AS location_name
  FROM bookings b JOIN users u ON u.id = b.user_id JOIN slots s ON s.id = b.slot_id JOIN locations l ON l.id = s.location_id`;

/** `rider@example.com` → `r***@example.com`, for a dealer (brief: Shapes, Email addresses in Booking). */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return `${email.charAt(0)}***${email.slice(at)}`;
}

/** The Booking shape; a dealer sees the email masked, the booking's customer and an admin in full. */
function bookingView(b: BookingRow, viewer: Role = "customer") {
  return { id: b.id, slot_id: b.slot_id, status: b.status, customer_email: viewer === "dealer" ? maskEmail(b.customer_email) : b.customer_email };
}

/** Slot label and location name of each of a customer's bookings, for the account page. */
export async function bookingLabels(db: Db, user: User): Promise<{ id: number; label: string; location_name: string }[]> {
  const { rows } = await db.query<BookingRow>(`${BOOKING_SELECT} WHERE b.user_id = $1 ORDER BY s.starts_at, b.id`, [user.id]);
  return rows.map((b) => ({ id: b.id, label: slotLabel(b.starts_at, b.ends_at, b.timezone), location_name: b.location_name }));
}

function bookingIllegal(): ApiError {
  return new ApiError("illegal_transition", { message: "This booking cannot be changed now." });
}

export async function book(user: User, body: Record<string, unknown>): Promise<object> {
  const slotId = body.slot_id;
  if (typeof slotId !== "number" || !Number.isInteger(slotId)) throw invalid({ slot_id: "Choose a demo day." });
  if (!isRowId(slotId)) throw new ApiError("not_found");
  return transaction(async (tx) => {
    const slot = (await tx.query<SlotRow>(`${SLOT_SELECT} WHERE s.id = $1`, [slotId])).rows[0];
    if (!slot) throw new ApiError("not_found");
    await tx.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [user.id]);
    await tx.query("SELECT id FROM slots WHERE id = $1 FOR UPDATE", [slotId]);
    if (!(now() < addSeconds(slot.starts_at, -SECONDS.bookingCloses))) throw new ApiError("booking_closed");
    const overlapping = await tx.query(
      `SELECT 1 FROM bookings b JOIN slots s ON s.id = b.slot_id
       WHERE b.user_id = $1 AND b.status = 'booked' AND s.starts_at < $3 AND $2 < s.ends_at`,
      [user.id, slot.starts_at, slot.ends_at],
    );
    if (overlapping.rowCount) throw new ApiError("already_booked");
    const { rows } = await tx.query<{ taken: number }>(
      "SELECT count(*)::int AS taken FROM bookings WHERE slot_id = $1 AND status IN ('booked', 'attended')",
      [slotId],
    );
    if ((rows[0]?.taken ?? 0) >= slot.capacity) throw new ApiError("slot_full");
    const inserted = await tx.query<{ id: number }>(
      "INSERT INTO bookings (slot_id, user_id, status, created_at) VALUES ($1, $2, 'booked', $3) RETURNING id",
      [slotId, user.id, now()],
    );
    const id = inserted.rows[0]!.id;
    const booking = (await tx.query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1`, [id])).rows[0]!;
    await demoBooked(tx, user.email, id, slot.location_name, slotLabel(booking.starts_at, booking.ends_at, booking.timezone));
    return bookingView(booking);
  });
}

export async function myBookings(db: Db, user: User): Promise<object[]> {
  return (await db.query<BookingRow>(`${BOOKING_SELECT} WHERE b.user_id = $1 ORDER BY s.starts_at, b.id`, [user.id])).rows.map((b) => bookingView(b));
}

async function bookingRow(db: Db, id: string): Promise<BookingRow | undefined> {
  if (!/^\d{1,9}$/.test(id)) return undefined;
  return (await db.query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1 FOR UPDATE OF b`, [id])).rows[0];
}

export async function cancelBooking(user: User, id: string): Promise<object> {
  return transaction(async (tx) => {
    const booking = await bookingRow(tx, id);
    if (!booking || booking.user_id !== user.id) throw new ApiError("not_found");
    if (booking.status !== BOOKING_TRANSITIONS.cancel.from) throw bookingIllegal();
    if (!(now() < addSeconds(booking.starts_at, -SECONDS.bookingCancelEnds))) throw new ApiError("too_late");
    await tx.query("UPDATE bookings SET status = $2 WHERE id = $1", [booking.id, BOOKING_TRANSITIONS.cancel.to]);
    return bookingView({ ...booking, status: BOOKING_TRANSITIONS.cancel.to });
  });
}

/** Marks attendance once the slot has started; the first attendance ever grants the demo credit. */
export async function markAttended(staff: User, id: string): Promise<object> {
  return transaction(async (tx) => {
    const booking = await bookingRow(tx, id);
    if (!booking) throw new ApiError("not_found");
    if (booking.status !== BOOKING_TRANSITIONS.attend.from) throw bookingIllegal();
    if (now() < booking.starts_at) throw new ApiError("not_started");
    await tx.query("UPDATE bookings SET status = $2 WHERE id = $1", [booking.id, BOOKING_TRANSITIONS.attend.to]);
    await tx.query(
      "INSERT INTO demo_credits (user_id, amount_cents, expires_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING",
      [booking.user_id, DEMO_CREDIT_CENTS, addSeconds(now(), SECONDS.demoCreditValid)],
    );
    return bookingView({ ...booking, status: BOOKING_TRANSITIONS.attend.to }, staff.role);
  });
}

export async function locationBookings(db: Db, staff: User, locationId: string): Promise<object[]> {
  const id = await locationExists(db, locationId);
  return (await db.query<BookingRow>(`${BOOKING_SELECT} WHERE s.location_id = $1 ORDER BY s.starts_at, b.id`, [id])).rows.map((b) => bookingView(b, staff.role));
}

export async function upcomingEvents(db: Db): Promise<object[]> {
  const today = iso(now()).slice(0, 10);
  const { rows } = await db.query<{ id: number; title: string; location_id: number; location_name: string; city: string; starts_on: string; ends_on: string }>(
    `SELECT e.id, e.title, e.location_id, l.name AS location_name, l.city, e.starts_on, e.ends_on
     FROM events e JOIN locations l ON l.id = e.location_id WHERE e.ends_on >= $1 ORDER BY e.starts_on, e.id`,
    [today],
  );
  return rows.map(({ id, title, location_id, location_name, city, starts_on, ends_on }) => ({ id, title, location_id, location_name, city, starts_on, ends_on }));
}
