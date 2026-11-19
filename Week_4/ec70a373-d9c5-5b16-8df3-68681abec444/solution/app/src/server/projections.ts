// Every published response shape is built here, with exactly its keys at every depth.
import { rows, theRow, type Db, type pool } from "./db.ts";
import { formatWall, isoInstant } from "../shared/time.ts";
import { quartersToHours, type Quarters } from "../shared/rules.ts";
import type {
  Account,
  Actor,
  Booking,
  BookingStatus,
  DocumentContentType,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
  InspectorLink,
  LinkState,
  Movement,
  MovementKind,
  PersonRef,
  Rate,
  RateState,
} from "../shared/api.ts";

function instant(value: Date): string {
  return isoInstant(value.getTime());
}

function maybeInstant(value: Date | null): string | null {
  return value === null ? null : instant(value);
}

const hours = quartersToHours;

function maybeHours(q: Quarters | null): number | null {
  return q === null ? null : hours(q);
}

function person(id: string | null, name: string | null): PersonRef | null {
  return id === null || name === null ? null : { user_id: id, name };
}

export const BOOKING_SELECT = `
  SELECT b.*, st.name AS station_name, m.business_name
    FROM bookings b JOIN stations st ON st.id = b.station_id JOIN members m ON m.id = b.member_id`;

export interface BookingRow {
  id: string;
  tenant_id: string;
  reference: string;
  site_id: string;
  station_id: string;
  station_name: string;
  member_id: string;
  business_name: string;
  date: string;
  start_minutes: number;
  end_minutes: number;
  start_at: Date;
  end_at: Date;
  occupied_until: Date;
  quarters: number;
  status: BookingStatus;
  hold_expires_at: Date | null;
  series_id: string | null;
  refunded_quarters: number | null;
  forfeited_quarters: number | null;
  cancelled_by_id: string | null;
  cancelled_by_name: string | null;
  cancellation_reason: string | null;
  checked_in_at: Date | null;
  checked_in_by_id: string | null;
  checked_in_by_name: string | null;
  no_show_by_id: string | null;
  no_show_by_name: string | null;
  checked_out_at: Date | null;
  checked_out_by_id: string | null;
  checked_out_by_name: string | null;
  late_quarter_hours: number | null;
  pack_quarters_applied: number | null;
  overage_quarter_hours: number | null;
  overage_hourly_rate_cents: number | null;
  overage_tax_rate_percent: string | null;
  overage_subtotal_cents: number | null;
  overage_tax_cents: number | null;
  overage_total_cents: number | null;
  overage_killbill_invoice_id: string | null;
  created_at: Date;
}

export async function bookingRow(db: Db | typeof pool, id: string): Promise<BookingRow> {
  return theRow<BookingRow>(db, `${BOOKING_SELECT} WHERE b.id = $1`, [id]);
}

export function projectBooking(b: BookingRow): Booking {
  return {
    id: b.id,
    reference: b.reference,
    site_id: b.site_id,
    station_id: b.station_id,
    station_name: b.station_name,
    member_id: b.member_id,
    business_name: b.business_name,
    date: b.date,
    start: formatWall(b.start_minutes),
    end: formatWall(b.end_minutes),
    start_at: instant(b.start_at),
    end_at: instant(b.end_at),
    hours: hours(b.quarters),
    status: b.status,
    hold_expires_at: maybeInstant(b.hold_expires_at),
    series_id: b.series_id,
    refunded_hours: maybeHours(b.refunded_quarters),
    forfeited_hours: maybeHours(b.forfeited_quarters),
    cancelled_by: person(b.cancelled_by_id, b.cancelled_by_name),
    cancellation_reason: b.cancellation_reason,
    checked_in_at: maybeInstant(b.checked_in_at),
    checked_in_by: person(b.checked_in_by_id, b.checked_in_by_name),
    no_show_by: person(b.no_show_by_id, b.no_show_by_name),
    checked_out_at: maybeInstant(b.checked_out_at),
    checked_out_by: person(b.checked_out_by_id, b.checked_out_by_name),
    late_quarter_hours: b.late_quarter_hours,
    pack_hours_applied: maybeHours(b.pack_quarters_applied),
    overage:
      b.overage_quarter_hours === null ||
      b.overage_hourly_rate_cents === null ||
      b.overage_tax_rate_percent === null ||
      b.overage_subtotal_cents === null ||
      b.overage_tax_cents === null ||
      b.overage_total_cents === null
        ? null
        : {
            quarter_hours: b.overage_quarter_hours,
            hourly_rate_cents: b.overage_hourly_rate_cents,
            tax_rate_percent: b.overage_tax_rate_percent,
            subtotal_cents: b.overage_subtotal_cents,
            tax_cents: b.overage_tax_cents,
            total_cents: b.overage_total_cents,
            killbill_invoice_id: b.overage_killbill_invoice_id,
          },
    created_at: instant(b.created_at),
  };
}

