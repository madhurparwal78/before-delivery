import type {
  Booking,
  BookingStatus,
  Charge,
  CoordinatorHolder,
  Holder,
  InvoiceLine,
  Material,
  OpenCallStatus,
  Rotation,
  Setting,
  SessionUser,
  SyncStatus,
} from "../shared/api.js";
import { type Db, rows } from "./db.js";
import { isoAt } from "./agency.js";
import { type Credential, isQualified } from "./rules/qualification.js";
import { type PlanHolder, type RotationPlan, planRotation } from "./rules/rotation.js";
import { openCallStatus } from "./rules/openCall.js";
import { type Phase, bookingStatus } from "./rules/status.js";

export interface BookingRow {
  id: number;
  ref: string;
  org_id: string;
  org_name: string;
  requester_id: string;
  requester_name: string;
  requester_email: string;
  setting: Setting;
  title: string;
  location: string;
  onsite_contact_name: string;
  onsite_contact_phone: string;
  consumer_name: string;
  requester_notes: string;
  start_at: Date;
  end_at: Date;
  start_date: string;
  duration_minutes: number;
  seat_count: number;
  phase: Phase;
  open_call_posted_at: Date | null;
  open_call_closes_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  rotation_interval_minutes: number;
}

export interface SeatRow {
  booking_id: number;
  seat: number;
  interpreter_id: string | null;
  name: string | null;
  initials: string | null;
  phone: string | null;
  email: string | null;
  home_city: string | null;
  pay_rate_cents: number | null;
}

interface CredentialRow extends Credential {
  interpreter_id: string;
}

interface MaterialRow {
  id: number;
  booking_id: number;
  name: string;
  size_bytes: number;
  content_type: string;
  sha256: string;
  uploaded_at: Date;
}

export interface LineRow {
  line_ref: string;
  booking_id: number;
  booking_ref: string;
  org_id: string;
  kind: "completed" | "late_cancellation";
  assignment_date: string;
  rate_effective_from: string;
  hourly_rate_cents: number;
  team_surcharge_bp: number;
  basis_minutes: number;
  billable_minutes: number;
  interpreter_count: number;
  time_amount_cents: number;
  mileage_miles: number;
  mileage_cents_per_mile: number;
  mileage_amount_cents: number;
  amount_cents: number;
  billing_week: string;
  kb_item_id: string | null;
  created_at: Date;
}

export interface BookingData {
  row: BookingRow;
  seats: SeatRow[];
  credentials: Map<string, Credential[]>;
  materials: MaterialRow[];
  line: LineRow | null;
}

export type Viewer = SessionUser & { credentials: Credential[] };

export const LINE_SELECT = `SELECT l.*, b.ref AS booking_ref FROM invoice_lines l JOIN bookings b ON b.id = l.booking_id`;

export async function loadBookings(db: Db, ids: number[]): Promise<BookingData[]> {
  if (ids.length === 0) return [];
  const bookingRows = await rows<BookingRow>(
    db,
    `SELECT b.*, o.name AS org_name, u.name AS requester_name, u.email AS requester_email,
            c.rotation_interval_minutes
       FROM bookings b
       JOIN organisations o ON o.id = b.org_id
       JOIN users u ON u.id = b.requester_id
       JOIN contracts c ON c.org_id = b.org_id
      WHERE b.id = ANY($1::int[])
      ORDER BY b.start_at, b.id`,
    [ids],
  );
  const seatRows = await rows<SeatRow>(
    db,
    `SELECT s.booking_id, s.seat, s.interpreter_id, u.name, i.initials, i.phone, u.email, i.home_city, i.pay_rate_cents
       FROM seats s
       LEFT JOIN users u ON u.id = s.interpreter_id
       LEFT JOIN interpreters i ON i.user_id = s.interpreter_id
      WHERE s.booking_id = ANY($1::int[])
      ORDER BY s.booking_id, s.seat`,
    [ids],
  );
  const holderIds = [...new Set(seatRows.flatMap((seat) => (seat.interpreter_id ? [seat.interpreter_id] : [])))];
  const credentialRows = holderIds.length
    ? await rows<CredentialRow>(db, "SELECT interpreter_id, code, expires_on FROM credentials WHERE interpreter_id = ANY($1::text[]) ORDER BY id", [holderIds])
    : [];
  const materialRows = await rows<MaterialRow>(
    db,
    "SELECT id, booking_id, name, size_bytes, content_type, sha256, uploaded_at FROM materials WHERE booking_id = ANY($1::int[]) ORDER BY id",
    [ids],
  );
  const lineRows = await rows<LineRow>(db, `${LINE_SELECT} WHERE l.booking_id = ANY($1::int[])`, [ids]);

  const credentials = new Map<string, Credential[]>();
  for (const credential of credentialRows) {
    const list = credentials.get(credential.interpreter_id) ?? [];
    list.push({ code: credential.code, expires_on: credential.expires_on });
    credentials.set(credential.interpreter_id, list);
  }
  return bookingRows.map((row) => ({
    row,
    seats: seatRows.filter((seat) => seat.booking_id === row.id),
    credentials,
    materials: materialRows.filter((material) => material.booking_id === row.id),
    line: lineRows.find((line) => line.booking_id === row.id) ?? null,
  }));
}

