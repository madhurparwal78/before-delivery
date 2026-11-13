import type { Queryable } from '../server/db.js';
import type {
  Blocker,
  Booking,
  BookingState,
  BookingUnit,
  CertificateStatus,
  CertificateView,
  PaymentStatus,
  PhotoPhase,
  PhotoStatus,
  PhotoView,
} from '../shared/types.js';
import { dateToMs } from '../shared/dates.js';
import { formatMoney } from '../shared/money.js';
import { currentLocations } from './ledger.js';
import { rateCardEffectiveDate } from './ratecards.js';

export interface BookingRow {
  ref: string;
  kitId: string;
  kitName: string;
  storedState: BookingState;
  pickupDate: string;
  returnDate: string;
  hireDays: number;
  renterName: string;
  renterEmail: string;
  renterKey: string;
  billableDays: number;
  dayRateCents: number;
  hirePriceCents: number;
  depositCents: number;
  totalCents: number;
  replacementValueCents: number;
  rateCardVersion: number;
  holdExpiresAt: Date | null;
  paymentStatus: PaymentStatus;
  damageCents: number;
  refundCents: number;
  killbillPaymentId: string | null;
  confirmInFlight: boolean;
  confirmationMailed: boolean;
  receiptMailed: boolean;
}

const BOOKING_COLUMNS = `
  b.ref, b.kit_id, k.name AS kit_name, b.state, b.pickup_date, b.return_date, b.hire_days,
  b.renter_name, b.renter_email, b.renter_key, b.billable_days, b.day_rate_cents,
  b.hire_price_cents, b.deposit_cents, b.total_cents, b.replacement_value_cents,
  b.rate_card_version, b.hold_expires_at, b.payment_status, b.damage_cents, b.refund_cents,
  b.killbill_payment_id, b.confirm_in_flight, b.confirmation_mailed, b.receipt_mailed
`;

interface RawBookingRow {
  ref: string;
  kit_id: string;
  kit_name: string;
  state: BookingState;
  pickup_date: string;
  return_date: string;
  hire_days: number;
  renter_name: string;
  renter_email: string;
  renter_key: string;
  billable_days: number;
  day_rate_cents: number;
  hire_price_cents: number;
  deposit_cents: number;
  total_cents: number;
  replacement_value_cents: number;
  rate_card_version: number;
  hold_expires_at: Date | null;
  payment_status: PaymentStatus;
  damage_cents: number;
  refund_cents: number;
  killbill_payment_id: string | null;
  confirm_in_flight: boolean;
  confirmation_mailed: boolean;
  receipt_mailed: boolean;
}

function toRow(raw: RawBookingRow): BookingRow {
  return {
    ref: raw.ref,
    kitId: raw.kit_id,
    kitName: raw.kit_name,
    storedState: raw.state,
    pickupDate: raw.pickup_date,
    returnDate: raw.return_date,
    hireDays: raw.hire_days,
    renterName: raw.renter_name,
    renterEmail: raw.renter_email,
    renterKey: raw.renter_key,
    billableDays: raw.billable_days,
    dayRateCents: raw.day_rate_cents,
    hirePriceCents: raw.hire_price_cents,
    depositCents: raw.deposit_cents,
    totalCents: raw.total_cents,
    replacementValueCents: raw.replacement_value_cents,
    rateCardVersion: raw.rate_card_version,
    holdExpiresAt: raw.hold_expires_at,
    paymentStatus: raw.payment_status,
    damageCents: raw.damage_cents,
    refundCents: raw.refund_cents,
    killbillPaymentId: raw.killbill_payment_id,
    confirmInFlight: raw.confirm_in_flight,
    confirmationMailed: raw.confirmation_mailed,
    receiptMailed: raw.receipt_mailed,
  };
}

export async function findBookingRow(
  client: Queryable,
  ref: string,
  lock = false,
): Promise<BookingRow | null> {
  const result = await client.query<RawBookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN kits k ON k.id = b.kit_id
      WHERE b.ref = $1 ${lock ? 'FOR NO KEY UPDATE OF b' : ''}`,
    [ref],
  );
  const raw = result.rows[0];
  return raw === undefined ? null : toRow(raw);
}

export async function listBookingRows(
  client: Queryable,
  states: BookingState[] | null,
): Promise<BookingRow[]> {
  const result = await client.query<RawBookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN kits k ON k.id = b.kit_id
      WHERE ($1::text[] IS NULL OR b.state = ANY($1::text[]))
      ORDER BY b.pickup_date ASC, b.ref ASC`,
    [states],
  );
  return result.rows.map(toRow);
}

/**
 * The moment a hold ends the quote counts as expired for every request, whether
 * or not the sweeper has written the state yet.
 */
export function effectiveState(row: BookingRow, now: number = Date.now()): BookingState {
  if (row.storedState === 'quote' && row.holdExpiresAt !== null && row.holdExpiresAt.getTime() <= now) {
    return 'expired';
  }
  return row.storedState;
}

