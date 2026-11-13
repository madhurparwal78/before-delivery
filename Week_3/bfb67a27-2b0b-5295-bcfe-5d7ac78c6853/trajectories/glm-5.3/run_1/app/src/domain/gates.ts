// The one place the checkout and close gates are decided (DP-24, DP-30).

import type { Booking, Certificate } from '../types.js';

export interface Blocker {
  code: string;
  message: string;
}

export function checkoutBlockers(
  booking: Booking,
  certificate: Certificate | null,
  replacementValueCents: number,
  unitsOnShelf: boolean = true,
): Blocker[] {
  const blockers: Blocker[] = [];
  if (booking.state !== 'prepped') {
    blockers.push({ code: 'not_prepped', message: 'Kit is not prepped' });
  }
  if (booking.state === 'prepped' && !unitsOnShelf) {
    blockers.push({ code: 'units_off_shelf', message: 'Assigned units are not on the shelf' });
  }
  if (certificate === null || certificate.status !== 'approved') {
    blockers.push({ code: 'certificate_missing', message: 'No approved certificate of insurance' });
    return blockers;
  }
  const startsBeforePickup = certificate.coverageStart !== null && certificate.coverageStart <= booking.pickupDate;
  const endsAfterReturn = certificate.coverageEnd !== null && certificate.coverageEnd >= booking.returnDate;
  if (!(startsBeforePickup && endsAfterReturn)) {
    blockers.push({ code: 'certificate_dates', message: 'Certificate does not cover every hire day' });
  }
  if (certificate.limitCents === null || certificate.limitCents < replacementValueCents) {
    blockers.push({ code: 'certificate_limit', message: 'Certificate limit is below the kit replacement value' });
  }
  return blockers;
}

export function closeBlockers(booking: Booking, storedCheckinPhotos: ReadonlySet<string>): Blocker[] {
  const blockers: Blocker[] = [];
  const notReturned = booking.units.some((unit) => unit.checkedInAt === null || unit.condition === null);
  if (notReturned) {
    blockers.push({ code: 'not_returned', message: 'Not every unit is checked in' });
  }
  const missing = booking.units
    .filter((unit) => !storedCheckinPhotos.has(unit.serial))
    .map((unit) => unit.serial);
  if (missing.length > 0) {
    blockers.push({
      code: 'photos_not_stored',
      message: `Condition photos are not stored for ${missing.join(', ')}`,
    });
  }
  return blockers;
}
