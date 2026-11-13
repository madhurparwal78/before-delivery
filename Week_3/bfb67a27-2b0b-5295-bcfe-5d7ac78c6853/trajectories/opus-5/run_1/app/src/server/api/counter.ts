import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { pool, withTransaction } from '../db.js';
import {
  checkoutBlocked,
  closeBlocked,
  notFound,
  photosNotStored,
  storageUnavailable,
  unitAlreadyReturned,
  unitNotOnShelf,
  unitTaken,
  validation,
} from '../errors.js';
import { requireStaff } from '../auth.js';
import { readJsonBody, readMultipartBody } from '../http.js';
import { requireIdempotencyKey, runIdempotent } from '../idempotency.js';
import { invalidateProviderStatus } from '../providerStatus.js';
import { returnReceiptMail } from '../mails.js';
import { accessBooking } from './access.js';
import { asPaymentsOutage } from './settle.js';
import * as killbill from '../../providers/killbill.js';
import * as storage from '../../providers/storage.js';
import { MailUnavailableError, sendMail } from '../../providers/mail.js';
import { assertTransition } from '../../domain/transitions.js';
import {
  bookingPhotos,
  bookingUnitRows,
  buildBooking,
  checkoutBlockers,
  closeBlockers,
  damageChargeCeilingMessage,
  effectiveState,
  findBookingRow,
  latestCertificate,
  listBookingRows,
  serialsWithoutStoredPhoto,
} from '../../domain/bookings.js';
import { freeSerialsByClass, lockUnitClaims } from '../../domain/availability.js';
import {
  bookingLocation,
  currentLocation,
  recordMovement,
  REPAIR,
  SHELF,
} from '../../domain/ledger.js';
import { nonNegativeMoneyCents, optionalText, photoKind } from '../validate.js';
import type { Booking, BookingState, PhotoPhase } from '../../shared/types.js';

const BOOKING_STATES: BookingState[] = [
  'quote',
  'expired',
  'confirmed',
  'cancelled',
  'prepped',
  'out',
  'returned',
  'closed',
];

export async function getBooking(req: IncomingMessage, ref: string): Promise<Booking> {
  const access = await accessBooking(pool, req, ref);
  return buildBooking(pool, access.row);
}

export async function listBookings(
  req: IncomingMessage,
  url: URL,
): Promise<{ bookings: Booking[] }> {
  await requireStaff(req);
  const state = url.searchParams.get('state');
  if (state !== null && !BOOKING_STATES.includes(state as BookingState)) {
    throw validation({ state: 'Unknown booking state' });
  }
  const rows = await listBookingRows(pool, null);
  const bookings = await Promise.all(rows.map((row) => buildBooking(pool, row)));
  return { bookings: bookings.filter((booking) => state === null || booking.state === state) };
}

export async function swapUnit(req: IncomingMessage, ref: string): Promise<Booking> {
  const body = await readJsonBody(req);
  const role = await requireStaff(req);

  return withTransaction(async (client) => {
    const row = await findBookingRow(client, ref, true);
    if (row === null) throw notFound();
    assertTransition('swap', row, role);
    await lockUnitClaims(client);

    const units = await bookingUnitRows(client, ref);
    const from = units.find((unit) => unit.serial === body.from);
    if (from === undefined) {
      const named = typeof body.from === 'string' ? body.from : 'That serial';
      throw validation({ from: `${named} is not on this booking` });
    }
    const replacement = await client.query<{ class_id: string }>(
      `SELECT class_id FROM units WHERE serial = $1`,
      [body.to],
    );
    const replacementClass = replacement.rows[0]?.class_id;
    if (replacementClass !== from.classId || body.to === from.serial) {
      throw validation({ to: 'Pick a unit of the same class' });
    }
    const to = body.to as string;

    const free = await freeSerialsByClass(
      client,
      { pickupDate: row.pickupDate, returnDate: row.returnDate },
      ref,
    );
    const available = free.get(from.classId) ?? [];
    if (!available.includes(to)) {
      throw unitTaken(to, available[0] ?? null);
    }

    await client.query(
      `UPDATE booking_units SET serial = $3 WHERE booking_ref = $1 AND serial = $2`,
      [ref, from.serial, to],
    );
    const swapped = await findBookingRow(client, ref);
    if (swapped === null) throw notFound();
    return buildBooking(client, swapped);
  });
}

