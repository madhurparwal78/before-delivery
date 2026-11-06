/** Row-to-JSON presenters shared by the route modules. */

import type { Db } from '../db.js';
import { MINUTE_MS } from '../../shared/kitchenTime.js';
import { kitchenToday } from '../domain/clock.js';
import { complianceOf, type DocumentFacts } from '../domain/compliance.js';
import { balanceMinutes, heldMinutes } from '../domain/ledger.js';
import type {
  Booking,
  BookingStatus,
  ComplianceDocument,
  ComplianceLink,
  RenterSummary,
  Statement,
} from '../../shared/types.js';
import type {
  BookingRow,
  ComplianceLinkRow,
  DocumentRow,
  RenterRow,
  StatementRow,
} from '../rows.js';

export async function renterDocumentFacts(tx: Db, renterId: string): Promise<DocumentFacts[]> {
  return tx.query<DocumentFacts>(
    'SELECT id, kind, expires_on, status, seq::int AS seq FROM documents WHERE renter_id = $1',
    [renterId],
  );
}

/** The renter object every read shares. This never contacts Kill Bill. */
export async function renterSummary(tx: Db, renter: RenterRow): Promise<RenterSummary> {
  const documents = await renterDocumentFacts(tx, renter.id);
  return {
    id: renter.id,
    business_name: renter.business_name,
    contact_name: renter.contact_name,
    email: renter.email,
    phone: renter.phone,
    status: renter.status,
    balance_minutes: await balanceMinutes(tx, renter.id),
    held_minutes: await heldMinutes(tx, renter.id),
    compliance: complianceOf(documents, kitchenToday()),
  };
}

/** A hold past its instant reports `expired`, whether or not the sweep has run. */
export function effectiveBookingStatus(row: BookingRow, nowMs: number): BookingStatus {
  if (row.status === 'hold' && row.hold_expires_at !== null && row.hold_expires_at.getTime() <= nowMs) {
    return 'expired';
  }
  return row.status;
}

export function presentBooking(row: BookingRow, nowMs: number): Booking {
  return {
    id: row.id,
    series_id: row.series_id,
    station_id: row.station_id,
    station_name: row.station_name,
    renter_id: row.renter_id,
    status: effectiveBookingStatus(row, nowMs),
    date: row.date,
    start: row.start_hhmm,
    end: row.end_hhmm,
    starts_at: row.starts_at.toISOString(),
    ends_at: row.ends_at.toISOString(),
    buffer_minutes: row.buffer_minutes,
    buffer_ends_at: new Date(
      row.ends_at.getTime() + row.buffer_minutes * MINUTE_MS,
    ).toISOString(),
    hour_weight: row.hour_weight,
    off_peak_percent: row.off_peak_percent,
    overage_usd_per_hour: row.overage_usd_per_hour,
    minutes_debited: row.minutes_debited,
    hold_expires_at: row.hold_expires_at?.toISOString() ?? null,
    cancellation_cutoff_at: row.cancellation_cutoff_at.toISOString(),
    actual_start: row.actual_start,
    actual_end: row.actual_end,
    overage_units: row.overage_units,
    overage_usd: row.overage_usd,
    created_at: row.created_at.toISOString(),
  };
}

export function presentDocument(row: DocumentRow): ComplianceDocument {
  return {
    id: row.id,
    renter_id: row.renter_id,
    kind: row.kind,
    expires_on: row.expires_on,
    status: row.status,
    original_name: row.original_name,
    size_bytes: row.size_bytes,
    content_type: row.content_type,
    created_at: row.created_at.toISOString(),
  };
}

export function presentStatement(row: StatementRow): Statement {
  return {
    id: row.id,
    renter_id: row.renter_id,
    month: row.month,
    created_at: row.created_at.toISOString(),
  };
}

export function presentLink(row: ComplianceLinkRow): ComplianceLink {
  return {
    id: row.id,
    label: row.label,
    token: row.token,
    url: `/share/${row.token}`,
    expires_in_seconds: row.expires_in_seconds,
    expires_at: row.expires_at.toISOString(),
    revoked_at: row.revoked_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}