export async function bookingView(db: Db, id: string): Promise<Booking> {
  return projectBooking(await bookingRow(db, id));
}

interface MovementRow {
  id: string;
  kind: MovementKind;
  booking_id: string | null;
  purchase_id: string | null;
  quarters: number;
  created_at: Date;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: Actor["role"] | null;
}

/** A member's ledger movements, newest first, with their entries and lot shares. */
export async function movements(db: Db, memberId: string): Promise<Movement[]> {
  const list = await rows<MovementRow>(
    db,
    `SELECT id, kind, booking_id, purchase_id, quarters, created_at, actor_id, actor_name, actor_role
       FROM movements WHERE member_id = $1 ORDER BY seq DESC`,
    [memberId],
  );
  const entries = await rows<{ movement_id: string; account: Account; quarters: number }>(
    db,
    `SELECT e.movement_id, e.account, e.quarters FROM entries e JOIN movements m ON m.id = e.movement_id
      WHERE m.member_id = $1 ORDER BY e.position`,
    [memberId],
  );
  const shares = await rows<{ movement_id: string; purchase_id: string | null; delta: number }>(
    db,
    `SELECT ml.movement_id, l.purchase_id, ml.delta FROM movement_lots ml
       JOIN movements m ON m.id = ml.movement_id JOIN lots l ON l.id = ml.lot_id
      WHERE m.member_id = $1 ORDER BY ml.position`,
    [memberId],
  );
  return list.map((m) => ({
    id: m.id,
    kind: m.kind,
    booking_id: m.booking_id,
    purchase_id: m.purchase_id,
    hours: hours(m.quarters),
    created_at: instant(m.created_at),
    actor:
      m.actor_id === null || m.actor_name === null || m.actor_role === null
        ? null
        : { user_id: m.actor_id, name: m.actor_name, role: m.actor_role },
    lots: shares.filter((s) => s.movement_id === m.id).map((s) => ({ purchase_id: s.purchase_id, hours: hours(Math.abs(s.delta)) })),
    entries: entries.filter((e) => e.movement_id === m.id).map((e) => ({ account: e.account, hours: hours(e.quarters) })),
  }));
}

export interface DocumentRow {
  id: string;
  member_id: string;
  type: DocumentType;
  expiry_date: string;
  status: DocumentStatus;
  file_name: string;
  content_type: DocumentContentType;
  size_bytes: number;
  sha256: string;
  rejection_reason: string | null;
  created_at: Date;
}

export function projectDocument(d: DocumentRow): DocumentRecord {
  return {
    id: d.id,
    member_id: d.member_id,
    type: d.type,
    expiry_date: d.expiry_date,
    status: d.status,
    file_name: d.file_name,
    content_type: d.content_type,
    size_bytes: d.size_bytes,
    sha256: d.sha256,
    rejection_reason: d.rejection_reason,
    created_at: instant(d.created_at),
  };
}

export interface LinkRow {
  id: string;
  truck_id: string;
  inspector_email: string;
  url: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

/** Link liveness: live until `expires_at`, unless revoked first. */
export function linkState(link: { expires_at: Date; revoked_at: Date | null }, now: number): LinkState {
  if (link.revoked_at !== null) return "revoked";
  return now < link.expires_at.getTime() ? "live" : "expired";
}

export function projectLink(l: LinkRow, now: number): InspectorLink {
  return {
    id: l.id,
    truck_id: l.truck_id,
    inspector_email: l.inspector_email,
    url: l.url,
    expires_at: instant(l.expires_at),
    revoked_at: maybeInstant(l.revoked_at),
    created_at: instant(l.created_at),
    state: linkState(l, now),
  };
}

export interface RateRow {
  id: string;
  effective_from: string;
  hourly_rate_cents: number;
  tax_rate_percent: string;
  created_at: Date;
}

/** The rate in force on a site-local date: the latest `effective_from` on or before it. */
export function resolveRate(list: RateRow[], date: string): RateRow | undefined {
  return list.filter((r) => r.effective_from <= date).sort((a, b) => a.effective_from.localeCompare(b.effective_from)).pop();
}

/** Rate states on the site's own date: the rate in force today is current. */
export function projectRates(list: RateRow[], siteDate: string): Rate[] {
  const current = resolveRate(list, siteDate)?.id;
  return list.map((r) => {
    const state: RateState = r.id === current ? "current" : r.effective_from > siteDate ? "upcoming" : "past";
    return {
      id: r.id,
      effective_from: r.effective_from,
      hourly_rate_cents: r.hourly_rate_cents,
      tax_rate_percent: r.tax_rate_percent,
      state,
      created_at: instant(r.created_at),
    };
  });
}