export async function prepBooking(req: IncomingMessage, ref: string): Promise<Booking> {
  await readJsonBody(req);
  const role = await requireStaff(req);

  return withTransaction(async (client) => {
    const row = await findBookingRow(client, ref, true);
    if (row === null) throw notFound();
    assertTransition('prep', row, role);
    const units = await bookingUnitRows(client, ref);
    const missing: string[] = [];
    for (const unit of units) {
      if ((await currentLocation(client, unit.serial)) !== SHELF) missing.push(unit.serial);
    }
    if (missing.length > 0) throw unitNotOnShelf(missing);
    await client.query(`UPDATE bookings SET state = 'prepped' WHERE ref = $1`, [ref]);
    const prepped = await findBookingRow(client, ref);
    if (prepped === null) throw notFound();
    return buildBooking(client, prepped);
  });
}

export interface PhotoResponse {
  id: string;
  phase: PhotoPhase;
  serial: string;
  status: 'stored';
  key: string;
}

/** A photo is recorded pending, then only counts once storage acknowledges it. */
export async function uploadPhoto(req: IncomingMessage, ref: string): Promise<PhotoResponse> {
  const multipart = await readMultipartBody(req);
  const role = await requireStaff(req);
  const row = await findBookingRow(pool, ref);
  if (row === null) throw notFound();

  const phase = multipart.fields.phase;
  if (phase !== 'checkout' && phase !== 'checkin') {
    throw validation({ phase: 'Choose checkout or checkin' });
  }
  assertTransition(phase === 'checkout' ? 'checkout_photo' : 'checkin_photo', row, role);

  const units = await bookingUnitRows(pool, ref);
  const serial = multipart.fields.serial;
  if (serial === undefined || !units.some((unit) => unit.serial === serial)) {
    throw validation({ serial: `${serial ?? 'That serial'} is not on this booking` });
  }
  const file = multipart.files.file;
  const kind = file === undefined ? null : photoKind(file.bytes);
  if (file === undefined || kind === null) {
    throw validation({ file: 'Attach a JPEG or PNG photo' });
  }

  const photoId = randomUUID();
  const extension = kind === 'image/jpeg' ? 'jpg' : 'png';
  const key = `photos/${ref}/${phase}/${serial}/${photoId}.${extension}`;
  await pool.query(
    `INSERT INTO photos (id, booking_ref, phase, serial, status, storage_key)
     VALUES ($1, $2, $3, $4, 'pending', $5)`,
    [photoId, ref, phase, serial, key],
  );
  try {
    await storage.putObject(key, file.bytes, kind);
  } catch (error) {
    await pool.query(`UPDATE photos SET status = 'failed' WHERE id = $1`, [photoId]);
    if (error instanceof storage.StorageUnavailableError) {
      invalidateProviderStatus();
      throw storageUnavailable();
    }
    throw error;
  }
  await pool.query(`UPDATE photos SET status = 'stored' WHERE id = $1`, [photoId]);
  return { id: photoId, phase, serial, status: 'stored', key };
}

interface CheckoutUnitRequest {
  serial: string;
  notes: string | null;
}

function readCheckoutUnits(
  body: Record<string, unknown>,
  expected: string[],
): CheckoutUnitRequest[] {
  const raw = body.units;
  if (!Array.isArray(raw)) {
    throw validation({ units: 'List every unit on this booking once' });
  }
  const seen = new Set<string>();
  const units: CheckoutUnitRequest[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      throw validation({ units: 'List every unit on this booking once' });
    }
    const record = entry as Record<string, unknown>;
    const serial = record.serial;
    if (typeof serial !== 'string' || !expected.includes(serial) || seen.has(serial)) {
      throw validation({ units: 'List every unit on this booking once' });
    }
    seen.add(serial);
    const checklist = (
      typeof record.checklist === 'object' && record.checklist !== null ? record.checklist : {}
    ) as Record<string, unknown>;
    if (
      checklist.powersOn !== true ||
      checklist.accessoriesPresent !== true ||
      checklist.cosmeticOk !== true
    ) {
      throw validation({ checklist: 'Every check must be ticked' });
    }
    const notes = optionalText(record.notes, 500);
    if (notes === 'invalid') throw validation({ notes: 'Keep notes to 500 characters' });
    units.push({ serial, notes });
  }
  if (seen.size !== expected.length) {
    throw validation({ units: 'List every unit on this booking once' });
  }
  return units;
}

