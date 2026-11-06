import type { Route, RouteContext } from '../router.ts';
import { route } from '../router.ts';
import { ERRORS } from '../errors.ts';
import { asRecord, str, trimmed, num, Validator, text1to60, text1to20 } from '../validation.ts';
import { requireRole, STAFF, CONCIERGE, WORKSHOP } from './guards.ts';
import { lockKey, q, type Tx } from '../db.ts';
import { bayRejectReason } from '../domain/bays.ts';
import { carObject, type CarRow, type ActorRow, projectActor } from '../objects.ts';
import { distanceStored, pressureStored } from '../../shared/units.ts';
import { createHash } from 'node:crypto';
import { readMultipart } from '../httpio.ts';
import { enqueue } from '../queue.ts';
import { isStorageDown } from '../providers/status.ts';
import { zurichSlotLabel, zurichSlotToUtc } from '../../shared/dates.ts';

function bodyOf(rc: RouteContext): Record<string, unknown> {
  return asRecord(rc.body);
}

export interface CarQueryRow {
  id: string;
  owner_id: string;
  year: number;
  make: string;
  model: string;
  registration: string;
  colour: string;
  length_mm: number;
  width_mm: number;
  odometer_km: number;
  tyre_spec_bar: string;
  startup_scheduled: boolean;
  status: string;
  bay_id: string | null;
  bay_code: string | null;
  bay_class: string | null;
  intake_at: string | null;
  released_at: string | null;
  created_at: string;
  bay_subscription_id: string | null;
  bay_billing_charged_through: string | null;
  bay_billing_plan_price: string | null;
  bay_billing_cancel_requested: boolean;
  bay_billing_end_date: string | null;
  owner_name: string;
}

const CAR_SELECT = `
  SELECT c.id, c.owner_id, c.year, c.make, c.model, c.registration, c.colour,
    c.length_mm, c.width_mm, c.odometer_km, c.tyre_spec_bar, c.startup_scheduled,
    c.status, c.bay_id, b.code AS bay_code, b.class AS bay_class,
    c.intake_at, c.released_at, c.created_at,
    c.bay_subscription_id, c.bay_billing_charged_through, c.bay_billing_plan_price,
    c.bay_billing_cancel_requested, c.bay_billing_end_date,
    u.name AS owner_name
  FROM cars c
  LEFT JOIN bays b ON b.id = c.bay_id
  JOIN users u ON u.id = c.owner_id
`;

export async function loadCar(rc: RouteContext, carId: string): Promise<CarQueryRow | null> {
  const rows = await rc.ctx.db.query<CarQueryRow>(`${CAR_SELECT} WHERE c.id = $1`, [carId]);
  return rows[0] ?? null;
}

export async function visibleCar(rc: RouteContext, carId: string): Promise<CarQueryRow> {
  const car = await loadCar(rc, carId);
  if (!car || (rc.viewer.isOwner() && car.owner_id !== rc.viewer.id)) {
    throw ERRORS.notFound();
  }
  return car;
}

/** Visibility check on a given transaction (for idempotent handlers). */
export async function visibleCarTx(rc: RouteContext, tx: Tx | null, carId: string): Promise<CarQueryRow> {
  const rows = await q<CarQueryRow>(rc.ctx.db, tx, `${CAR_SELECT} WHERE c.id = $1`, [carId]);
  const car = rows[0];
  if (!car || (rc.viewer.isOwner() && car.owner_id !== rc.viewer.id)) {
    throw ERRORS.notFound();
  }
  return car;
}

async function lastStartupAt(rc: RouteContext, carId: string): Promise<string | null> {
  const rows = await rc.ctx.db.query<{ at: string }>(
    `SELECT at FROM care_entries WHERE car_id = $1 AND started = TRUE ORDER BY at DESC LIMIT 1`,
    [carId],
  );
  return rows[0]?.at ?? null;
}

