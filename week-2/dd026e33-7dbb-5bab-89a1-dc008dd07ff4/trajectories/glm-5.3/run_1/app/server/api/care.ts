import type { Route, RouteContext } from '../router.ts';
import { route } from '../router.ts';
import { ERRORS } from '../errors.ts';
import { asRecord, str, trimmed, num, Validator, requireRange } from '../validation.ts';
import { requireRole, STAFF, TECHNICIAN } from './guards.ts';
import { lockKey } from '../db.ts';
import { careFlags, startupState, FLAG_LABELS } from '../domain/care.ts';
import { zurichDateISO } from '../../shared/dates.ts';
import { pressureStored } from '../../shared/units.ts';
import { visibleCar, visibleCarTx, type CarQueryRow } from './cars.ts';
import { roundEntryMessage } from '../../shared/copy.ts';
import { withIdempotency, requireIdempotencyKey } from '../idemwrap.ts';

function bodyOf(rc: RouteContext): Record<string, unknown> {
  return asRecord(rc.body);
}

export interface StartupObject {
  scheduled: boolean;
  last_at: string | null;
  next_due: string | null;
  status: string;
}

export async function roundRow(rc: RouteContext, car: CarQueryRow): Promise<{
  car: { id: string; name: string };
  bay_code: string;
  startup: StartupObject;
  last_entry: Record<string, unknown> | null;
}> {
  const last = await rc.ctx.db.query<{
    id: string; at: string; by: string; by_name: string; started: boolean; battery_v: string | null;
    tyre_fl: string | null; tyre_fr: string | null; tyre_rl: string | null; tyre_rr: string | null;
    note: string; flags: string[];
  }>(
    `SELECT e.id, e.at, e.by_user_id AS by, u.name AS by_name, e.started, e.battery_v,
      e.tyre_fl, e.tyre_fr, e.tyre_rl, e.tyre_rr, e.note, e.flags
     FROM care_entries e LEFT JOIN users u ON u.id = e.by_user_id
     WHERE e.car_id = $1 ORDER BY e.at DESC LIMIT 1`,
    [car.id],
  );
  const lastEntry = last[0];
  return {
    car: { id: car.id, name: `${car.year} ${car.make} ${car.model}` },
    bay_code: car.bay_code ?? '',
    startup: await startupOf(rc, car),
    last_entry: lastEntry
      ? {
          id: lastEntry.id,
          at: lastEntry.at,
          by: { id: lastEntry.by, name: lastEntry.by_name },
          started: lastEntry.started,
          battery_v: lastEntry.battery_v,
          tyres_bar: lastEntry.tyre_fl !== null
            ? { fl: lastEntry.tyre_fl, fr: lastEntry.tyre_fr, rl: lastEntry.tyre_rl, rr: lastEntry.tyre_rr }
            : null,
          note: lastEntry.note,
          flags: lastEntry.flags,
        }
      : null,
  };
}

export async function startupOf(rc: RouteContext, car: CarQueryRow): Promise<StartupObject> {
  const last = await rc.ctx.db.query<{ at: string }>(
    `SELECT at FROM care_entries WHERE car_id = $1 AND started = TRUE ORDER BY at DESC LIMIT 1`,
    [car.id],
  );
  if (!car.startup_scheduled) {
    return { scheduled: false, last_at: last[0]?.at ?? null, next_due: null, status: 'not_scheduled' };
  }
  if (car.intake_at === null && last.length === 0) {
    return { scheduled: true, last_at: null, next_due: null, status: 'ok' };
  }
  return startupState(true, last[0]?.at ?? null, car.intake_at, rc.ctx.env.timers.startupOverdueSeconds, Date.now(), (ms) => zurichDateISO(new Date(ms)));
}