export async function checkoutBooking(req: IncomingMessage, ref: string): Promise<Booking> {
  const body = await readJsonBody(req);
  const role = await requireStaff(req);

  return withTransaction(async (client) => {
    const row = await findBookingRow(client, ref, true);
    if (row === null) throw notFound();
    assertTransition('checkout', row, role);

    const units = await bookingUnitRows(client, ref);
    const certificate = await latestCertificate(client, ref);
    const blockers = checkoutBlockers(
      effectiveState(row),
      certificate,
      row.pickupDate,
      row.returnDate,
      row.replacementValueCents,
    );
    if (blockers.length > 0) throw checkoutBlocked(blockers);

    const photos = await bookingPhotos(client, ref);
    const withoutPhotos = serialsWithoutStoredPhoto(units, photos, 'checkout');
    if (withoutPhotos.length > 0) throw photosNotStored(withoutPhotos);

    const requested = readCheckoutUnits(
      body,
      units.map((unit) => unit.serial),
    );
    for (const unit of requested) {
      await client.query(
        `UPDATE booking_units SET checked_out = true, checkout_notes = $3
          WHERE booking_ref = $1 AND serial = $2`,
        [ref, unit.serial, unit.notes],
      );
      await recordMovement(client, unit.serial, 'checkout', SHELF, bookingLocation(ref), ref);
    }
    await client.query(`UPDATE bookings SET state = 'out' WHERE ref = $1`, [ref]);
    const out = await findBookingRow(client, ref);
    if (out === null) throw notFound();
    return buildBooking(client, out);
  });
}

export async function checkinUnit(req: IncomingMessage, ref: string): Promise<Booking> {
  const body = await readJsonBody(req);
  const role = await requireStaff(req);

  return withTransaction(async (client) => {
    const row = await findBookingRow(client, ref, true);
    if (row === null) throw notFound();
    assertTransition('checkin', row, role);

    const units = await bookingUnitRows(client, ref);
    const unit = units.find((candidate) => candidate.serial === body.serial);
    if (unit === undefined) {
      const named = typeof body.serial === 'string' ? body.serial : 'That serial';
      throw validation({ serial: `${named} is not on this booking` });
    }
    if (unit.checkedIn) throw unitAlreadyReturned(unit.serial);

    const condition = body.condition;
    if (condition !== 'ok' && condition !== 'damaged') {
      throw validation({ condition: 'Mark the unit OK or damaged' });
    }
    const charge = nonNegativeMoneyCents(body.damageChargeCents ?? 0);
    if (charge === null) throw validation({ damageChargeCents: 'Enter a whole number of cents' });
    if (condition === 'ok' && charge !== 0) {
      throw validation({ damageChargeCents: 'Only damaged units carry a charge' });
    }
    const damageSoFar = units.reduce((total, other) => total + other.damageChargeCents, 0);
    if (damageSoFar + charge > row.depositCents) {
      throw validation({ damageChargeCents: damageChargeCeilingMessage(row.depositCents) });
    }
    const notes = optionalText(body.notes, 500);
    if (notes === 'invalid') throw validation({ notes: 'Keep notes to 500 characters' });

    const destination = condition === 'damaged' ? REPAIR : SHELF;
    await client.query(
      `UPDATE booking_units
          SET checked_in = true, condition = $3, damage_charge_cents = $4, checkin_notes = $5
        WHERE booking_ref = $1 AND serial = $2`,
      [ref, unit.serial, condition, charge, notes],
    );
    await recordMovement(
      client,
      unit.serial,
      'checkin',
      bookingLocation(ref),
      destination,
      ref,
    );
    const remaining = await client.query<{ pending: number }>(
      `SELECT COUNT(*)::int AS pending FROM booking_units
        WHERE booking_ref = $1 AND checked_in = false`,
      [ref],
    );
    if ((remaining.rows[0]?.pending ?? 0) === 0) {
      await client.query(`UPDATE bookings SET state = 'returned' WHERE ref = $1`, [ref]);
    }
    const updated = await findBookingRow(client, ref);
    if (updated === null) throw notFound();
    return buildBooking(client, updated);
  });
}