async function hasOpenRelease(rc: RouteContext, carId: string): Promise<boolean> {
  const rows = await rc.ctx.db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM releases WHERE car_id = $1 AND status IN ('requested','booked','staged')`,
    [carId],
  );
  return Number(rows[0]?.count ?? '0') > 0;
}

export async function buildCarObject(rc: RouteContext, car: CarQueryRow): Promise<ReturnType<typeof carObject>> {
  return carObject(car as unknown as CarRow, await lastStartupAt(rc, car.id), await hasOpenRelease(rc, car.id), rc.ctx.env, Date.now());
}

export const carRoutes: Route[] = [
  route('GET', '/api/owners', {}, async (rc) => {
    requireRole(rc.viewer, STAFF);
    const rows = await rc.ctx.db.query<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE role = 'owner' ORDER BY name`,
    );
    return { status: 200, body: { owners: rows } };
  }),

  route('GET', '/api/cars', {}, async (rc) => {
    if (rc.viewer.isOwner()) {
      const q = rc.query.get('q') ?? '';
      const rows = await rc.ctx.db.query<CarQueryRow>(
        `${CAR_SELECT} WHERE c.owner_id = $1
         AND ($2 = '' OR c.id IN (
           SELECT c2.id FROM cars c2 JOIN users u2 ON u2.id = c2.owner_id
           WHERE c2.owner_id = $1
             AND (concat(c2.year, ' ', c2.make, ' ', c2.model) ILIKE '%' || $2 || '%'
               OR c2.registration ILIKE '%' || $2 || '%'
               OR u2.name ILIKE '%' || $2 || '%')
         ))
         ORDER BY (b.code IS NULL), b.code, concat(c.year, ' ', c.make, ' ', c.model)`,
        [rc.viewer.id, q],
      );
      const cars = [];
      for (const car of rows) {
        cars.push(await buildCarObject(rc, car));
      }
      return { status: 200, body: { cars, total: cars.length } };
    }
    requireRole(rc.viewer, STAFF);
    const q = rc.query.get('q') ?? '';
    const rows = await rc.ctx.db.query<CarQueryRow>(
      `${CAR_SELECT}
       WHERE ($1 = '' OR concat(c.year, ' ', c.make, ' ', c.model) ILIKE '%' || $1 || '%'
         OR c.registration ILIKE '%' || $1 || '%'
         OR u.name ILIKE '%' || $1 || '%')
       ORDER BY c.created_at DESC`,
      [q],
    );
    const cars = [];
    for (const car of rows) {
      cars.push(await buildCarObject(rc, car));
    }
    return { status: 200, body: { cars, total: cars.length } };
  }),

  route('POST', '/api/cars', {}, async (rc) => {
    requireRole(rc.viewer, CONCIERGE);
    const record = bodyOf(rc);
    const ownerId = str(record['owner_id']).trim();
    const owner = await rc.ctx.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM users WHERE id = $1 AND role = 'owner'`,
      [ownerId],
    );
    if (!owner[0]) throw ERRORS.notFound();

    const v = new Validator();
    const currentYear = new Date().getUTCFullYear();
    const year = num(record['year']);
    v.check(Number.isInteger(year) && year >= 1886 && year <= currentYear, 'year', `Enter a year from 1886 to ${currentYear}.`);
    const make = text1to60(v, 'make', record['make']);
    const model = text1to60(v, 'model', record['model']);
    const registration = text1to20(v, 'registration', record['registration']);
    const colour = text1to60(v, 'colour', record['colour']);
    const length = num(record['length_mm']);
    v.check(Number.isInteger(length) && length >= 2000 && length <= 7000, 'length_mm', 'Enter a length from 2000 to 7000 mm.');
    const width = num(record['width_mm']);
    v.check(Number.isInteger(width) && width >= 1200 && width <= 2600, 'width_mm', 'Enter a width from 1200 to 2600 mm.');

    const odometer = asRecord(record['odometer']);
    const odoValue = odometer['value'];
    const odoUnit = str(odometer['unit']);
    const odoNumber = num(odoValue);
    const odoOk = Number.isFinite(odoNumber) && odoNumber >= 0 && odoNumber <= 9999999
      && String(odoValue ?? '').trim() !== '' && /^\d+(\.\d+)?$/.test(String(odoValue ?? '').trim());
    v.check(odoOk && odoUnit !== '' && odoNumber >= 0 && odoNumber <= 9999999, 'odometer.value', 'Enter a whole odometer reading from 0 to 9999999.');
    let odometerKm = 0;
    if (odoOk) {
      odometerKm = odoUnit === 'mi' ? distanceStored(String(odoValue).trim(), 'mi') : distanceStored(String(odoValue).trim(), 'km');
      if (!Number.isInteger(odometerKm) || odometerKm < 0 || odometerKm > 9999999) {
        v.error('odometer.value', 'Enter a whole odometer reading from 0 to 9999999.');
      }
    }

    const tyre = asRecord(record['tyre_spec']);
    const tyreValue = num(tyre['value']);
    const tyreUnit = str(tyre['unit']);
    const tyreOk = Number.isFinite(tyreValue) && tyreValue >= 0.5 && tyreValue <= 5.0;
    v.check(tyreOk, 'tyre_spec.value', 'Enter a pressure from 0.50 to 5.00 bar.');
    let tyreBar = '';
    if (tyreOk) {
      tyreBar = tyreUnit === 'psi' ? pressureStored(String(tyre['value']), 'psi') : pressureStored(String(tyre['value']), 'bar');
    }

    v.throwIfInvalid();

    const id = `c-${crypto.randomUUID().slice(0, 12)}`;
    await rc.ctx.db.query(
      `INSERT INTO cars (id, owner_id, year, make, model, registration, colour, length_mm, width_mm,
        odometer_km, tyre_spec_bar, startup_scheduled, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'awaiting_intake',now())`,
      [id, ownerId, year, make, model, registration, colour, length, width, odometerKm, tyreBar, record["startup_schedule"] === true],
    );
    const car = await loadCar(rc, id);
    return { status: 201, body: { car: await buildCarObject(rc, car as CarQueryRow) } };
  }),

  route('GET', '/api/cars/{id}', {}, async (rc) => {
    const car = await visibleCar(rc, rc.params['id'] as string);
    if (rc.viewer.isOwner()) {
      // owner detail page
    } else {
      requireRole(rc.viewer, STAFF);
    }
    await refreshBayBilling(rc, car);
    const rows = await rc.ctx.db.query<{
      id: string; kind: string; label: string; count_in: string;
    }>(
      `SELECT bl.id, bl.kind, bl.label,
        COALESCE((SELECT sum(CASE WHEN m.direction = 'in' THEN m.count ELSE -m.count END)
          FROM movements m WHERE m.belonging_id = bl.id), 0)::text AS count_in
       FROM belongings bl WHERE bl.car_id = $1 ORDER BY bl.created_at`,
      [car.id],
    );
    const report = await rc.ctx.db.query<{
      id: string; car_id: string; sha256: string; size_bytes: number; uploaded_at: string; uploaded_by: string;
    }>(
      `SELECT r.id, r.car_id, r.sha256, r.size_bytes, r.uploaded_at, r.uploaded_by_user_id AS uploaded_by
       FROM condition_reports r WHERE r.car_id = $1
       AND r.uploaded_at > COALESCE((SELECT released_at FROM cars WHERE id = $1), 'epoch')
       ORDER BY r.uploaded_at DESC LIMIT 1`,
      [car.id],
    );
    const photos = await rc.ctx.db.query<{
      id: string; car_id: string; kind: string; job_id: string | null;
      content_type: string; size_bytes: number; attached: boolean; created_at: string;
    }>(
      `SELECT p.id, p.car_id, p.kind, p.job_id, p.content_type, p.size_bytes, p.attached, p.created_at
       FROM photos p WHERE p.car_id = $1 AND p.attached = TRUE
       AND p.created_at > COALESCE((SELECT released_at FROM cars WHERE id = $1), 'epoch')
       ORDER BY p.created_at`,
      [car.id],
    );
    const entries = await rc.ctx.db.query<{
      id: string; at: string; by: string; started: boolean; battery_v: string | null;
      tyre_fl: string | null; tyre_fr: string | null; tyre_rl: string | null; tyre_rr: string | null;
      note: string; flags: string[];
    }>(
      `SELECT e.id, e.at, e.by_user_id AS by, e.started, e.battery_v,
        e.tyre_fl, e.tyre_fr, e.tyre_rl, e.tyre_rr, e.note, e.flags
       FROM care_entries e WHERE e.car_id = $1 ORDER BY e.at DESC LIMIT 20`,
      [car.id],
    );
    const jobs = await rc.ctx.db.query<{ id: string; number: string; title: string; status: string }>(
      `SELECT id, number, title, status FROM jobs WHERE car_id = $1 ORDER BY created_at DESC`,
      [car.id],
    );
    const releases = await loadReleasesForCar(rc, car.id);

    const actorIds = [
      report[0]?.uploaded_by,
      ...entries.map((entry) => entry.by),
      ...releases.flatMap((release) => release.events.map((event) => event.by)),
    ].filter(Boolean) as string[];
    const actorMap = await loadActors(rc, actorIds);


    const entryObjects = entries.map((entry) => ({
      id: entry.id,
      at: entry.at,
      by: projectActor(actorMap.get(entry.by) ?? null, rc.viewer),
      started: entry.started,
      battery_v: entry.battery_v,
      tyres_bar: entry.tyre_fl !== null
        ? { fl: entry.tyre_fl, fr: entry.tyre_fr, rl: entry.tyre_rl, rr: entry.tyre_rr }
        : null,
      note: entry.note,
      flags: entry.flags,
    }));

    const visibleJobs = jobs
      .filter((job) => !(rc.viewer.isOwner() && ['draft'].includes(job.status)))
      .map((job) => ({
        ...job,
        status: job.status === 'sent' && rc.viewer.isOwner() ? 'sent' : job.status,
      }));

    return {
      status: 200,
      body: {
        car: {
          ...(await buildCarObject(rc, car)),
          belongings: rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            label: row.label,
            count_in: Number(row.count_in),
          })),
          condition_report: report[0]
            ? {
                id: report[0].id,
                car_id: report[0].car_id,
                sha256: report[0].sha256,
                size_bytes: report[0].size_bytes,
                uploaded_at: report[0].uploaded_at,
                uploaded_by: projectActor(actorMap.get(report[0].uploaded_by) ?? null, rc.viewer),
              }
            : null,
          photos: photos,
          care_entries: entryObjects,
          jobs: visibleJobs,
          releases: releases,
        },
      },
    };
  }),

  route('GET', '/api/bays', {}, async (rc) => {
    requireRole(rc.viewer, STAFF);
    const fits = rc.query.get('fits');
    let fitCar: CarQueryRow | null = null;
    if (fits) {
      fitCar = await visibleCar(rc, fits);
    }
    const rows = await rc.ctx.db.query<{
      id: string; code: string; class: string; length_mm: number; width_mm: number;
      row_index: number; column_index: number; car_id: string | null; car_name: string | null;
    }>(
      `SELECT b.id, b.code, b.class, b.length_mm, b.width_mm, b.row_index, b.column_index,
        c.id AS car_id, CASE WHEN c.id IS NULL THEN NULL
          ELSE concat(c.year, ' ', c.make, ' ', c.model) END AS car_name
       FROM bays b LEFT JOIN cars c ON c.bay_id = b.id
       ORDER BY b.row_index, b.column_index`,
    );
    const bays = rows.map((row) => {
      const base = {
        id: row.id,
        code: row.code,
        class: row.class,
        length_mm: row.length_mm,
        width_mm: row.width_mm,
        row: row.row_index,
        column: row.column_index,
        car: row.car_id ? { id: row.car_id, name: row.car_name ?? '' } : null,
      };
      if (!fitCar) return base;
      const reason = row.car_id && row.car_id !== fitCar.id
        ? 'bay_occupied'
        : bayRejectReason({
            carLengthMm: fitCar.length_mm,
            carWidthMm: fitCar.width_mm,
            bayLengthMm: row.length_mm,
            bayWidthMm: row.width_mm,
            occupiedByCarId: row.car_id,
            carId: fitCar.id,
            movingStoredCar: fitCar.status === 'stored',
            bayClass: row.class as 'standard',
            carCurrentBayClass: fitCar.bay_class as 'standard' | null,
          });
      return {
        ...base,
        eligible: reason === null,
        reason: reason === 'bay_occupied' ? 'occupied' : reason === 'bay_class_change' ? 'class_change' : reason === 'bay_too_small' ? 'too_small' : null,
      };
    });
    return { status: 200, body: { bays } };
  }),

  route('POST', '/api/cars/{id}/bay', {}, async (rc) => {
    const car = await visibleCar(rc, rc.params['id'] as string);
    requireRole(rc.viewer, CONCIERGE);
    const record = bodyOf(rc);
    const bayId = str(record['bay_id']).trim();
    const bay = await rc.ctx.db.query<{ id: string; code: string; class: string; length_mm: number; width_mm: number; car_id: string | null }>(
      'SELECT id, code, class, length_mm, width_mm, (SELECT id FROM cars WHERE bay_id = b.id) AS car_id FROM bays b WHERE id = $1',
      [bayId],
    );
    if (!bay[0]) throw ERRORS.notFound();

    const result = await rc.ctx.db.withTx(async (tx) => {
      await lockKey(tx, 'car', car.id);
      const fresh = (await tx.query(`SELECT status, bay_id FROM cars WHERE id = $1 FOR UPDATE`, [car.id])).rows[0] as
        { status: string; bay_id: string | null } | undefined;
      if (!fresh) throw ERRORS.notFound();
      if (fresh.status === 'released') throw ERRORS.conflict('car_released');
      const bayRow = (await tx.query(
        'SELECT id, code, class, length_mm, width_mm, (SELECT id FROM cars WHERE bay_id = b.id) AS car_id FROM bays b WHERE id = $1 FOR UPDATE',
        [bayId],
      )).rows[0] as { id: string; code: string; class: string; length_mm: number; width_mm: number; car_id: string | null } | undefined;
      if (!bayRow) throw ERRORS.notFound();
      const reason = bayRejectReason({
        carLengthMm: car.length_mm,
        carWidthMm: car.width_mm,
        bayLengthMm: bayRow.length_mm,
        bayWidthMm: bayRow.width_mm,
        occupiedByCarId: bayRow.car_id,
        carId: car.id,
        movingStoredCar: fresh.status === 'stored',
        bayClass: bayRow.class as 'standard',
        carCurrentBayClass: car.bay_class as 'standard' | null,
      });
      if (reason === 'bay_occupied') throw ERRORS.conflict('bay_occupied', { bay: bayRow.code });
      if (reason === 'bay_class_change') throw ERRORS.conflict('bay_class_change', { bay: bayRow.code });
      if (reason === 'bay_too_small') throw ERRORS.conflict('bay_too_small', { bay: bayRow.code });
      const wasAwaiting = fresh.status === 'awaiting_intake';
      await tx.query(
        `UPDATE cars SET bay_id = $2, status = 'stored', intake_at = COALESCE(intake_at, now()) WHERE id = $1`,
        [car.id, bayRow.id],
      );
      return { wasAwaiting, bayCode: bayRow.code };
    });

    if (result.wasAwaiting) {
      await enqueue(rc.ctx.db, 'killbill_account', { owner_id: car.owner_id });
      await enqueue(rc.ctx.db, 'killbill_subscription', { car_id: car.id });
    }
    const updated = await loadCar(rc, car.id);
    return { status: 200, body: { car: await buildCarObject(rc, updated as CarQueryRow) } };
  }),

  route('POST', '/api/cars/{id}/belongings', {}, async (rc) => {
    const car = await visibleCar(rc, rc.params['id'] as string);
    requireRole(rc.viewer, CONCIERGE);
    const record = bodyOf(rc);
    const v = new Validator();
    const kind = str(record['kind']);
    v.check(['key_set', 'cover', 'spare_wheel', 'document'].includes(kind), 'kind', 'Choose an item kind.');
    const label = text1to60(v, 'label', record['label']);
    const count = num(record['count']);
    v.check(Number.isInteger(count) && count >= 0 && count <= 20, 'count', 'Enter a whole number from 0 to 20.');
    v.throwIfInvalid();

    const itemId = `b-${crypto.randomUUID().slice(0, 12)}`;
    await rc.ctx.db.withTx(async (tx) => {
      await lockKey(tx, 'car', car.id);
      const fresh = (await tx.query(`SELECT status FROM cars WHERE id = $1 FOR UPDATE`, [car.id])).rows[0] as { status: string } | undefined;
      if (!fresh) throw ERRORS.notFound();
      if (fresh.status === 'released') throw ERRORS.conflict('car_released');
      await tx.query(
        `INSERT INTO belongings (id, car_id, kind, label, created_at) VALUES ($1,$2,$3,$4,now())`,
        [itemId, car.id, kind, label],
      );
      await tx.query(
        `INSERT INTO movements (id, belonging_id, direction, count, at, by_user_id) VALUES ($1,$2,'in',$3,now(),$4)`,
        [`m-${crypto.randomUUID().slice(0, 12)}`, itemId, count, rc.viewer.id],
      );
    });
    const item = await loadItem(rc, itemId);
    return { status: 201, body: { item } };
  }),

  route('POST', '/api/belongings/{id}/movements', {}, async (rc) => {
    const item = await rc.ctx.db.query<{ id: string; car_id: string; label: string }>(
      `SELECT id, car_id, label FROM belongings WHERE id = $1`,
      [rc.params['id'] as string],
    );
    if (!item[0]) throw ERRORS.notFound();
    const car = await visibleCar(rc, item[0].car_id);
    requireRole(rc.viewer, CONCIERGE);
    const record = bodyOf(rc);
    const v = new Validator();
    const direction = str(record['direction']);
    v.check(direction === 'in' || direction === 'out', 'direction', 'Choose in or out.');
    const count = num(record['count']);
    v.check(Number.isInteger(count) && count >= 1 && count <= 20, 'count', 'Enter a whole number from 1 to 20.');
    v.throwIfInvalid();

    const result = await rc.ctx.db.withTx(async (tx) => {
      await lockKey(tx, 'car', car.id);
      const fresh = (await tx.query(`SELECT status FROM cars WHERE id = $1 FOR UPDATE`, [car.id])).rows[0] as { status: string } | undefined;
      if (!fresh) throw ERRORS.notFound();
      if (fresh.status === 'released') throw ERRORS.conflict('car_released');
      const balance = (await tx.query<{ count_in: string }>(
        `SELECT COALESCE(sum(CASE WHEN m.direction = 'in' THEN m.count ELSE -m.count END), 0)::text AS count_in
         FROM movements m WHERE m.belonging_id = $1`,
        [item[0].id],
      )).rows[0];
      const countIn = Number(balance?.count_in ?? '0');
      if (direction === 'out' && count > countIn) {
        throw ERRORS.conflict('insufficient_items', { label: item[0].label });
      }
      const movementId = `m-${crypto.randomUUID().slice(0, 12)}`;
      await tx.query(
        `INSERT INTO movements (id, belonging_id, direction, count, at, by_user_id) VALUES ($1,$2,$3,$4,now(),$5)`,
        [movementId, item[0].id, direction, count, rc.viewer.id],
      );
      return { movementId, countIn };
    });
    const updated = await loadItem(rc, item[0].id);
    const movement = {
      id: result.movementId,
      direction,
      count,
      at: new Date().toISOString(),
      by: projectActor({ id: rc.viewer.id, name: rc.viewer.name }, rc.viewer),
    };
    return { status: 201, body: { item: updated, movement } };
  }),

  route('GET', '/api/belongings/{id}/movements', {}, async (rc) => {
    const item = await rc.ctx.db.query<{ id: string; car_id: string }>(
      `SELECT id, car_id FROM belongings WHERE id = $1`,
      [rc.params['id'] as string],
    );
    if (!item[0]) throw ERRORS.notFound();
    await visibleCar(rc, item[0].car_id);
    const movements = await rc.ctx.db.query<{
      id: string; direction: string; count: number; at: string; by_user_id: string; by_name: string;
    }>(
      `SELECT m.id, m.direction, m.count, m.at, m.by_user_id, u.name AS by_name
       FROM movements m JOIN users u ON u.id = m.by_user_id
       WHERE m.belonging_id = $1 ORDER BY m.at`,
      [item[0].id],
    );
    return {
      status: 200,
      body: {
        movements: movements.map((row) => ({
          id: row.id,
          direction: row.direction,
          count: row.count,
          at: row.at,
          by: projectActor({ id: row.by_user_id, name: row.by_name }, rc.viewer),
        })),
      },
    };
  }),

  route('POST', '/api/cars/{id}/condition-report', {}, async (rc) => {
    const car = await visibleCar(rc, rc.params['id'] as string);
    requireRole(rc.viewer, CONCIERGE);

    const reportId = `r-${crypto.randomUUID().slice(0, 12)}`;
    const hash = createHash('sha256');
    let size = 0;
    const chunks: Buffer[] = [];
    let claimed = false;
    const releaseClaim = async (): Promise<void> => {
      if (!claimed) return;
      claimed = false;
      try {
        await rc.ctx.db.query(`DELETE FROM stay_claims WHERE car_id = $1`, [car.id]);
      } catch {
        // best effort
      }
      try {
        await rc.ctx.storage.abortUploadsUnder(`cars/${car.id}/`);
      } catch {
        // best effort
      }
    };
    try {
      // Claim the stay before reading the file body.
      await rc.ctx.db.withTx(async (tx) => {
        const inserted = await tx.query(
          `INSERT INTO stay_claims (car_id, claimed_at) VALUES ($1, now())
           ON CONFLICT (car_id) DO NOTHING`,
          [car.id],
        );
        if (inserted.rowCount === 0) {
          throw ERRORS.conflict('report_already_signed');
        }
        const existing = await tx.query<{ id: string }>(
          `SELECT r.id FROM condition_reports r WHERE r.car_id = $1
           AND r.uploaded_at > COALESCE((SELECT intake_at FROM cars WHERE id = $1), 'epoch')`,
          [car.id],
        );
        if (existing.rows.length > 0) {
          throw ERRORS.conflict('report_already_signed');
        }
      });
      claimed = true;

      let sawHeader = false;
      const result = await readMultipart(rc.req, async (chunk) => {
        if (!sawHeader) {
          sawHeader = true;
          if (!chunk.toString('binary').startsWith('%PDF-')) {
            throw ERRORS.validation({ file: 'Upload a PDF.' });
          }
        }
        chunks.push(chunk);
        hash.update(chunk);
        size += chunk.length;
      });
      if (!result.file || size === 0) {
        throw ERRORS.validation({ file: 'Upload a PDF.' });
      }
      if (await isStorageDown(rc.ctx)) {
        await releaseClaim();
        throw ERRORS.storageUnavailable();
      }
      const data = Buffer.concat(chunks);
      const sha256 = hash.digest('hex');
      const uploadedAt = new Date().toISOString();
      await rc.ctx.storage.putObject(`cars/${car.id}/condition-reports/${reportId}.pdf`, data, 'application/pdf');
      await rc.ctx.db.query(
        `INSERT INTO condition_reports (id, car_id, sha256, size_bytes, uploaded_at, uploaded_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [reportId, car.id, sha256, size, uploadedAt, rc.viewer.id],
      );
      await releaseClaim();
      return {
        status: 201,
        body: {
          report: {
            id: reportId,
            car_id: car.id,
            sha256,
            size_bytes: size,
            uploaded_at: uploadedAt,
            uploaded_by: projectActor({ id: rc.viewer.id, name: rc.viewer.name }, rc.viewer),
          },
        },
      };
    } catch (err) {
      await releaseClaim();
      throw err;
    }
  }),

  route('GET', '/api/condition-reports/{id}/file', {}, async (rc) => {
    const report = await rc.ctx.db.query<{ id: string; car_id: string }>(
      `SELECT id, car_id FROM condition_reports WHERE id = $1`,
      [rc.params['id'] as string],
    );
    if (!report[0]) throw ERRORS.notFound();
    await visibleCar(rc, report[0].car_id);
    if (await isStorageDown(rc.ctx)) throw ERRORS.storageUnavailable();
    const object = await rc.ctx.storage.getObject(`cars/${report[0].car_id}/condition-reports/${report[0].id}.pdf`);
    rc.res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': String(object.data.length),
    });
    rc.res.end(object.data);
    return { status: 200 };
  }),

  route('POST', '/api/cars/{id}/photos', {}, async (rc) => {
    const car = await visibleCar(rc, rc.params['id'] as string);
    const result = await readMultipart(rc.req, async () => {});
    const fields = result.fields;
    const kind = fields['kind'] ?? '';
    if (kind === 'intake') {
      requireRole(rc.viewer, CONCIERGE);
    } else if (kind === 'stage') {
      requireRole(rc.viewer, [...WORKSHOP]);
    } else {
      requireRole(rc.viewer, [...CONCIERGE, ...WORKSHOP]);
    }
    if (!result.file) throw ERRORS.validation({ file: 'Upload a JPEG or PNG image.' });
    const file = result.file;
    if (kind !== 'intake' && kind !== 'stage') {
      throw ERRORS.validation({ kind: 'Choose a photo kind.' });
    }
    if (!(file.data.length > 3 && file.data[0] === 0xff && file.data[1] === 0xd8) &&
        !(file.data.length > 4 && file.data[0] === 0x89 && file.data[1] === 0x50)) {
      throw ERRORS.validation({ file: 'Upload a JPEG or PNG image.' });
    }
    if (await isStorageDown(rc.ctx)) throw ERRORS.storageUnavailable();
    let jobId: string | null = null;
    if (kind === 'stage') {
      jobId = fields['job_id'] ?? null;
      if (!jobId) throw ERRORS.validation({ job_id: 'Choose a job.' });
      const job = await rc.ctx.db.query<{ id: string; car_id: string }>('SELECT id, car_id FROM jobs WHERE id = $1', [jobId]);
      if (!job[0] || job[0].car_id !== car.id) throw ERRORS.notFound();
    }
    const contentType = file.data[0] === 0x89 ? 'image/png' : 'image/jpeg';
    const extension = contentType === 'image/png' ? 'png' : 'jpg';
    const photoId = `p-${crypto.randomUUID().slice(0, 12)}`;
    await rc.ctx.storage.putObject(`cars/${car.id}/photos/${photoId}.${extension}`, file.data, contentType);
    await rc.ctx.db.query(
      `INSERT INTO photos (id, car_id, kind, job_id, content_type, size_bytes, attached, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,now())`,
      [photoId, car.id, kind, jobId, contentType, file.data.length],
    );
    return {
      status: 201,
      body: {
        photo: {
          id: photoId,
          car_id: car.id,
          kind,
          job_id: jobId,
          content_type: contentType,
          size_bytes: file.data.length,
          attached: true,
          created_at: new Date().toISOString(),
        },
      },
    };
  }),

  route('GET', '/api/photos/{id}/content', {}, async (rc) => {
    const photo = await rc.ctx.db.query<{ id: string; car_id: string; content_type: string }>(
      `SELECT id, car_id, content_type FROM photos WHERE id = $1`,
      [rc.params['id'] as string],
    );
    if (!photo[0]) throw ERRORS.notFound();
    await visibleCar(rc, photo[0].car_id);
    if (await isStorageDown(rc.ctx)) throw ERRORS.storageUnavailable();
    const extension = photo[0].content_type === 'image/png' ? 'png' : 'jpg';
    const object = await rc.ctx.storage.getObject(`cars/${photo[0].car_id}/photos/${photo[0].id}.${extension}`);
    rc.res.writeHead(200, {
      'Content-Type': object.contentType,
      'Content-Length': String(object.data.length),
    });
    rc.res.end(object.data);
    return { status: 200 };
  }),
];