function holdSecondsRemaining(row: BookingRow, now: number = Date.now()): number | null {
  if (effectiveState(row) !== 'quote' || row.holdExpiresAt === null) return null;
  return Math.max(0, Math.ceil((row.holdExpiresAt.getTime() - now) / 1000));
}

export interface BookingUnitRow {
  serial: string;
  classId: string;
  className: string;
  replacementValueCents: number;
  checkedOut: boolean;
  checkedIn: boolean;
  condition: 'ok' | 'damaged' | null;
  damageChargeCents: number;
}

export async function bookingUnitRows(
  client: Queryable,
  ref: string,
): Promise<BookingUnitRow[]> {
  const result = await client.query<{
    serial: string;
    class_id: string;
    class_name: string;
    replacement_value_cents: number;
    checked_out: boolean;
    checked_in: boolean;
    condition: 'ok' | 'damaged' | null;
    damage_charge_cents: number;
  }>(
    `SELECT bu.serial, bu.class_id, c.name AS class_name, c.replacement_value_cents,
            bu.checked_out, bu.checked_in, bu.condition, bu.damage_charge_cents
       FROM booking_units bu
       JOIN unit_classes c ON c.id = bu.class_id
      WHERE bu.booking_ref = $1
      ORDER BY c.seq ASC, bu.serial ASC`,
    [ref],
  );
  return result.rows.map((row) => ({
    serial: row.serial,
    classId: row.class_id,
    className: row.class_name,
    replacementValueCents: row.replacement_value_cents,
    checkedOut: row.checked_out,
    checkedIn: row.checked_in,
    condition: row.condition,
    damageChargeCents: row.damage_charge_cents,
  }));
}

interface CertificateRow {
  id: string;
  bookingRef: string;
  status: CertificateStatus;
  uploadedAt: Date;
  sizeBytes: number;
  storageKey: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  limitCents: number | null;
  reason: string | null;
  rejectionMailed: boolean;
}

interface RawCertificateRow {
  id: string;
  booking_ref: string;
  status: CertificateStatus;
  uploaded_at: Date;
  size_bytes: number;
  storage_key: string;
  coverage_start: string | null;
  coverage_end: string | null;
  limit_cents: number | null;
  reason: string | null;
  rejection_mailed: boolean;
}

function toCertificateRow(raw: RawCertificateRow): CertificateRow {
  return {
    id: raw.id,
    bookingRef: raw.booking_ref,
    status: raw.status,
    uploadedAt: raw.uploaded_at,
    sizeBytes: raw.size_bytes,
    storageKey: raw.storage_key,
    coverageStart: raw.coverage_start,
    coverageEnd: raw.coverage_end,
    limitCents: raw.limit_cents,
    reason: raw.reason,
    rejectionMailed: raw.rejection_mailed,
  };
}

const CERTIFICATE_COLUMNS = `id, booking_ref, status, uploaded_at, size_bytes, storage_key,
  coverage_start, coverage_end, limit_cents, reason, rejection_mailed`;

/** The booking's latest stored certificate, which replaces any earlier one. */
export async function latestCertificate(
  client: Queryable,
  ref: string,
): Promise<CertificateRow | null> {
  const result = await client.query<RawCertificateRow>(
    `SELECT ${CERTIFICATE_COLUMNS} FROM certificates
      WHERE booking_ref = $1 ORDER BY seq DESC LIMIT 1`,
    [ref],
  );
  const raw = result.rows[0];
  return raw === undefined ? null : toCertificateRow(raw);
}