const CLOSE_ENDPOINT = 'POST /api/bookings/:ref/close';

export async function closeBooking(
  req: IncomingMessage,
  ref: string,
): Promise<{ status: number; body: string }> {
  const body = await readJsonBody(req);
  const role = await requireStaff(req);
  if ((await findBookingRow(pool, ref)) === null) throw notFound();
  const key = requireIdempotencyKey(req);

  return runIdempotent(CLOSE_ENDPOINT, key, `/api/bookings/${ref}/close`, body, async () => ({
    status: 200,
    body: await runClose(ref, role),
  }));
}

async function runClose(ref: string, role: 'owner' | 'prep_tech'): Promise<Booking> {
  const settled = await withTransaction(async (client) => {
    const row = await findBookingRow(client, ref, true);
    if (row === null) throw notFound();
    assertTransition('close', row, role);

    const units = await bookingUnitRows(client, ref);
    const photos = await bookingPhotos(client, ref);
    const blockers = closeBlockers(effectiveState(row), units, photos);
    if (blockers.length > 0) throw closeBlocked(blockers);

    const damageCents = units.reduce((total, unit) => total + unit.damageChargeCents, 0);
    const refundCents = row.depositCents - damageCents;

    const accountId = await accountFor(row.renterEmail, row.renterName);
    if (damageCents > 0) {
      try {
        await killbill.recordDamageInvoice(accountId, damageCents, `Damage · ${ref}`);
      } catch (error) {
        asPaymentsOutage(error);
      }
    }
    if (refundCents > 0) {
      if (row.killbillPaymentId === null) {
        throw new Error(`Booking ${ref} has no recorded payment to refund`);
      }
      try {
        await killbill.recordRefund(row.killbillPaymentId, `${ref}-refund`, refundCents);
      } catch (error) {
        asPaymentsOutage(error);
      }
    }

    await client.query(
      `UPDATE bookings
          SET state = 'closed', damage_cents = $2::bigint, refund_cents = $3::bigint,
              payment_status = CASE WHEN $3::bigint > 0 THEN 'refunded' ELSE payment_status END
        WHERE ref = $1`,
      [ref, damageCents, refundCents],
    );
    return { row, units, damageCents, refundCents };
  });

  await mailReceiptOnce(ref, settled.damageCents, settled.refundCents);
  const closed = await findBookingRow(pool, ref);
  if (closed === null) throw notFound();
  return buildBooking(pool, closed);
}

async function accountFor(email: string, name: string): Promise<string> {
  try {
    return await killbill.ensureRenterAccount(email, name);
  } catch (error) {
    asPaymentsOutage(error);
  }
}

/** The return receipt is sent at most once and is never resent. */
async function mailReceiptOnce(
  ref: string,
  damageCents: number,
  refundCents: number,
): Promise<void> {
  const claim = await pool.query(
    `UPDATE bookings SET receipt_mailed = true WHERE ref = $1 AND receipt_mailed = false`,
    [ref],
  );
  if (claim.rowCount === 0) return;
  const row = await findBookingRow(pool, ref);
  if (row === null) return;
  const units = await bookingUnitRows(pool, ref);
  const mail = returnReceiptMail(row, units, damageCents, refundCents);
  try {
    await sendMail(row.renterEmail, mail.subject, mail.body);
  } catch (error) {
    if (!(error instanceof MailUnavailableError)) throw error;
  }
}
