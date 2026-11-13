// The store for bookings: reads, writes and the transition handlers.

import type { PoolClient, QueryResultRow } from 'pg';
import { pool } from '../db.js';
import { insertMovement } from '../schema.js';
import type { Booking, BookingUnit, Certificate, Photo } from '../types.js';


export async function loadBooking(ref: string): Promise<Booking | null> {
  const rows = await pool.query<BookingRow & QueryResultRow>(
    `SELECT ref, state, kit_id AS "kitId", pickup_date AS "pickupDate", return_date AS "returnDate",
            hire_days AS "hireDays", billable_days AS "billableDays", day_rate_cents AS "dayRateCents",
            hire_price_cents AS "hirePriceCents", deposit_cents AS "depositCents", total_cents AS "totalCents",
            rate_card_version AS "rateCardVersion", renter_name AS "renterName", renter_email AS "renterEmail",
            renter_key AS "renterKey", hold_expires_at AS "holdExpiresAt", payment_status AS "paymentStatus",
            damage_cents AS "damageCents", refund_cents AS "refundCents", created_at AS "createdAt",
            confirmed_at AS "confirmedAt", cancelled_at AS "cancelledAt", closed_at AS "closedAt",
            confirmation_mail_at AS "confirmationMailAt", receipt_mail_at AS "receiptMailAt"
       FROM bookings WHERE ref = $1`,
    [ref],
  );
  if (rows.rowCount === 0) {
    return null;
  }
  const units = await loadBookingUnits(ref);
  return mapBooking(rows.rows[0], units);
}

export async function loadBookingUnits(ref: string): Promise<BookingUnit[]> {
  const rows = await pool.query<BookingUnitRow & QueryResultRow>(
    `SELECT serial, class_id AS "classId", checked_out_at AS "checkedOutAt", checked_in_at AS "checkedInAt",
            condition, damage_charge_cents AS "damageChargeCents", checkout_notes AS "checkoutNotes",
            checkin_notes AS "checkinNotes"
       FROM booking_units WHERE ref = $1 ORDER BY serial`,
    [ref],
  );
  return rows.rows.map((row) => ({
    serial: row.serial,
    classId: row.classId,
    checkedOutAt: row.checkedOutAt,
    checkedInAt: row.checkedInAt,
    condition: row.condition,
    damageChargeCents: Number(row.damageChargeCents),
    checkoutNotes: row.checkoutNotes,
    checkinNotes: row.checkinNotes,
  }));
}

export async function loadBookingCertificates(ref: string): Promise<Certificate[]> {
  const rows = await pool.query<CertificateRow & QueryResultRow>(
    `SELECT id, ref, status, uploaded_at AS "uploadedAt", size_bytes AS "sizeBytes", storage_key AS "storageKey",
            coverage_start::text AS "coverageStart", coverage_end::text AS "coverageEnd", limit_cents AS "limitCents",
            loss_payee_named AS "lossPayeeNamed", reason, reviewed_at AS "reviewedAt"
       FROM certificates WHERE ref = $1 ORDER BY uploaded_at DESC`,
    [ref],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    ref: row.ref,
    status: row.status,
    uploadedAt: row.uploadedAt,
    sizeBytes: Number(row.sizeBytes),
    storageKey: row.storageKey,
    coverageStart: row.coverageStart,
    coverageEnd: row.coverageEnd,
    limitCents: row.limitCents === null ? null : Number(row.limitCents),
    lossPayeeNamed: row.lossPayeeNamed,
    reason: row.reason,
    reviewedAt: row.reviewedAt,
  }));
}

export async function loadLatestCertificate(ref: string): Promise<Certificate | null> {
  const all = await loadBookingCertificates(ref);
  return all.length > 0 ? all[0] : null;
}

export async function loadBookingPhotos(ref: string): Promise<Photo[]> {
  const rows = await pool.query<PhotoRow & QueryResultRow>(
    `SELECT id, ref, phase, serial, status, uploaded_at AS "uploadedAt"
       FROM photos WHERE ref = $1 ORDER BY uploaded_at`,
    [ref],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    ref: row.ref,
    phase: row.phase,
    serial: row.serial,
    status: row.status,
    uploadedAt: row.uploadedAt,
  }));
}

export async function effectiveState(booking: Booking, now: Date): Promise<Booking> {
  if (booking.state === 'quote' && booking.holdExpiresAt.getTime() <= now.getTime()) {
    await pool.query('UPDATE bookings SET state = $2 WHERE ref = $1 AND state = $3', [booking.ref, 'expired', 'quote']);
    return { ...booking, state: 'expired' };
  }
  return booking;
}

export async function checkoutUnits(
  client: PoolClient,
  ref: string,
  serials: readonly string[],
): Promise<void> {
  for (const serial of serials) {
    const location = await client.query<{ location: string } & QueryResultRow>(
      `SELECT e.location
         FROM movement_entries e JOIN movements m ON m.id = e.movement_id
        WHERE m.serial = $1 AND e.location <> 'acquired'
        GROUP BY e.location HAVING SUM(e.delta) = 1`,
      [serial],
    );
    const current = location.rows.length > 0 ? location.rows[0].location : 'acquired';
    if (current !== 'shelf') {
      throw new Error(`${serial} is not on the shelf`);
    }
  }
  for (const serial of serials) {
    await client.query('UPDATE booking_units SET checked_out_at = now() WHERE ref = $1 AND serial = $2', [ref, serial]);
    await insertMovement(client, serial, 'checkout', 'shelf', `booking:${ref}`, ref);
  }
}