export async function findCertificateRow(
  client: Queryable,
  id: string,
  lock = false,
): Promise<CertificateRow | null> {
  const result = await client.query<RawCertificateRow>(
    `SELECT ${CERTIFICATE_COLUMNS} FROM certificates WHERE id::text = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [id],
  );
  const raw = result.rows[0];
  return raw === undefined ? null : toCertificateRow(raw);
}

interface PhotoRow {
  id: string;
  phase: PhotoPhase;
  serial: string;
  status: PhotoStatus;
  storageKey: string;
}

export async function bookingPhotos(client: Queryable, ref: string): Promise<PhotoRow[]> {
  const result = await client.query<{
    id: string;
    phase: PhotoPhase;
    serial: string;
    status: PhotoStatus;
    storage_key: string;
  }>(
    `SELECT id, phase, serial, status, storage_key FROM photos
      WHERE booking_ref = $1 ORDER BY created_at ASC, id ASC`,
    [ref],
  );
  return result.rows.map((row) => ({
    id: row.id,
    phase: row.phase,
    serial: row.serial,
    status: row.status,
    storageKey: row.storage_key,
  }));
}

function certificateView(certificate: CertificateRow | null): CertificateView | null {
  if (certificate === null) return null;
  const approved = certificate.status === 'approved';
  return {
    id: certificate.id,
    status: certificate.status,
    uploadedAt: certificate.uploadedAt.toISOString(),
    sizeBytes: certificate.sizeBytes,
    coverageStart: approved ? certificate.coverageStart : null,
    coverageEnd: approved ? certificate.coverageEnd : null,
    limitCents: approved ? certificate.limitCents : null,
    reason: certificate.status === 'rejected' ? certificate.reason : null,
  };
}

/** The checkout gate, decided here and nowhere else. */
export function checkoutBlockers(
  state: BookingState,
  certificate: CertificateRow | null,
  pickupDate: string,
  returnDate: string,
  replacementValueCents: number,
): Blocker[] {
  const blockers: Blocker[] = [];
  if (state !== 'prepped') blockers.push({ code: 'not_prepped', message: 'Kit is not prepped' });
  if (certificate === null || certificate.status !== 'approved') {
    blockers.push({
      code: 'certificate_missing',
      message: 'No approved certificate of insurance',
    });
    return blockers;
  }
  const coversDates =
    certificate.coverageStart !== null &&
    certificate.coverageEnd !== null &&
    dateToMs(certificate.coverageStart) <= dateToMs(pickupDate) &&
    dateToMs(certificate.coverageEnd) >= dateToMs(returnDate);
  if (!coversDates) {
    blockers.push({
      code: 'certificate_dates',
      message: 'Certificate does not cover every hire day',
    });
  }
  if (certificate.limitCents === null || certificate.limitCents < replacementValueCents) {
    blockers.push({
      code: 'certificate_limit',
      message: 'Certificate limit is below the kit replacement value',
    });
  }
  return blockers;
}

/** The close gate, decided here and nowhere else. */
export function closeBlockers(
  state: BookingState,
  units: BookingUnitRow[],
  photos: PhotoRow[],
): Blocker[] {
  const blockers: Blocker[] = [];
  if (state !== 'returned') {
    blockers.push({ code: 'not_returned', message: 'Not every unit is checked in' });
  }
  const missing = serialsWithoutStoredPhoto(units, photos, 'checkin');
  if (missing.length > 0) {
    blockers.push({
      code: 'photos_not_stored',
      message: `Condition photos are not stored for ${missing.join(', ')}`,
    });
  }
  return blockers;
}

export function serialsWithoutStoredPhoto(
  units: BookingUnitRow[],
  photos: PhotoRow[],
  phase: PhotoPhase,
): string[] {
  const stored = new Set(
    photos.filter((photo) => photo.phase === phase && photo.status === 'stored').map((p) => p.serial),
  );
  return units.filter((unit) => !stored.has(unit.serial)).map((unit) => unit.serial);
}

export async function buildBooking(client: Queryable, row: BookingRow): Promise<Booking> {
  const units = await bookingUnitRows(client, row.ref);
  const certificate = await latestCertificate(client, row.ref);
  const photos = await bookingPhotos(client, row.ref);
  const locations = await currentLocations(client);
  const effectiveDate = await rateCardEffectiveDate(client, row.rateCardVersion);
  const state = effectiveState(row);
  const remaining = holdSecondsRemaining(row);
  const bookingUnits: BookingUnit[] = units.map((unit) => ({
    serial: unit.serial,
    classId: unit.classId,
    className: unit.className,
    replacementValueCents: unit.replacementValueCents,
    location: locations.get(unit.serial) ?? 'repair',
    checkedOut: unit.checkedOut,
    checkedIn: unit.checkedIn,
    condition: unit.condition,
    damageChargeCents: unit.damageChargeCents,
  }));
  const photoViews: PhotoView[] = photos.map((photo) => ({
    id: photo.id,
    phase: photo.phase,
    serial: photo.serial,
    status: photo.status,
  }));
  const checkout = checkoutBlockers(
    state,
    certificate,
    row.pickupDate,
    row.returnDate,
    row.replacementValueCents,
  );
  const close = closeBlockers(state, units, photos);

  return {
    ref: row.ref,
    state,
    kit: { id: row.kitId, name: row.kitName },
    pickupDate: row.pickupDate,
    returnDate: row.returnDate,
    hireDays: row.hireDays,
    renter: { name: row.renterName, email: row.renterEmail },
    units: bookingUnits,
    replacementValueCents: row.replacementValueCents,
    billableDays: row.billableDays,
    dayRateCents: row.dayRateCents,
    hirePriceCents: row.hirePriceCents,
    depositCents: row.depositCents,
    totalCents: row.totalCents,
    rateCardVersion: row.rateCardVersion,
    rateCardEffectiveDate: effectiveDate,
    holdExpiresAt: state === 'quote' ? (row.holdExpiresAt?.toISOString() ?? null) : null,
    holdSecondsRemaining: remaining,
    confirmable: state === 'quote' && remaining !== null && certificate?.status === 'approved',
    paymentStatus: row.paymentStatus,
    damageCents: row.damageCents,
    refundCents: row.refundCents,
    certificate: certificateView(certificate),
    photos: photoViews,
    checkout: { allowed: checkout.length === 0, blockers: checkout },
    close: { allowed: close.length === 0, blockers: close },
  };
}

export function damageChargeCeilingMessage(depositCents: number): string {
  return `Damage charges cannot exceed the ${formatMoney(depositCents)} deposit`;
}