async function loadItem(rc: RouteContext, itemId: string): Promise<{ id: string; kind: string; label: string; count_in: number } | null> {
  const rows = await rc.ctx.db.query<{ id: string; kind: string; label: string; count_in: string }>(
    `SELECT bl.id, bl.kind, bl.label,
      COALESCE((SELECT sum(CASE WHEN m.direction = 'in' THEN m.count ELSE -m.count END)
        FROM movements m WHERE m.belonging_id = bl.id), 0)::text AS count_in
     FROM belongings bl WHERE bl.id = $1`,
    [itemId],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, kind: row.kind, label: row.label, count_in: Number(row.count_in) };
}

interface ReleaseEventRow {
  id: string;
  release_id: string;
  status: string;
  at: string;
  by_user_id: string | null;
  by_name: string | null;
}

interface ReleaseRecord {
  id: string;
  car_id: string;
  car_name: string;
  owner_id: string;
  owner_name: string;
  slot: string;
  status: string;
  bay_code: string | null;
  events: { status: string; at: string; by: ActorRow | null }[];
}

export interface ReleaseObjectShape {
  id: string;
  car: { id: string; name: string };
  owner: { id: string; name: string };
  slot: string;
  slot_label: string;
  status: string;
  bay_code: string | null;
  held_by: { id: string; number: string; balance: string }[];
  events: { status: string; at: string; by: { id: string; name: string } | null }[];
}