export async function checkinUnit(
  client: PoolClient,
  ref: string,
  serial: string,
  condition: 'ok' | 'damaged',
  damageChargeCents: number,
  notes: string,
): Promise<void> {
  const location = await client.query<{ location: string } & QueryResultRow>(
    `SELECT e.location
       FROM movement_entries e JOIN movements m ON m.id = e.movement_id
      WHERE m.serial = $1 AND e.location <> 'acquired'
      GROUP BY e.location HAVING SUM(e.delta) = 1`,
    [serial],
  );
  const current = location.rows.length > 0 ? location.rows[0].location : 'acquired';
  if (current !== `booking:${ref}`) {
    throw new Error(`${serial} is not out on this booking`);
  }
  await client.query(
    `UPDATE booking_units SET checked_in_at = now(), condition = $3, damage_charge_cents = $4, checkin_notes = $5
      WHERE ref = $1 AND serial = $2`,
    [ref, serial, condition, damageChargeCents, notes],
  );
  const to = condition === 'damaged' ? 'repair' : 'shelf';
  await insertMovement(client, serial, 'checkin', `booking:${ref}`, to, ref);
}

export async function damageTotal(ref: string): Promise<number> {
  const result = await pool.query<{ total: string | null } & QueryResultRow>(
    'SELECT SUM(damage_charge_cents) AS total FROM booking_units WHERE ref = $1',
    [ref],
  );
  return result.rows.length > 0 && result.rows[0].total !== null ? Number(result.rows[0].total) : 0;
}

export async function listBookings(states: readonly string[]): Promise<Booking[]> {
  const rows = await pool.query<BookingRow & QueryResultRow>(
    `SELECT ref, state, kit_id AS "kitId", pickup_date AS "pickupDate", return_date AS "returnDate",
            hire_days AS "hireDays", billable_days AS "billableDays", day_rate_cents AS "dayRateCents",
            hire_price_cents AS "hirePriceCents", deposit_cents AS "depositCents", total_cents AS "totalCents",
            rate_card_version AS "rateCardVersion", renter_name AS "renterName", renter_email AS "renterEmail",
            renter_key AS "renterKey", hold_expires_at AS "holdExpiresAt", payment_status AS "paymentStatus",
            damage_cents AS "damageCents", refund_cents AS "refundCents", created_at AS "createdAt",
            confirmed_at AS "confirmedAt", cancelled_at AS "cancelledAt", closed_at AS "closedAt",
            confirmation_mail_at AS "confirmationMailAt", receipt_mail_at AS "receiptMailAt"
       FROM bookings WHERE state = ANY($1) ORDER BY pickup_date, ref`,
    [states],
  );
  const bookings: Booking[] = [];
  for (const row of rows.rows) {
    bookings.push(mapBooking(row, await loadBookingUnits(row.ref)));
  }
  return bookings;
}

interface BookingRow {
  ref: string;
  state: Booking['state'];
  kitId: string;
  pickupDate: Date;
  returnDate: Date;
  hireDays: number;
  billableDays: number;
  dayRateCents: string;
  hirePriceCents: string;
  depositCents: string;
  totalCents: string;
  rateCardVersion: number;
  renterName: string;
  renterEmail: string;
  renterKey: string;
  holdExpiresAt: Date;
  paymentStatus: Booking['paymentStatus'];
  damageCents: string;
  refundCents: string;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  closedAt: Date | null;
  confirmationMailAt: Date | null;
  receiptMailAt: Date | null;
}

interface BookingUnitRow {
  serial: string;
  classId: string;
  checkedOutAt: Date | null;
  checkedInAt: Date | null;
  condition: 'ok' | 'damaged' | null;
  damageChargeCents: string;
  checkoutNotes: string;
  checkinNotes: string;
}

interface CertificateRow {
  id: string;
  ref: string;
  status: Certificate['status'];
  uploadedAt: Date;
  sizeBytes: string;
  storageKey: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  limitCents: string | null;
  lossPayeeNamed: boolean | null;
  reason: string | null;
  reviewedAt: Date | null;
}

interface PhotoRow {
  id: string;
  ref: string;
  phase: Photo['phase'];
  serial: string;
  status: Photo['status'];
  uploadedAt: Date;
}

function mapBooking(row: BookingRow, units: BookingUnit[]): Booking {
  return {
    ref: row.ref,
    state: row.state,
    kitId: row.kitId,
    pickupDate: row.pickupDate.toISOString().slice(0, 10),
    returnDate: row.returnDate.toISOString().slice(0, 10),
    hireDays: row.hireDays,
    billableDays: row.billableDays,
    dayRateCents: Number(row.dayRateCents),
    hirePriceCents: Number(row.hirePriceCents),
    depositCents: Number(row.depositCents),
    totalCents: Number(row.totalCents),
    rateCardVersion: row.rateCardVersion,
    renterName: row.renterName,
    renterEmail: row.renterEmail,
    renterKey: row.renterKey,
    holdExpiresAt: row.holdExpiresAt,
    paymentStatus: row.paymentStatus,
    damageCents: Number(row.damageCents),
    refundCents: Number(row.refundCents),
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    cancelledAt: row.cancelledAt,
    closedAt: row.closedAt,
    confirmationMailAt: row.confirmationMailAt,
    receiptMailAt: row.receiptMailAt,
    units,
  };
}
