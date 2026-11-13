// The booking resource view: one shape for every endpoint (API booking resource).

import { checkoutBlockers, closeBlockers } from '../domain/gates.js';
import type { Booking, Certificate, Photo } from '../types.js';

export interface CertificateView {
  id: string;
  status: Certificate['status'];
  uploadedAt: string;
  sizeBytes: number;
  coverageStart: string | null;
  coverageEnd: string | null;
  limitCents: number | null;
  reason: string | null;
}

export interface UnitView {
  serial: string;
  classId: string;
  className: string;
  replacementValueCents: number;
  location: string;
  checkedOut: boolean;
  checkedIn: boolean;
  condition: string | null;
  damageChargeCents: number;
}

export interface PhotoView {
  id: string;
  phase: Photo['phase'];
  serial: string;
  status: Photo['status'];
}

export interface BookingView {
  ref: string;
  state: Booking['state'];
  kit: { id: string; name: string };
  pickupDate: string;
  returnDate: string;
  hireDays: number;
  renter: { name: string; email: string };
  units: UnitView[];
  replacementValueCents: number;
  billableDays: number;
  dayRateCents: number;
  hirePriceCents: number;
  depositCents: number;
  totalCents: number;
  rateCardVersion: number;
  holdExpiresAt: string | null;
  holdSecondsRemaining: number | null;
  confirmable: boolean;
  paymentStatus: Booking['paymentStatus'];
  damageCents: number;
  refundCents: number;
  certificate: CertificateView | null;
  photos: PhotoView[];
  checkout: { allowed: boolean; blockers: { code: string; message: string }[] };
  close: { allowed: boolean; blockers: { code: string; message: string }[] };
}

export interface BookingViewContext {
  certificate: Certificate | null;
  photos: Photo[];
  locations: Map<string, string>;
  classNames: Map<string, string>;
  classValues: Map<string, number>;
  unitClassBySerial: Map<string, string>;
  kitNames: Map<string, string>;
  approvedCertificate: boolean;
  now: Date;
}

export function bookingView(booking: Booking, context: BookingViewContext): BookingView {
  const holdSecondsRemaining =
    booking.state === 'quote' ? Math.max(0, Math.floor((booking.holdExpiresAt.getTime() - context.now.getTime()) / 1000)) : null;
  const confirmable =
    booking.state === 'quote' && holdSecondsRemaining !== null && holdSecondsRemaining > 0 && context.approvedCertificate;
  const units: UnitView[] = booking.units.map((unit) => {
    const classId = context.unitClassBySerial.get(unit.serial) ?? unit.classId;
    return {
      serial: unit.serial,
      classId,
      className: context.classNames.get(classId) ?? '',
      replacementValueCents: context.classValues.get(classId) ?? 0,
      location: context.locations.get(unit.serial) ?? 'shelf',
      checkedOut: unit.checkedOutAt !== null,
      checkedIn: unit.checkedInAt !== null,
      condition: unit.condition,
      damageChargeCents: unit.damageChargeCents,
    };
  });
  const replacementValueCents = units.reduce((sum, unit) => sum + unit.replacementValueCents, 0);
  const storedCheckinPhotos = new Set(
    context.photos.filter((photo) => photo.phase === 'checkin' && photo.status === 'stored').map((photo) => photo.serial),
  );
  const unitsOnShelf = booking.units.every((unit) => context.locations.get(unit.serial) === 'shelf');
  const checkout = checkoutBlockers(booking, context.certificate, replacementValueCents, unitsOnShelf);
  const close = closeBlockers(booking, storedCheckinPhotos);
  return {
    ref: booking.ref,
    state: booking.state,
    kit: { id: booking.kitId, name: context.kitNames.get(booking.kitId) ?? booking.kitId },
    pickupDate: booking.pickupDate,
    returnDate: booking.returnDate,
    hireDays: booking.hireDays,
    renter: { name: booking.renterName, email: booking.renterEmail },
    units,
    replacementValueCents,
    billableDays: booking.billableDays,
    dayRateCents: booking.dayRateCents,
    hirePriceCents: booking.hirePriceCents,
    depositCents: booking.depositCents,
    totalCents: booking.totalCents,
    rateCardVersion: booking.rateCardVersion,
    holdExpiresAt: booking.state === 'quote' ? booking.holdExpiresAt.toISOString() : null,
    holdSecondsRemaining,
    confirmable,
    paymentStatus: booking.paymentStatus,
    damageCents: booking.damageCents,
    refundCents: booking.refundCents,
    certificate: context.certificate
      ? {
          id: context.certificate.id,
          status: context.certificate.status,
          uploadedAt: context.certificate.uploadedAt.toISOString(),
          sizeBytes: context.certificate.sizeBytes,
          coverageStart: toDateString(context.certificate.coverageStart),
          coverageEnd: toDateString(context.certificate.coverageEnd),
          limitCents: context.certificate.limitCents,
          reason: context.certificate.reason,
        }
      : null,
    photos: context.photos.map((photo) => ({
      id: photo.id,
      phase: photo.phase,
      serial: photo.serial,
      status: photo.status,
    })),
    checkout: { allowed: checkout.length === 0, blockers: checkout },
    close: { allowed: close.length === 0, blockers: close },
  };
}






function toDateString(value: string | Date | null): string | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}