async function loadReleasesForCar(rc: RouteContext, carId: string): Promise<ReleaseObjectShape[]> {
  const releases = await rc.ctx.db.query<{
    id: string; car_id: string; slot: string; status: string; bay_code: string | null;
    car_name: string; owner_id: string; owner_name: string;
  }>(
    `SELECT r.id, r.car_id, r.slot, r.status, r.bay_code,
      concat(c.year, ' ', c.make, ' ', c.model) AS car_name,
      c.owner_id, u.name AS owner_name
     FROM releases r JOIN cars c ON c.id = r.car_id JOIN users u ON u.id = c.owner_id
     WHERE r.car_id = $1 ORDER BY r.created_at DESC`,
    [carId],
  );
  const result = [];
  for (const release of releases) {
    const events = await rc.ctx.db.query<{ status: string; at: string; by_user_id: string | null; by_name: string | null }>(
      `SELECT e.status, e.at, e.by_user_id, u.name AS by_name
       FROM release_events e LEFT JOIN users u ON u.id = e.by_user_id
       WHERE e.release_id = $1 ORDER BY e.at`,
      [release.id],
    );
    result.push({
      id: release.id,
      car: { id: release.car_id, name: release.car_name },
      owner: { id: release.owner_id, name: release.owner_name },
      slot: release.slot,
      slot_label: await slotLabelOf(release.slot),
      status: release.status,
      bay_code: release.bay_code,
      held_by: [],
      events: events.map((event) => ({
        status: event.status,
        at: event.at,
        by: projectActor(event.by_user_id ? { id: event.by_user_id, name: event.by_name ?? '' } : null, rc.viewer),
      })),
    });
  }
  return result;
}