export async function loadBooking(db: Db, id: number): Promise<BookingData | null> {
  return (await loadBookings(db, [id]))[0] ?? null;
}

export const heldCount = (data: BookingData): number => data.seats.filter((seat) => seat.interpreter_id !== null).length;

export const statusOf = (data: BookingData): BookingStatus =>
  bookingStatus(data.row.phase, data.row.seat_count, heldCount(data), data.row.open_call_posted_at !== null);

export const holdsSeat = (data: BookingData, interpreterId: string): boolean =>
  data.seats.some((seat) => seat.interpreter_id === interpreterId);

export const openCallStatusOf = (row: BookingRow, nowMs: number): OpenCallStatus =>
  openCallStatus(row.open_call_closes_at?.getTime() ?? null, nowMs);

/** An interpreter is offered a booking once an open call is posted, before check-in, when qualified for it. */
export const isOffered = (data: BookingData, viewer: Viewer): boolean =>
  data.row.open_call_posted_at !== null &&
  data.row.phase === "active" &&
  isQualified(viewer.credentials, data.row.setting, data.row.start_date);

export function canView(data: BookingData, viewer: Viewer): boolean {
  switch (viewer.role) {
    case "coordinator":
    case "billing_manager":
      return true;
    case "requester":
      return data.row.org_id === viewer.org_id;
    case "interpreter":
      return holdsSeat(data, viewer.id) || isOffered(data, viewer);
  }
}

export const planOf = (data: BookingData): RotationPlan =>
  planRotation({
    startMs: data.row.start_at.getTime(),
    durationMinutes: data.row.duration_minutes,
    intervalMinutes: data.row.rotation_interval_minutes,
    holders: data.seats.map((seat): PlanHolder | null =>
      seat.interpreter_id === null ? null : { name: seat.name ?? "", initials: seat.initials ?? "" },
    ),
  });

function holderCard(seat: SeatRow, data: BookingData, viewer: Viewer): Holder | null {
  if (seat.interpreter_id === null) return null;
  const credentials = data.credentials.get(seat.interpreter_id) ?? [];
  const name = seat.name ?? "";
  const initials = seat.initials ?? "";
  const codes = credentials.map((credential) => credential.code);
  switch (viewer.role) {
    case "coordinator":
      return coordinatorCard(seat, credentials);
    case "billing_manager":
      return { id: seat.interpreter_id, name, initials, credentials: codes };
    case "requester":
      return { name, initials, credentials: codes };
    case "interpreter":
      return { name, initials, credentials: codes, is_me: seat.interpreter_id === viewer.id };
  }
}

export function coordinatorCard(
  seat: { interpreter_id: string | null; name: string | null; initials: string | null; phone: string | null; email: string | null; home_city: string | null; pay_rate_cents: number | null },
  credentials: readonly Credential[],
): CoordinatorHolder {
  return {
    id: seat.interpreter_id ?? "",
    name: seat.name ?? "",
    initials: seat.initials ?? "",
    credentials: credentials.map((credential) => ({ code: credential.code, expires_on: credential.expires_on })),
    phone: seat.phone ?? "",
    email: seat.email ?? "",
    home_city: seat.home_city ?? "",
    pay_rate_cents: seat.pay_rate_cents ?? 0,
  };
}

