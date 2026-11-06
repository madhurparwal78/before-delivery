import { randomUUID } from 'node:crypto';
import { bayIneligibility, BAY_PLAN } from '../../shared/bays';
import { ITEM_KIND_LABEL, type BayClass, type ItemKind } from '../../shared/types';
import { distanceToKm, pressureToBar, twoDecimalsToScaled } from '../../shared/units';
import { zurichParts } from '../../shared/zurich';
import { query, withTransaction, type Tx } from '../db';
import { VALIDATION_MESSAGES, fail, type FieldErrors } from '../http/errors';
import type { RequestContext, Route } from '../http/pipeline';
import {
  BAY_SELECT,
  CAR_ORDER,
  CAR_SELECT,
  ENTRY_SELECT,
  ITEM_BY_ID_SELECT,
  ITEM_SELECT,
  loadCarRow,
  toBay,
  toCar,
  toEntry,
  toItem,
  toMovement,
  toPhoto,
  toReport,
  type BayRow,
  type CarRow,
  type EntryRow,
  type ItemRow,
  type MovementRow,
  type PhotoRow,
  type ReportRow,
} from '../domain/cars';
import { effectiveStatus, type JobRow } from '../domain/jobs';
import { loadReleaseRows, toRelease } from '../domain/releases';
import { queueSubscriptionEffect } from '../queue';

export function ownerScope(ctx: RequestContext): string | null {
  return ctx.user().role === 'owner' ? ctx.user().id : null;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function wholeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

const UNIQUE_VIOLATION = '23505';

function isBayTaken(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === UNIQUE_VIOLATION &&
    String((error as { constraint?: string }).constraint ?? '').includes('cars_one_per_bay')
  );
}

