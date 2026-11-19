import type { Balances, Booking, DocumentRecord, LedgerMovement, RateRecord, Sector, VisitRecord } from '../shapes.js';
import type { ActorSummary, ActorWithRole, BookingStatus, DocumentStatus, DocumentType, MovementKind, RateState, Role, ServiceKind } from '../types.js';
import type { BookingRow } from './domain.js';
import type { Row } from './db.js';
import { isoInstant } from './iso.js';
import { minutesToWall } from '../sitetime.js';
import { movementLabel } from '../labels.js';
import type { LotRow } from './ledger.js';

export function minutesToTime(minutes: number): string {
  if (minutes >= 1440) return '24:00';
  return minutesToWall(minutes);
}

function asDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

export function actorSummary(id: string, name: string): ActorSummary {
  return { user_id: id, name };
}

export function actorWithRole(id: string, name: string, role: Role): ActorWithRole {
  return { user_id: id, name, role };
}

export function bookingWire(
  booking: BookingRow,
  stationName: string,
  businessName: string,
): Booking {
  const status = booking.status as BookingStatus;
  const overageRaw = booking.overage as Record<string, unknown> | null;
  return {
    id: booking.id,
    reference: booking.reference,
    site_id: booking.site_id,
    station_id: booking.station_id,
    station_name: stationName,
    member_id: booking.member_id,
    business_name: businessName,
    date: booking.date,
    start: minutesToTime(Number(booking.start_minute)),
    end: minutesToTime(Number(booking.end_minute)),
    start_at: isoInstant(Number(booking.start_at)),
    end_at: isoInstant(Number(booking.end_at)),
    hours: Number(booking.quarter_hours) / 4,
    status,
    hold_expires_at: booking.hold_expires_at === null ? null : isoInstant(Number(booking.hold_expires_at)),
    series_id: booking.series_id,
    refunded_hours: booking.refunded_qh === null ? null : Number(booking.refunded_qh) / 4,
    forfeited_hours: booking.forfeited_qh === null ? null : Number(booking.forfeited_qh) / 4,
    cancelled_by: booking.cancelled_by_name === null ? null : (booking.cancelled_by_user ? actorSummary(String(booking.cancelled_by_user), String(booking.cancelled_by_name)) : null),
    cancellation_reason: booking.cancellation_reason,
    checked_in_at: booking.checked_in_at === null ? null : isoInstant(Number(booking.checked_in_at)),
    checked_in_by: booking.checked_in_by_name === null ? null : { user_id: '', name: String(booking.checked_in_by_name) },
    no_show_by: booking.no_show_by_name === null ? null : { user_id: '', name: String(booking.no_show_by_name) },
    checked_out_at: booking.checked_out_at === null ? null : isoInstant(Number(booking.checked_out_at)),
    checked_out_by: booking.checked_out_by_name === null ? null : { user_id: '', name: String(booking.checked_out_by_name) },
    late_quarter_hours: booking.late_qh === null ? null : Number(booking.late_qh),
    pack_hours_applied: booking.pack_applied_qh === null ? null : Number(booking.pack_applied_qh) / 4,
    overage: overageRaw === null ? null : {
      quarter_hours: Number(overageRaw.quarter_hours),
      hourly_rate_cents: Number(overageRaw.hourly_rate_cents),
      tax_rate_percent: String(overageRaw.tax_rate_percent),
      subtotal_cents: Number(overageRaw.subtotal_cents),
      tax_cents: Number(overageRaw.tax_cents),
      total_cents: Number(overageRaw.total_cents),
      killbill_invoice_id: overageRaw.killbill_invoice_id === null ? null : String(overageRaw.killbill_invoice_id),
    },
    created_at: isoInstant(Number(booking.created_at)),
  };
}

export function lotsWire(lots: LotRow[], today: string, expiringSoonDays: number): Array<{ purchase_id: string | null; pack_name: string; hours: number; valid_through: string | null; expiring_soon: boolean }> {
  return lots
    .filter((lot) => Number(lot.remainder_qh) > 0)
    .map((lot) => ({
      purchase_id: lot.purchase_id,
      pack_name: lot.pack_name,
      hours: Number(lot.remainder_qh) / 4,
      valid_through: lot.valid_through === null ? null : asDate(lot.valid_through),
      expiring_soon: expiringSoon(lot.valid_through === null ? null : asDate(lot.valid_through), today, expiringSoonDays),
    }));
}

export function expiringSoon(validThrough: string | null, today: string, days: number): boolean {
  if (!validThrough) return false;
  const left = dayDiff(today, validThrough);
  return left >= 0 && left <= days;
}

export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

export function movementWire(row: Row): LedgerMovement {
  const lotsRaw = row.lots as Array<Record<string, unknown>> | null;
  const entriesRaw = row.entries as Array<Record<string, unknown>> | null;
  const actorRole = row.actor_role as Role | null;
  return {
    id: Number(row.id),
    kind: row.kind as MovementKind,
    booking_id: (row.booking_id as string | null) ?? null,
    purchase_id: (row.purchase_id as string | null) ?? null,
    hours: Number(row.quarter_hours) / 4,
    created_at: isoInstant(Number(row.created_at)),
    actor: actorRole === null
      ? null
      : { user_id: String(row.actor_user_id), name: String(row.actor_name), role: actorRole },
    lots: (lotsRaw ?? []).map((lot) => ({
      purchase_id: (lot.purchase_id as string | null) ?? null,
      hours: Number(lot.quarter_hours) / 4,
    })),
    entries: (entriesRaw ?? []).map((entry) => ({
      account: String(entry.account),
      hours: Number(entry.quarter_hours) / 4,
    })),
  };
}

export function movementLabelFor(kind: MovementKind): string {
  return movementLabel(kind);
}

export function documentWire(row: Row): DocumentRecord {
  return {
    id: String(row.id),
    member_id: String(row.member_id),
    type: row.type as DocumentType,
    expiry_date: asDate(row.expiry_date).slice(0, 10),
    status: row.status as DocumentStatus,
    file_name: String(row.file_name),
    content_type: String(row.content_type),
    size_bytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    rejection_reason: (row.rejection_reason as string | null) ?? null,
    created_at: isoInstant(Number(row.created_at)),
  };
}

export function visitWire(row: Row): VisitRecord {
  const services = row.services as ServiceKind[];
  return {
    id: String(row.id),
    truck_id: String(row.truck_id),
    site_id: String(row.site_id),
    arrived_at: isoInstant(Number(row.arrived_at)),
    departed_at: row.departed_at === null ? null : isoInstant(Number(row.departed_at)),
    services,
    operator_signature: String(row.operator_signature),
    manager_name: String(row.manager_name),
    gap_hours: row.gap_hours === null || row.gap_hours === undefined ? null : Number(row.gap_hours),
    gap_flagged: Boolean(row.gap_flagged),
  };
}

export function rateWire(row: Row, siteToday: string, currentEffectiveFrom: string | null): RateRecord {
  return {
    id: String(row.id),
    effective_from: asDate(row.effective_from).slice(0, 10),
    hourly_rate_cents: Number(row.hourly_rate_cents),
    tax_rate_percent: String(row.tax_rate_percent),
    state: rateState(String(row.effective_from), siteToday, String(row.effective_from) === currentEffectiveFrom),
    created_at: isoInstant(Number(row.created_at)),
  };
}

/** A rate's state is judged on its site's own local date. */
export function rateState(effectiveFrom: string, siteToday: string, isLatestOnOrBefore: boolean): RateState {
  if (effectiveFrom > siteToday) return 'upcoming';
  return isLatestOnOrBefore ? 'current' : 'past';
}
