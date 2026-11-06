import { randomUUID } from 'node:crypto';
import { CARE_FLAG_LABEL, type CareFlag } from '../../shared/types';
import { pressureToBar, twoDecimalsToScaled, type PressureUnit } from '../../shared/units';
import { dateLabel } from '../../shared/zurich';
import { query, withTransaction } from '../db';
import { VALIDATION_MESSAGES, fail, type FieldErrors } from '../http/errors';
import type { Route } from '../http/pipeline';
import {
  CAR_SELECT,
  ENTRY_SELECT,
  carName,
  loadCarRow,
  toCar,
  toEntry,
  type CarRow,
  type EntryRow,
} from '../domain/cars';
import { ownerScope } from './cars';

const BATTERY_LOW_SCALED = 1240n;
const TYRE_TOLERANCE_SCALED = 20n;

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export const careRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/care-round',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      ctx.requireRole('concierge', 'care_technician', 'workshop_lead', 'house_manager');
      const rows = await query<CarRow>(`${CAR_SELECT} where c.status = 'stored'`);
      const entries = await query<EntryRow & { car_id: string }>(
        `select distinct on (e.car_id) e.car_id, e.id, e.at, e.by_user, u.name as by_name,
           e.started, e.battery_v, e.tyre_fl, e.tyre_fr, e.tyre_rl, e.tyre_rr, e.note, e.flags
         from care_entries e join users u on u.id = e.by_user
         order by e.car_id, e.at desc, e.id`,
      );
      const latest = new Map<string, EntryRow>();
      for (const entry of entries) latest.set(entry.car_id, entry);

      const cars = rows
        .map((row) => {
          const car = toCar(row, ctx.now);
          const entry = latest.get(row.id);
          return {
            car: { id: car.id, name: car.name },
            bay_code: car.bay?.code ?? '',
            startup: car.startup,
            last_entry: entry === undefined ? null : toEntry(entry),
          };
        })
        .sort((left, right) => {
          const leftOverdue = left.startup.status === 'overdue' ? 0 : 1;
          const rightOverdue = right.startup.status === 'overdue' ? 0 : 1;
          if (leftOverdue !== rightOverdue) return leftOverdue - rightOverdue;
          return left.bay_code.localeCompare(right.bay_code);
        });
      return { kind: 'json', status: 200, body: { cars } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/cars/:id/care-entries',
    body: 'json',
    session: 'required',
    idempotent: true,
    async handle(ctx) {
      const carId = ctx.params.id ?? '';
      const existing = await loadCarRow(carId, ownerScope(ctx));
      if (existing === null) throw fail.notFound();
      ctx.requireRole('care_technician', 'house_manager');

      return withTransaction(async (tx) => {
        const row = await tx.queryOne<CarRow>(`${CAR_SELECT} where c.id = $1`, [carId]);
        if (row === null) throw fail.notFound();
        if (row.status !== 'stored') throw fail.conflict('car_not_stored');

        const errors: FieldErrors = {};
        if (ctx.idempotencyKey === null) {
          errors.idempotency_key = VALIDATION_MESSAGES.idempotencyKey;
        }
        const started = ctx.body.started === true;

        let batteryBar: string | null = null;
        const batteryRaw = textOf(ctx.body.battery_v);
        if (ctx.body.battery_v !== null && ctx.body.battery_v !== undefined && batteryRaw !== '') {
          const scaled = twoDecimalsToScaled(batteryRaw);
          if (scaled === null || scaled < 0n || scaled > 1600n) {
            errors.battery_v = VALIDATION_MESSAGES.battery;
          } else {
            batteryBar = formatTwo(scaled);
          }
        }

        const tyres = asRecord(ctx.body.tyres);
        let tyreBars: { fl: string; fr: string; rl: string; rr: string } | null = null;
        if (tyres !== null) {
          const unit: PressureUnit = textOf(tyres.unit) === 'psi' ? 'psi' : 'bar';
          const parsed = (['fl', 'fr', 'rl', 'rr'] as const).map((corner) => {
            const bar = pressureToBar(textOf(tyres[corner]), unit);
            const scaled = bar === null ? null : twoDecimalsToScaled(bar);
            return scaled === null || scaled < 50n || scaled > 500n ? null : bar;
          });
          if (parsed.some((value) => value === null)) {
            errors.tyres = VALIDATION_MESSAGES.tyres;
          } else {
            tyreBars = {
              fl: parsed[0] as string,
              fr: parsed[1] as string,
              rl: parsed[2] as string,
              rr: parsed[3] as string,
            };
          }
        }

        const note = typeof ctx.body.note === 'string' ? ctx.body.note : '';
        if (note.length > 500) errors.note = VALIDATION_MESSAGES.note;
        if (!started && batteryBar === null && tyreBars === null && errors.tyres === undefined) {
          errors.entry = VALIDATION_MESSAGES.entry;
        }
        if (Object.keys(errors).length > 0) throw fail.validation(errors);

        const flags: CareFlag[] = [];
        if (batteryBar !== null && (twoDecimalsToScaled(batteryBar) ?? 0n) < BATTERY_LOW_SCALED) {
          flags.push('battery_low');
        }
        if (tyreBars !== null) {
          const spec = twoDecimalsToScaled(row.tyre_spec_bar) ?? 0n;
          const off = Object.values(tyreBars).some((bar) => {
            const value = twoDecimalsToScaled(bar) ?? 0n;
            const difference = value > spec ? value - spec : spec - value;
            return difference > TYRE_TOLERANCE_SCALED;
          });
          if (off) flags.push('tyre_pressure');
        }

        const entryId = randomUUID();
        await tx.query(
          `insert into care_entries (id, car_id, at, by_user, started, battery_v,
             tyre_fl, tyre_fr, tyre_rl, tyre_rr, note, flags)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            entryId,
            carId,
            ctx.now,
            ctx.user().id,
            started,
            batteryBar,
            tyreBars?.fl ?? null,
            tyreBars?.fr ?? null,
            tyreBars?.rl ?? null,
            tyreBars?.rr ?? null,
            note,
            flags,
          ],
        );
        const stored = await tx.queryOne<EntryRow>(`${ENTRY_SELECT} where e.id = $1`, [entryId]);
        if (stored === null) throw fail.notFound();
        const after = await tx.queryOne<CarRow>(`${CAR_SELECT} where c.id = $1`, [carId]);
        if (after === null) throw fail.notFound();
        const car = toCar(after, ctx.now);
        const name = carName(row);
        const base =
          started && car.startup.next_due !== null
            ? `Start-up logged for ${name}. Next start-up due ${dateLabel(car.startup.next_due)}.`
            : `Round entry saved for ${name}.`;
        const message =
          flags.length === 0
            ? base
            : `${base} Flagged: ${flags.map((flag) => CARE_FLAG_LABEL[flag]).join(', ')}.`;
        return {
          kind: 'json',
          status: 201,
          body: { entry: toEntry(stored), startup: car.startup, message },
        };
      });
    },
  },
];

function formatTwo(scaled: bigint): string {
  const digits = scaled.toString().padStart(3, '0');
  return `${digits.slice(0, digits.length - 2)}.${digits.slice(digits.length - 2)}`;
}