export const carRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/owners',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      ctx.requireRole('concierge', 'care_technician', 'workshop_lead', 'house_manager');
      const rows = await query<{ id: string; name: string; email: string }>(
        "select id, name, email from users where role = 'owner' order by name",
      );
      return { kind: 'json', status: 200, body: { owners: rows } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/cars',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const owner = ownerScope(ctx);
      const search = ctx.query.get('q');
      const values: (string | null)[] = [];
      const conditions: string[] = [];
      if (owner !== null) {
        values.push(owner);
        conditions.push(`c.owner_id = $${values.length}`);
      }
      if (search !== null && search.trim() !== '') {
        values.push(`%${search.trim()}%`);
        const index = values.length;
        conditions.push(
          `((c.year || ' ' || c.make || ' ' || c.model) ilike $${index}
            or c.registration ilike $${index}
            or u.name ilike $${index})`,
        );
      }
      const where = conditions.length === 0 ? '' : `where ${conditions.join(' and ')}`;
      const rows = await query<CarRow>(`${CAR_SELECT} ${where} ${CAR_ORDER}`, values);
      const cars = rows.map((row) => toCar(row, ctx.now));
      return { kind: 'json', status: 200, body: { cars, total: cars.length } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/cars',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const ownerId = textOf(ctx.body.owner_id);
      const owner = await query<{ id: string }>(
        "select id from users where id = $1 and role = 'owner'",
        [ownerId],
      );
      if (owner.length === 0) throw fail.notFound();
      ctx.requireRole('concierge', 'house_manager');

      const errors: FieldErrors = {};
      const currentYear = zurichParts(ctx.now).year;
      const year = wholeNumber(ctx.body.year);
      if (year === null || year < 1886 || year > currentYear) {
        errors.year = VALIDATION_MESSAGES.year(currentYear);
      }
      const make = textOf(ctx.body.make);
      const model = textOf(ctx.body.model);
      const colour = textOf(ctx.body.colour);
      const registration = textOf(ctx.body.registration);
      if (make.length < 1 || make.length > 60) errors.make = VALIDATION_MESSAGES.text60;
      if (model.length < 1 || model.length > 60) errors.model = VALIDATION_MESSAGES.text60;
      if (colour.length < 1 || colour.length > 60) errors.colour = VALIDATION_MESSAGES.text60;
      if (registration.length < 1 || registration.length > 20) {
        errors.registration = VALIDATION_MESSAGES.registration;
      }
      const lengthMm = wholeNumber(ctx.body.length_mm);
      if (lengthMm === null || lengthMm < 2000 || lengthMm > 7000) {
        errors.length_mm = VALIDATION_MESSAGES.length;
      }
      const widthMm = wholeNumber(ctx.body.width_mm);
      if (widthMm === null || widthMm < 1200 || widthMm > 2600) {
        errors.width_mm = VALIDATION_MESSAGES.width;
      }

      const odometer = asRecord(ctx.body.odometer);
      const odometerUnit = textOf(odometer?.unit) === 'mi' ? 'mi' : 'km';
      const odometerRaw = textOf(odometer?.value);
      const odometerKm =
        /^\d+$/.test(odometerRaw) && Number(odometerRaw) <= 9999999
          ? distanceToKm(odometerRaw, odometerUnit)
          : null;
      if (odometerKm === null) errors['odometer.value'] = VALIDATION_MESSAGES.odometer;

      const tyre = asRecord(ctx.body.tyre_spec);
      const tyreUnit = textOf(tyre?.unit) === 'psi' ? 'psi' : 'bar';
      const tyreBar = pressureToBar(textOf(tyre?.value), tyreUnit);
      const tyreScaled = tyreBar === null ? null : twoDecimalsToScaled(tyreBar);
      if (tyreScaled === null || tyreScaled < 50n || tyreScaled > 500n) {
        errors['tyre_spec.value'] = VALIDATION_MESSAGES.pressure;
      }
      if (Object.keys(errors).length > 0) throw fail.validation(errors);

      const id = `c-${randomUUID()}`;
      await query(
        `insert into cars (id, owner_id, year, make, model, registration, colour, length_mm, width_mm,
           odometer_km, tyre_spec_bar, startup_scheduled, status, stay_seq, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'awaiting_intake',0,$13)`,
        [
          id,
          ownerId,
          year,
          make,
          model,
          registration,
          colour,
          lengthMm,
          widthMm,
          odometerKm,
          tyreBar,
          ctx.body.startup_schedule === true,
          ctx.now,
        ],
      );
      const row = await loadCarRow(id, null);
      if (row === null) throw fail.notFound();
      return { kind: 'json', status: 201, body: { car: toCar(row, ctx.now) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/cars/:id',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const owner = ownerScope(ctx);
      const carId = ctx.params.id ?? '';
      const row = await loadCarRow(carId, owner);
      if (row === null) throw fail.notFound();
      const [items, report, photos, entries, jobs, releases] = await Promise.all([
        query<ItemRow>(ITEM_SELECT, [carId]),
        query<ReportRow>(
          `select r.*, u.name as uploaded_by_name from condition_reports r
           left join users u on u.id = r.uploaded_by
           where r.car_id = $1 and r.completed = true and r.stay_seq = $2`,
          [carId, row.stay_seq],
        ),
        query<PhotoRow>(
          'select * from photos where car_id = $1 order by created_at desc, id',
          [carId],
        ),
        query<EntryRow>(`${ENTRY_SELECT} where e.car_id = $1 order by e.at desc limit 20`, [carId]),
        query<JobRow>(
          `select j.*, '' as owner_name, c.year as car_year, c.make as car_make, c.model as car_model
           from jobs j join cars c on c.id = j.car_id
           where j.car_id = $1 ${owner === null ? '' : "and j.status <> 'draft'"}
           order by j.number`,
          [carId],
        ),
        loadReleaseRows(owner),
      ]);
      const carReleases = await Promise.all(
        releases.filter((release) => release.car_id === carId).map((release) => toRelease(release)),
      );
      return {
        kind: 'json',
        status: 200,
        body: {
          car: {
            ...toCar(row, ctx.now),
            belongings: items.map(toItem),
            condition_report: report[0] === undefined ? null : toReport(report[0]),
            photos: photos.map(toPhoto),
            care_entries: entries.map(toEntry),
            jobs: jobs.map((job) => ({
              id: job.id,
              number: job.number,
              title: job.title,
              status: effectiveStatus(job, ctx.now),
            })),
            releases: carReleases,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/bays',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      ctx.requireRole('concierge', 'care_technician', 'workshop_lead', 'house_manager');
      const rows = await query<BayRow>(BAY_SELECT);
      const fits = ctx.query.get('fits');
      if (fits === null) {
        return { kind: 'json', status: 200, body: { bays: rows.map(toBay) } };
      }
      const car = await loadCarRow(fits, null);
      if (car === null) throw fail.notFound();
      const bays = rows.map((row) => {
        const reason = bayIneligibility(
          {
            id: car.id,
            length_mm: car.length_mm,
            width_mm: car.width_mm,
            bayClass: car.status === 'stored' ? car.bay_class : null,
          },
          {
            length_mm: row.length_mm,
            width_mm: row.width_mm,
            class: row.class,
            occupiedByCarId: row.car_id,
          },
        );
        return { ...toBay(row), eligible: reason === null, reason };
      });
      return { kind: 'json', status: 200, body: { bays } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/cars/:id/bay',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const carId = ctx.params.id ?? '';
      const existing = await loadCarRow(carId, ownerScope(ctx));
      if (existing === null) throw fail.notFound();
      ctx.requireRole('concierge', 'house_manager');
      const bayId = textOf(ctx.body.bay_id);
      const bay = await query<{
        id: string;
        class: BayClass;
        length_mm: number;
        width_mm: number;
      }>('select id, class, length_mm, width_mm from bays where id = $1', [bayId]);
      const target = bay[0];
      if (target === undefined) throw fail.notFound();

      const car = await withTransaction(async (tx) => {
        await tx.lock(`car:${carId}`);
        const row = await tx.queryOne<CarRow>(`${CAR_SELECT} where c.id = $1`, [carId]);
        if (row === null) throw fail.notFound();
        if (row.status === 'released') throw fail.conflict('car_released');
        const occupant = await tx.queryOne<{ id: string }>(
          'select id from cars where bay_id = $1',
          [bayId],
        );
        const reason = bayIneligibility(
          {
            id: row.id,
            length_mm: row.length_mm,
            width_mm: row.width_mm,
            bayClass: row.status === 'stored' ? row.bay_class : null,
          },
          {
            length_mm: target.length_mm,
            width_mm: target.width_mm,
            class: target.class,
            occupiedByCarId: occupant?.id ?? null,
          },
        );
        if (reason === 'occupied') throw fail.conflict('bay_occupied');
        if (reason === 'class_change') throw fail.conflict('bay_class_change');
        if (reason === 'too_small') throw fail.conflict('bay_too_small');

        const firstIntake = row.status === 'awaiting_intake';
        try {
          await tx.query(
            `update cars set bay_id = $2, status = 'stored',
               intake_at = case when $3 then $4::timestamptz else intake_at end,
               stay_seq = case when $3 then stay_seq + 1 else stay_seq end
             where id = $1`,
            [carId, bayId, firstIntake, ctx.now],
          );
        } catch (error) {
          if (isBayTaken(error)) throw fail.conflict('bay_occupied');
          throw error;
        }
        if (firstIntake) {
          await startBayBilling(tx, row, target.class, ctx.now);
        }
        const updated = await tx.queryOne<CarRow>(`${CAR_SELECT} where c.id = $1`, [carId]);
        if (updated === null) throw fail.notFound();
        return updated;
      });
      return { kind: 'json', status: 200, body: { car: toCar(car, ctx.now) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/cars/:id/belongings',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const carId = ctx.params.id ?? '';
      const existing = await loadCarRow(carId, ownerScope(ctx));
      if (existing === null) throw fail.notFound();
      ctx.requireRole('concierge', 'house_manager');

      const item = await withTransaction(async (tx) => {
        await tx.lock(`car:${carId}`);
        const row = await tx.queryOne<{ status: string }>('select status from cars where id = $1', [
          carId,
        ]);
        if (row === null) throw fail.notFound();
        if (row.status === 'released') throw fail.conflict('car_released');

        const errors: FieldErrors = {};
        const kind = textOf(ctx.body.kind) as ItemKind;
        if (!(kind in ITEM_KIND_LABEL)) errors.kind = 'Choose an item kind from the list.';
        const label = textOf(ctx.body.label);
        if (label.length < 1 || label.length > 60) errors.label = VALIDATION_MESSAGES.text60;
        const count = wholeNumber(ctx.body.count);
        if (count === null || count < 0 || count > 20) errors.count = VALIDATION_MESSAGES.count;
        if (Object.keys(errors).length > 0) throw fail.validation(errors);

        const itemId = randomUUID();
        await tx.query(
          'insert into belongings (id, car_id, kind, label, created_at) values ($1,$2,$3,$4,$5)',
          [itemId, carId, kind, label, ctx.now],
        );
        await tx.query(
          "insert into movements (id, item_id, direction, count, at, by_user) values ($1,$2,'in',$3,$4,$5)",
          [randomUUID(), itemId, count, ctx.now, ctx.user().id],
        );
        const rows = await tx.query<ItemRow>(ITEM_BY_ID_SELECT, [itemId]);
        const stored = rows[0];
        if (stored === undefined) throw fail.notFound();
        return toItem(stored);
      });
      return { kind: 'json', status: 201, body: { item } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/belongings/:id/movements',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const itemId = ctx.params.id ?? '';
      const found = await query<{ car_id: string; owner_id: string }>(
        'select i.car_id, c.owner_id from belongings i join cars c on c.id = i.car_id where i.id = $1',
        [itemId],
      );
      const owner = ownerScope(ctx);
      const item = found[0];
      if (item === undefined || (owner !== null && item.owner_id !== owner)) throw fail.notFound();
      ctx.requireRole('concierge', 'house_manager');

      const result = await withTransaction(async (tx) => {
        await tx.lock(`car:${item.car_id}`);
        const car = await tx.queryOne<{ status: string }>('select status from cars where id = $1', [
          item.car_id,
        ]);
        if (car === null) throw fail.notFound();
        if (car.status === 'released') throw fail.conflict('car_released');

        const direction = textOf(ctx.body.direction) === 'out' ? 'out' : 'in';
        const count = wholeNumber(ctx.body.count);
        if (textOf(ctx.body.direction) !== 'in' && textOf(ctx.body.direction) !== 'out') {
          throw fail.validation({ direction: 'Choose a direction from the list.' });
        }
        if (count === null || count < 1 || count > 20) {
          throw fail.validation({ count: VALIDATION_MESSAGES.movementCount });
        }
        const current = await tx.query<ItemRow>(ITEM_BY_ID_SELECT, [itemId]);
        const before = current[0];
        if (before === undefined) throw fail.notFound();
        if (direction === 'out' && count > Number(before.count_in)) {
          throw fail.conflict('insufficient_items');
        }
        const movementId = randomUUID();
        await tx.query(
          'insert into movements (id, item_id, direction, count, at, by_user) values ($1,$2,$3,$4,$5,$6)',
          [movementId, itemId, direction, count, ctx.now, ctx.user().id],
        );
        const after = await tx.query<ItemRow>(ITEM_BY_ID_SELECT, [itemId]);
        const stored = after[0];
        if (stored === undefined) throw fail.notFound();
        const movement = await tx.queryOne<MovementRow>(
          `select m.id, m.direction, m.count, m.at, m.by_user as by_id, u.name as by_name
           from movements m join users u on u.id = m.by_user where m.id = $1`,
          [movementId],
        );
        if (movement === null) throw fail.notFound();
        return { item: toItem(stored), movement: toMovement(movement) };
      });
      return { kind: 'json', status: 201, body: result };
    },
  },
  {
    method: 'GET',
    pattern: '/api/belongings/:id/movements',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      ctx.requireRole('concierge', 'care_technician', 'workshop_lead', 'house_manager');
      const itemId = ctx.params.id ?? '';
      const found = await query<{ id: string }>('select id from belongings where id = $1', [itemId]);
      if (found.length === 0) throw fail.notFound();
      const rows = await query<MovementRow>(
        `select m.id, m.direction, m.count, m.at, m.by_user as by_id, u.name as by_name
         from movements m join users u on u.id = m.by_user
         where m.item_id = $1 order by m.at, m.id`,
        [itemId],
      );
      return { kind: 'json', status: 200, body: { movements: rows.map(toMovement) } };
    },
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Each stored car gets a monthly bay subscription on the plan for its bay class. */
async function startBayBilling(
  tx: Tx,
  car: CarRow,
  bayClass: BayClass,
  now: Date,
): Promise<void> {
  await tx.query(
    `insert into subscriptions (car_id, owner_id, plan, created_at) values ($1,$2,$3,$4)
     on conflict (car_id) do update set plan = $3, cancel_requested = false, cancelled = false`,
    [car.id, car.owner_id, BAY_PLAN[bayClass].plan, now],
  );
  await queueSubscriptionEffect(tx, 'subscription_create', car.id);
}
