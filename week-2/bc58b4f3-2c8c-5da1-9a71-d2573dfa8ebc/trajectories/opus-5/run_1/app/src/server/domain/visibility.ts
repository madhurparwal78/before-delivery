import type { AssignmentView, CancellationView, SeatView } from '../../shared/contract.js';
import { toAgencyIso } from '../../shared/zone.js';
import { endInstantOf, type AssignmentRecord, type Viewer } from './records.js';
import { OFFER_VISIBLE_STATUSES } from '../../shared/transitions.js';

export type ViewKind = 'offer' | 'holder' | 'organisation' | 'staff';

export function isAgencyStaff(viewer: Viewer): boolean {
  return viewer.role === 'dispatcher' || viewer.role === 'billing_lead';
}

function holdsSeatOn(record: AssignmentRecord, viewer: Viewer): boolean {
  return record.seats.some((seat) => seat.holder_id === viewer.id);
}

/** The single place that decides how much of an assignment a caller may see. */
export function viewKindFor(record: AssignmentRecord, viewer: Viewer): ViewKind | null {
  if (isAgencyStaff(viewer)) {
    return 'staff';
  }
  if (viewer.role === 'scheduler' || viewer.role === 'org_admin') {
    return record.org_id === viewer.orgId ? 'organisation' : null;
  }
  if (holdsSeatOn(record, viewer)) {
    return 'holder';
  }
  if (OFFER_VISIBLE_STATUSES.includes(record.status) && viewer.languages.includes(record.language_code)) {
    return 'offer';
  }
  return null;
}

function cancellationOf(record: AssignmentRecord): CancellationView | null {
  if (
    record.cancelled_at === null ||
    record.fee_applies === null ||
    record.business_minutes_notice === null ||
    record.fee_cents === null
  ) {
    return null;
  }
  return {
    cancelled_at: toAgencyIso(record.cancelled_at),
    fee_applies: record.fee_applies,
    business_minutes_notice: record.business_minutes_notice,
    fee_cents: record.fee_cents,
  };
}

export function seatViewsFor(record: AssignmentRecord, kind: ViewKind): SeatView[] {
  return record.seats.map((seat) => {
    if (kind === 'offer') {
      return { seat: seat.seat_no, status: seat.status };
    }
    const base: SeatView = {
      seat: seat.seat_no,
      status: seat.status,
      interpreter_initials: seat.status === 'open' ? null : seat.holder_initials,
    };
    if (kind === 'staff') {
      return { ...base, interpreter_name: seat.status === 'open' ? null : seat.holder_name };
    }
    return base;
  });
}

export function assignmentViewFor(record: AssignmentRecord, kind: ViewKind): AssignmentView {
  const view: AssignmentView = {
    number: record.number,
    status: record.status,
    language: record.language_code,
    setting: record.setting,
    city: record.city,
    start_at: toAgencyIso(record.start_at),
    end_at: toAgencyIso(endInstantOf(record)),
    duration_minutes: record.duration_minutes,
    seats: seatViewsFor(record, kind),
  };
  if (kind === 'offer') {
    return view;
  }
  const detailed: AssignmentView = {
    ...view,
    street_address: record.street_address,
    patient_initials: record.patient_initials,
    medical_notes: record.medical_notes,
    scheduler: { name: record.scheduler_name, phone: record.scheduler_phone },
  };
  if (kind === 'holder') {
    return detailed;
  }
  const organisational: AssignmentView = {
    ...detailed,
    cancellation: cancellationOf(record),
    billing: {
      status: record.billing_status,
      invoice_id: record.invoice_id,
      total_cents: record.total_cents,
    },
  };
  if (kind === 'organisation') {
    return organisational;
  }
  return { ...organisational, org: { code: record.org_code, name: record.org_name } };
}