function rotationJson(plan: RotationPlan): Rotation {
  return {
    mode: plan.mode,
    interval_minutes: plan.intervalMinutes,
    threshold_minutes: plan.thresholdMinutes,
    coverage_text: plan.coverageText,
    turns: plan.entries.map((entry) => ({
      index: entry.index,
      kind: entry.kind,
      seat: entry.seat,
      holder_name: entry.holder?.name ?? null,
      holder_initials: entry.holder?.initials ?? null,
      start: isoAt(entry.startMs),
      end: isoAt(entry.endMs),
      label: entry.label,
    })),
  };
}

/** A line is synced only once its Kill Bill invoice item has been read back and its id stored. */
export const syncStatusOf = (line: LineRow): SyncStatus => (line.kb_item_id === null ? "pending_sync" : "synced");

export function chargeOf(line: LineRow | null): Charge | null {
  if (line === null) return null;
  return { line_ref: line.line_ref, kind: line.kind, amount_cents: line.amount_cents, sync_status: syncStatusOf(line) };
}

export function invoiceLineJson(line: LineRow, billingAmountCents: number | null): InvoiceLine {
  return {
    line_ref: line.line_ref,
    booking_id: String(line.booking_id),
    booking_ref: line.booking_ref,
    org_id: line.org_id,
    kind: line.kind,
    assignment_date: line.assignment_date,
    rate_effective_from: line.rate_effective_from,
    hourly_rate_cents: line.hourly_rate_cents,
    team_surcharge_bp: line.team_surcharge_bp,
    basis_minutes: line.basis_minutes,
    billable_minutes: line.billable_minutes,
    interpreter_count: line.interpreter_count,
    time_amount_cents: line.time_amount_cents,
    mileage_miles: line.mileage_miles,
    mileage_cents_per_mile: line.mileage_cents_per_mile,
    mileage_amount_cents: line.mileage_amount_cents,
    amount_cents: line.amount_cents,
    billing_amount_cents: billingAmountCents,
    billing_week: line.billing_week,
    sync_status: syncStatusOf(line),
    created_at: isoAt(line.created_at.getTime()),
  };
}

/** A booking as the viewer's role may see it. */
export function presentBooking(data: BookingData, viewer: Viewer, nowMs: number): Booking {
  const { row } = data;
  const plan = planOf(data);
  const sees = viewer.role !== "interpreter" || holdsSeat(data, viewer.id);
  const materials: Material[] = sees
    ? data.materials.map((material) => ({
        id: String(material.id),
        name: material.name,
        size_bytes: material.size_bytes,
        content_type: material.content_type,
        sha256: material.sha256,
        uploaded_at: isoAt(material.uploaded_at.getTime()),
      }))
    : [];
  const booking: Booking = {
    id: String(row.id),
    ref: row.ref,
    org_name: row.org_name,
    setting: row.setting,
    title: row.title,
    location: row.location,
    onsite_contact_name: row.onsite_contact_name,
    onsite_contact_phone: row.onsite_contact_phone,
    consumer_name: row.consumer_name,
    start: isoAt(row.start_at.getTime()),
    end: isoAt(row.end_at.getTime()),
    duration_minutes: row.duration_minutes,
    status: statusOf(data),
    seat_count: row.seat_count,
    open_call_status: openCallStatusOf(row, nowMs),
    open_call_closes_at: row.open_call_closes_at === null ? null : isoAt(row.open_call_closes_at.getTime()),
    coverage: plan.coverage,
    seats: data.seats.map((seat) => ({ seat: seat.seat, holder: holderCard(seat, data, viewer) })),
    rotation: rotationJson(plan),
    materials,
  };
  if (viewer.role === "coordinator" || viewer.role === "billing_manager") {
    booking.org_id = row.org_id;
    booking.created_at = isoAt(row.created_at.getTime());
  }
  if (viewer.role !== "interpreter") {
    booking.requester_name = row.requester_name;
    booking.requester_notes = row.requester_notes;
    booking.charge = chargeOf(data.line);
  }
  return booking;
}

/** The caller with the credentials the visibility rules need. */
export async function viewerOf(db: Db, user: SessionUser): Promise<Viewer> {
  const credentials =
    user.role === "interpreter"
      ? await rows<Credential>(db, "SELECT code, expires_on FROM credentials WHERE interpreter_id = $1 ORDER BY id", [user.id])
      : [];
  return { ...user, credentials };
}
