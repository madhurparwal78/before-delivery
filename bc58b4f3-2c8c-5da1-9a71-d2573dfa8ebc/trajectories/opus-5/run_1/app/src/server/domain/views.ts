import { isOfferable } from './assignment.js';
import { isoWithCentralOffset } from './time.js';
import type { AssignmentRecord, SessionUser } from './types.js';
import { endOf } from './assignment.js';

export type ViewKind = 'offer' | 'holder' | 'organisation' | 'staff';

/** Role visibility: the view a caller gets, or null when the assignment is invisible. */
export function viewKindFor(assignment: AssignmentRecord, user: SessionUser): ViewKind | null {
  if (user.role === 'dispatcher' || user.role === 'billing_lead') return 'staff';
  if (user.role === 'scheduler' || user.role === 'org_admin') {
    return user.orgCode === assignment.orgCode ? 'organisation' : null;
  }
  if (assignment.seats.some((seat) => seat.holderId === user.id)) return 'holder';
  if (isOfferable(assignment.status) && user.languages.includes(assignment.languageCode)) {
    return 'offer';
  }
  return null;
}

export type AssignmentView = Record<string, unknown>;

export function assignmentView(assignment: AssignmentRecord, kind: ViewKind): AssignmentView {
  const base: AssignmentView = {
    number: assignment.number,
    status: assignment.status,
    language: assignment.languageCode,
    setting: assignment.setting,
    city: assignment.city,
    start_at: isoWithCentralOffset(assignment.startAt),
    end_at: isoWithCentralOffset(endOf(assignment)),
    duration_minutes: assignment.durationMinutes,
  };

  if (kind === 'offer') {
    return {
      ...base,
      seats: assignment.seats.map((seat) => ({ seat: seat.seat, status: seat.status })),
    };
  }

  const seats = assignment.seats.map((seat) => ({
    seat: seat.seat,
    status: seat.status,
    interpreter_initials: seat.holderInitials,
  }));

  if (kind === 'holder') {
    return {
      ...base,
      street_address: assignment.streetAddress,
      patient_initials: assignment.patientInitials,
      medical_notes: assignment.medicalNotes,
      scheduler: { name: assignment.schedulerName, phone: assignment.schedulerPhone },
      seats,
    };
  }

  const organisation: AssignmentView = {
    number: assignment.number,
    status: assignment.status,
    language: assignment.languageCode,
    setting: assignment.setting,
    city: assignment.city,
    start_at: base.start_at,
    end_at: base.end_at,
    duration_minutes: assignment.durationMinutes,
    street_address: assignment.streetAddress,
    patient_initials: assignment.patientInitials,
    medical_notes: assignment.medicalNotes,
    scheduler: { name: assignment.schedulerName, phone: assignment.schedulerPhone },
    seats,
    cancellation:
      assignment.cancelledAt === null
        ? null
        : {
            cancelled_at: isoWithCentralOffset(assignment.cancelledAt),
            fee_applies: assignment.cancelFeeApplies,
            business_minutes_notice: assignment.cancelBusinessMinutes,
            fee_cents: assignment.cancelFeeCents,
          },
    billing: {
      status: assignment.billingStatus,
      invoice_id: assignment.invoiceId,
      total_cents: assignment.totalCents,
    },
  };

  if (kind === 'organisation') return organisation;

  return {
    ...organisation,
    org: { code: assignment.orgCode, name: assignment.orgName },
    seats: assignment.seats.map((seat) => ({
      seat: seat.seat,
      status: seat.status,
      interpreter_initials: seat.holderInitials,
      interpreter_name: seat.holderName,
    })),
  };
}
