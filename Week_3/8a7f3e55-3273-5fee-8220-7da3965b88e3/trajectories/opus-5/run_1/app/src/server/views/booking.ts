import type {
  Booking,
  HolderCard,
  Material,
  OpenCallStatus,
  Seat,
  SessionUser,
} from '../../shared/api.js';
import { coverageState } from '../domain/booking-rules.js';
import { isQualified } from '../domain/qualification.js';
import { buildPlan } from '../domain/rotation.js';
import { agencyIso } from '../domain/time.js';
import {
  seatsHeld,
  type BookingRecord,
  type HolderRecord,
  type MaterialRecord,
} from '../store/bookings.js';

export function openCallStatusOf(booking: BookingRecord, now: Date): OpenCallStatus {
  if (booking.open_call_closes_at === null) return 'none';
  return now.getTime() < booking.open_call_closes_at.getTime() ? 'open' : 'closed';
}

export function isOfferedTo(
  booking: BookingRecord,
  credentials: readonly { code: string; expires_on: string }[],
): boolean {
  if (booking.open_call_closes_at === null) return false;
  if (['in_progress', 'completed', 'cancelled', 'cancelled_late'].includes(booking.status)) {
    return false;
  }
  return isQualified(credentials, booking.setting, booking.assignment_date);
}

function holderCard(holder: HolderRecord, user: SessionUser): HolderCard {
  switch (user.role) {
    case 'coordinator':
      return {
        id: holder.id,
        name: holder.name,
        initials: holder.initials,
        credentials: holder.credentials,
        phone: holder.phone,
        email: holder.email,
        home_city: holder.home_city,
        pay_rate_cents: holder.pay_rate_cents,
      };
    case 'billing_manager':
      return {
        id: holder.id,
        name: holder.name,
        initials: holder.initials,
        credentials: holder.credentials.map((credential) => credential.code),
      };
    case 'requester':
      return {
        name: holder.name,
        initials: holder.initials,
        credentials: holder.credentials.map((credential) => credential.code),
      };
    case 'interpreter':
      return {
        name: holder.name,
        initials: holder.initials,
        credentials: holder.credentials.map((credential) => credential.code),
        is_me: holder.id === user.id,
      };
  }
}

function materialView(material: MaterialRecord): Material {
  return {
    id: material.id,
    name: material.name,
    size_bytes: material.size_bytes,
    content_type: material.content_type,
    sha256: material.sha256,
    uploaded_at: agencyIso(new Date(material.uploaded_at)),
  };
}

export function bookingView(
  booking: BookingRecord,
  user: SessionUser,
  now: Date,
): Booking {
  const held = seatsHeld(booking);
  const plan = buildPlan({
    start: booking.start_at,
    durationMinutes: booking.duration_minutes,
    seatCount: booking.seat_count,
    intervalMinutes: booking.contract.rotationIntervalMinutes,
    seats: booking.seats.map((seat) => ({
      seat: seat.seat,
      holderName: seat.holder?.name ?? null,
      holderInitials: seat.holder?.initials ?? null,
    })),
  });
  const seats: Seat[] = booking.seats.map((seat) => ({
    seat: seat.seat,
    holder: seat.holder === null ? null : holderCard(seat.holder, user),
  }));
  const holdsASeat = booking.seats.some((seat) => seat.holder?.id === user.id);
  const showMaterials = user.role !== 'interpreter' || holdsASeat;

  const base: Booking = {
    id: booking.id,
    ref: booking.ref,
    org_name: booking.org_name,
    setting: booking.setting,
    title: booking.title,
    location: booking.location,
    onsite_contact_name: booking.onsite_contact_name,
    onsite_contact_phone: booking.onsite_contact_phone,
    consumer_name: booking.consumer_name,
    start: agencyIso(booking.start_at),
    end: agencyIso(new Date(booking.start_at.getTime() + booking.duration_minutes * 60_000)),
    duration_minutes: booking.duration_minutes,
    status: booking.status,
    seat_count: booking.seat_count,
    open_call_status: openCallStatusOf(booking, now),
    open_call_closes_at:
      booking.open_call_closes_at === null ? null : agencyIso(booking.open_call_closes_at),
    coverage: {
      state: coverageState(held, booking.seat_count),
      covered_minutes: plan.coveredMinutes,
      percent: plan.percent,
    },
    seats,
    rotation: plan.rotation,
    materials: showMaterials ? booking.materials.map(materialView) : [],
  };

  if (user.role === 'interpreter') return base;

  const charge = booking.line
    ? {
        line_ref: booking.line.line_ref,
        kind: booking.line.kind,
        amount_cents: booking.line.amount_cents,
        sync_status: booking.line.sync_status,
      }
    : null;

  if (user.role === 'requester') {
    return {
      ...base,
      requester_name: booking.requester_name,
      requester_notes: booking.requester_notes,
      charge,
    };
  }

  return {
    ...base,
    org_id: booking.org_id,
    requester_name: booking.requester_name,
    requester_notes: booking.requester_notes,
    charge,
    created_at: agencyIso(booking.created_at),
  };
}
