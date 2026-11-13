import type { IncomingMessage } from 'node:http';
import { config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { notFound, unitTaken, validation } from '../errors.js';
import { newOpaqueKey } from '../auth.js';
import { requireIdempotencyKey, runIdempotent } from '../idempotency.js';
import {
  checkPickupDate,
  checkReturnDate,
  MESSAGES,
  trimmedName,
  validEmail,
} from '../validate.js';
import {
  classesForKit,
  findKitRecord,
  kitReplacementValueCents,
  type UnitClassRecord,
} from '../../domain/catalogue.js';
import { freeSerialsByClass, lockUnitClaims, type DateRange } from '../../domain/availability.js';
import { activeRates } from '../../domain/ratecards.js';
import { buildBooking, findBookingRow } from '../../domain/bookings.js';
import { billableDaysFor } from '../../shared/pricing.js';
import { daysBetween } from '../../shared/dates.js';
import { readJsonBody } from '../http.js';

const ENDPOINT = 'POST /api/bookings';

interface HoldRequest {
  kitId: string;
  range: DateRange;
  renterName: string;
  renterEmail: string;
  requestedUnits: Map<string, string>;
}

function readRequestedUnits(
  raw: unknown,
  classes: UnitClassRecord[],
  serialsByClass: Map<string, Set<string>>,
): Map<string, string> | 'invalid' {
  if (raw === undefined || raw === null) return new Map();
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid';
  const classIds = new Set(classes.map((unitClass) => unitClass.id));
  const requested = new Map<string, string>();
  for (const [classId, serial] of Object.entries(raw as Record<string, unknown>)) {
    if (!classIds.has(classId)) return 'invalid';
    if (typeof serial !== 'string') return 'invalid';
    if (!(serialsByClass.get(classId)?.has(serial) ?? false)) return 'invalid';
    requested.set(classId, serial);
  }
  return requested;
}

async function serialsByClassFor(classes: UnitClassRecord[]): Promise<Map<string, Set<string>>> {
  const result = await pool.query<{ serial: string; class_id: string }>(
    `SELECT serial, class_id FROM units WHERE class_id = ANY($1)`,
    [classes.map((unitClass) => unitClass.id)],
  );
  const byClass = new Map<string, Set<string>>();
  for (const unitClass of classes) byClass.set(unitClass.id, new Set());
  for (const row of result.rows) byClass.get(row.class_id)?.add(row.serial);
  return byClass;
}

async function readHoldRequest(
  body: Record<string, unknown>,
  classes: UnitClassRecord[],
): Promise<HoldRequest> {
  const kitId = body.kitId as string;
  const fields: Record<string, string> = {};

  const pickupProblem = checkPickupDate(body.pickupDate);
  if (pickupProblem !== null) fields.pickupDate = pickupProblem;
  const returnProblem = checkReturnDate(body.pickupDate, body.returnDate);
  if (returnProblem !== null) fields.returnDate = returnProblem;

  const renter = (
    typeof body.renter === 'object' && body.renter !== null ? body.renter : {}
  ) as Record<string, unknown>;
  const renterName = trimmedName(renter.name);
  if (renterName === null) fields['renter.name'] = MESSAGES.renterName;
  const renterEmail = validEmail(renter.email);
  if (renterEmail === null) fields['renter.email'] = MESSAGES.renterEmail;

  const requestedUnits = readRequestedUnits(
    body.units,
    classes,
    await serialsByClassFor(classes),
  );
  if (requestedUnits === 'invalid') fields.units = MESSAGES.units;

  if (Object.keys(fields).length > 0) throw validation(fields);
  return {
    kitId,
    range: { pickupDate: body.pickupDate as string, returnDate: body.returnDate as string },
    renterName: renterName as string,
    renterEmail: renterEmail as string,
    requestedUnits: requestedUnits as Map<string, string>,
  };
}

interface Assignment {
  classId: string;
  serial: string;
}

/**
 * Assigns one serial per component class: the requested serial, or else the
 * lowest serial of that class free for the dates.
 */
function assignSerials(
  classes: UnitClassRecord[],
  free: Map<string, string[]>,
  requested: Map<string, string>,
): Assignment[] {
  const assignments: Assignment[] = [];
  const claimed = new Set<string>();
  for (const unitClass of classes) {
    const available = (free.get(unitClass.id) ?? []).filter((serial) => !claimed.has(serial));
    const wanted = requested.get(unitClass.id);
    if (wanted !== undefined) {
      if (!available.includes(wanted)) throw unitTaken(wanted, available[0] ?? null);
      assignments.push({ classId: unitClass.id, serial: wanted });
      claimed.add(wanted);
      continue;
    }
    const chosen = available[0];
    if (chosen === undefined) throw unitTaken(null, null);
    assignments.push({ classId: unitClass.id, serial: chosen });
    claimed.add(chosen);
  }
  return assignments;
}

export async function holdKit(
  req: IncomingMessage,
): Promise<{ status: number; body: string }> {
  const requestBody = await readJsonBody(req);
  const body = requestBody.preview();
  const kitId = typeof body?.kitId === 'string' ? body.kitId : null;
  const kit = kitId === null ? null : await findKitRecord(pool, kitId);
  if (kit === null && body !== null) throw notFound();
  const key = requireIdempotencyKey(req);

  return runIdempotent(ENDPOINT, key, '/api/bookings', requestBody.raw, async () => {
    const body = requestBody.parse();
    if (kit === null) throw notFound();
    const classes = await classesForKit(pool, kit.id);
    const request = await readHoldRequest(body, classes);
    const ref = await createHold(kit.id, classes, request);
    const row = await findBookingRow(pool, ref);
    if (row === null) throw new Error(`Booking ${ref} vanished after its hold`);
    return {
      status: 201,
      body: { booking: await buildBooking(pool, row), renterKey: row.renterKey },
    };
  });
}

async function createHold(
  kitId: string,
  classes: UnitClassRecord[],
  request: HoldRequest,
): Promise<string> {
  return withTransaction(async (client) => {
    await lockUnitClaims(client);
    const free = await freeSerialsByClass(client, request.range, null);
    const assignments = assignSerials(classes, free, request.requestedUnits);

    const rates = await activeRates(client);
    const rate = rates.get(kitId);
    if (rate === undefined) throw new Error(`The active rate card has no rate for ${kitId}`);

    const hireDays = daysBetween(request.range.pickupDate, request.range.returnDate);
    const billableDays = billableDaysFor(request.range.pickupDate, hireDays);
    const hirePriceCents = billableDays * rate.dayRateCents;
    const assignedClasses = classes.filter((unitClass) =>
      assignments.some((assignment) => assignment.classId === unitClass.id),
    );

    const refResult = await client.query<{ ref: string }>(
      `SELECT 'NB-' || nextval('booking_ref_seq')::text AS ref`,
    );
    const ref = refResult.rows[0]?.ref;
    if (ref === undefined) throw new Error('Could not issue a booking ref');

    await client.query(
      `INSERT INTO bookings (
         ref, kit_id, state, pickup_date, return_date, hire_days, renter_name, renter_email,
         renter_key, billable_days, day_rate_cents, hire_price_cents, deposit_cents, total_cents,
         replacement_value_cents, rate_card_version, hold_expires_at)
       VALUES ($1, $2, 'quote', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               now() + make_interval(secs => $16))`,
      [
        ref,
        kitId,
        request.range.pickupDate,
        request.range.returnDate,
        hireDays,
        request.renterName,
        request.renterEmail,
        newOpaqueKey(),
        billableDays,
        rate.dayRateCents,
        hirePriceCents,
        rate.depositCents,
        hirePriceCents + rate.depositCents,
        kitReplacementValueCents(assignedClasses),
        rate.version,
        config.holdSeconds,
      ],
    );
    for (const assignment of assignments) {
      await client.query(
        `INSERT INTO booking_units (booking_ref, serial, class_id) VALUES ($1, $2, $3)`,
        [ref, assignment.serial, assignment.classId],
      );
    }
    return ref;
  });
}