export const careRoutes: Route[] = [
  route('GET', '/api/care-round', {}, async (rc) => {
    requireRole(rc.viewer, STAFF);
    const cars = await rc.ctx.db.query<CarQueryRow>(
      `SELECT c.id, c.owner_id, c.year, c.make, c.model, c.registration, c.colour,
        c.length_mm, c.width_mm, c.odometer_km, c.tyre_spec_bar, c.startup_scheduled,
        c.status, c.bay_id, b.code AS bay_code, b.class AS bay_class,
        c.intake_at, c.released_at, c.created_at,
        c.bay_subscription_id, c.bay_billing_charged_through, c.bay_billing_plan_price,
        c.bay_billing_cancel_requested, c.bay_billing_end_date,
        u.name AS owner_name
       FROM cars c
       LEFT JOIN bays b ON b.id = c.bay_id
       JOIN users u ON u.id = c.owner_id
       WHERE c.status = 'stored'
       ORDER BY b.code`,
    );
    const rows = [];
    for (const car of cars) {
      rows.push(await roundRow(rc, car));
    }
    const typed: { car: { id: string; name: string }; bay_code: string; startup: StartupObject; last_entry: Record<string, unknown> | null }[] = rows as never;
    typed.sort((a, b) => {
      const aOverdue = a.startup.status === 'overdue' ? 0 : 1;
      const bOverdue = b.startup.status === 'overdue' ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      return a.bay_code.localeCompare(b.bay_code);
    });
    return { status: 200, body: { cars: typed } };
  }),

  route('POST', '/api/cars/{id}/care-entries', {}, async (rc) => {
    return withIdempotency(rc, 'POST:/api/cars/{id}/care-entries', async (tx) => {
      const car = await visibleCarTx(rc, tx, rc.params['id'] as string);
      requireRole(rc.viewer, TECHNICIAN);
      const record = bodyOf(rc);
      const v = new Validator();
      const started = record['started'] === true;
      const batteryRaw = record['battery_v'];
      const battery =
        batteryRaw === null || batteryRaw === undefined || String(batteryRaw).trim() === ''
          ? null
          : String(batteryRaw).trim();
      const tyresRaw = record['tyres'];
      const tyres = asRecord(tyresRaw);
      const tyreUnit = str(tyres['unit']);
      const hasTyres =
        tyresRaw !== null &&
        tyresRaw !== undefined &&
        Object.keys(tyres).length > 0 &&
        ['fl', 'fr', 'rl', 'rr'].some((key) => str(tyres[key]).trim() !== '');

      if (!started && battery === null && !hasTyres) {
        v.error('entry', 'Record a start-up, a battery voltage or tyre pressures.');
      }
      let batteryValue: string | null = null;
      if (battery !== null) {
        const value = num(battery);
        if (requireRange(v, 'battery_v', value, 0, 16, 'Enter a voltage from 0.00 to 16.00 V.')) {
          batteryValue = Number(battery).toFixed(2);
        }
      }
      let tyreValues: { fl: string; fr: string; rl: string; rr: string } | null = null;
      if (hasTyres) {
        const fl = str(tyres['fl']).trim();
        const fr = str(tyres['fr']).trim();
        const rl = str(tyres['rl']).trim();
        const rr = str(tyres['rr']).trim();
        const allPresent = fl !== '' && fr !== '' && rl !== '' && rr !== '';
        if (!allPresent) {
          v.error('tyres', 'Enter all four tyres from 0.50 to 5.00 bar.');
        } else {
          const values = [num(fl), num(fr), num(rl), num(rr)];
          if (values.every((value) => Number.isFinite(value) && value >= 0.5 && value <= 5.0)) {
            tyreValues = {
              fl: tyreUnit === 'psi' ? pressureStored(fl, 'psi') : pressureStored(fl, 'bar'),
              fr: tyreUnit === 'psi' ? pressureStored(fr, 'psi') : pressureStored(fr, 'bar'),
              rl: tyreUnit === 'psi' ? pressureStored(rl, 'psi') : pressureStored(rl, 'bar'),
              rr: tyreUnit === 'psi' ? pressureStored(rr, 'psi') : pressureStored(rr, 'bar'),
            };
          } else {
            v.error('tyres', 'Enter all four tyres from 0.50 to 5.00 bar.');
          }
        }
      }
      const note = str(record['note']);
      v.check(note.length <= 500, 'note', 'Keep the note under 500 characters.');
      v.throwIfInvalid();

      const flags = careFlags({
        started,
        battery_v: batteryValue,
        tyres: tyreValues,
        tyreSpecBar: car.tyre_spec_bar,
      });

      requireIdempotencyKey(rc);
      await lockKey(tx, 'car', car.id);
      const fresh = (
        await tx.query(`SELECT status FROM cars WHERE id = $1 FOR UPDATE`, [car.id])
      ).rows[0] as { status: string } | undefined;
      if (!fresh) throw ERRORS.notFound();
      if (fresh.status !== 'stored') throw ERRORS.conflict('car_not_stored');
      const entryId = `ce-${crypto.randomUUID().slice(0, 12)}`;
      await tx.query(
        `INSERT INTO care_entries (id, car_id, at, by_user_id, started, battery_v, tyre_fl, tyre_fr, tyre_rl, tyre_rr, note, flags)
         VALUES ($1,$2,now(),$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          entryId, car.id, rc.viewer.id, started, batteryValue,
          tyreValues?.fl ?? null, tyreValues?.fr ?? null, tyreValues?.rl ?? null, tyreValues?.rr ?? null,
          note, flags,
        ],
      );

      const updated = (
        await tx.query<CarQueryRow>(
          `SELECT c.id, c.owner_id, c.year, c.make, c.model, c.registration, c.colour,
            c.length_mm, c.width_mm, c.odometer_km, c.tyre_spec_bar, c.startup_scheduled,
            c.status, c.bay_id, b.code AS bay_code, b.class AS bay_class,
            c.intake_at, c.released_at, c.created_at,
            c.bay_subscription_id, c.bay_billing_charged_through, c.bay_billing_plan_price,
            c.bay_billing_cancel_requested, c.bay_billing_end_date,
            u.name AS owner_name
           FROM cars c LEFT JOIN bays b ON b.id = c.bay_id JOIN users u ON u.id = c.owner_id
           WHERE c.id = $1`,
          [car.id],
        )
      ).rows[0];
      const carName = `${updated.year} ${updated.make} ${updated.model}`;
      const lastStartup = (
        await tx.query<{ at: string }>(
          `SELECT at FROM care_entries WHERE car_id = $1 AND started = TRUE ORDER BY at DESC LIMIT 1`,
          [car.id],
        )
      ).rows;
      const startupAfter = !car.startup_scheduled
        ? { scheduled: false, last_at: lastStartup[0]?.at ?? null, next_due: null, status: 'not_scheduled' }
        : startupState(true, lastStartup[0]?.at ?? null, car.intake_at, rc.ctx.env.timers.startupOverdueSeconds, Date.now(), (ms) => zurichDateISO(new Date(ms)));
      const message = roundEntryMessage(
        carName,
        started,
        startupAfter.next_due ? formatZurich(startupAfter.next_due) : null,
        flags.map((flag) => FLAG_LABELS[flag]),
      );
      return {
        status: 201,
        body: {
          entry: {
            id: entryId,
            at: new Date().toISOString(),
            by: { id: rc.viewer.id, name: rc.viewer.name },
            started,
            battery_v: batteryValue,
            tyres_bar: tyreValues,
            note,
            flags,
          },
          startup: startupAfter,
          message,
        },
      };
    });
  }),
];

function formatZurich(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}