export async function slotLabelOf(slot: string): Promise<string> {
  return zurichSlotLabel(new Date(zurichSlotToUtc(slot)));
}

async function loadActors(rc: RouteContext, ids: string[]): Promise<Map<string, ActorRow>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const rows = await rc.ctx.db.query<{ id: string; name: string }>('SELECT id, name FROM users WHERE id = ANY($1::text[])', [unique]);
  return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name }]));
}

/** Live refresh of one car's bay billing from Kill Bill; non-fatal. */
export async function refreshBayBilling(rc: RouteContext, car: CarQueryRow): Promise<void> {
  if (!car.bay_subscription_id) return;
  try {
    const sub = await rc.ctx.killbill.getSubscription(car.bay_subscription_id);
    const price = car.bay_class ? priceForClass(car.bay_class) : null;
    await rc.ctx.db.query(
      `UPDATE cars SET bay_billing_charged_through = $2, bay_billing_plan_price = COALESCE($3, bay_billing_plan_price) WHERE id = $1`,
      [car.id, sub.chargedThroughDate, price],
    );
    car.bay_billing_charged_through = sub.chargedThroughDate;
    if (price && !car.bay_billing_plan_price) {
      car.bay_billing_plan_price = price;
    }
  } catch {
    // keep the last confirmed values
  }
}

function priceForClass(klass: string): string {
  switch (klass) {
    case 'standard': return '480.00';
    case 'covered_lift': return '690.00';
    case 'sealed_capsule': return '950.00';
    default: return '480.00';
  }
}

