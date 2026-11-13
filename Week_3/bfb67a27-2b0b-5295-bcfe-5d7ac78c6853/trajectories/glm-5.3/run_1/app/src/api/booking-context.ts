// Builds the booking view context: latest certificate, photos, locations, class metadata.

import { loadCatalogue, loadAvailability } from '../domain/store.js';
import { loadBookingPhotos, loadLatestCertificate } from './bookings-store.js';
import type { Booking } from '../types.js';
import type { BookingViewContext } from './views.js';

export async function buildBookingViewContext(booking: Booking, now: Date): Promise<BookingViewContext & { kitNames: Map<string, string> }> {
  const [catalogue, availability, certificate, photos] = await Promise.all([
    loadCatalogue(),
    loadAvailability(),
    loadLatestCertificate(booking.ref),
    loadBookingPhotos(booking.ref),
  ]);
  const classNames = new Map(catalogue.classes.map((klass) => [klass.id, klass.name]));
  const classValues = new Map(catalogue.classes.map((klass) => [klass.id, klass.replacementValueCents]));
  const unitClassBySerial = new Map(catalogue.units.map((unit) => [unit.serial, unit.classId]));
  const kitNames = new Map(catalogue.kits.map((kit) => [kit.id, kit.name]));
  return {
    certificate,
    photos,
    locations: availability.unitLocations,
    classNames,
    classValues,
    unitClassBySerial,
    kitNames,
    approvedCertificate: certificate !== null && certificate.status === 'approved',
    now,
  };
}
