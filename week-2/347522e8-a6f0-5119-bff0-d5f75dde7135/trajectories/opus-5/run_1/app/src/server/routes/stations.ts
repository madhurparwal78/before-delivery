/** The station board, effective-dated settings and maintenance blocks. */

import { db, transaction, pgErrorCode, EXCLUSION_VIOLATION } from '../db.js';
import * as errors from '../http/errors.js';
import { json, empty, type Route, type RouteResult, type SessionContext } from '../http/router.js';
import { requireResolved } from '../http/resolve.js';
import { Validator } from '../http/validate.js';
import { isoInstant, kitchenToday, nowMs } from '../domain/clock.js';
import { lockRenterHours, recordMovement } from '../domain/ledger.js';
import { occupiedEnd, type OccupiedRange } from '../domain/occupancy.js';
import { describeConflict } from '../domain/occupancy.js';
import { settingsInForce, upcomingSettings, type SettingsRow } from '../domain/stationSettings.js';
import { expireDueHolds } from '../jobs/holdExpiry.js';
import { bookingDisplacedMail, queueNotification } from '../services/notifications.js';
import {
  KITCHEN_TIME_ZONE,
  MINUTE_MS,
  endOfKitchenDay,
  isDateString,
  isHhmm,
  startOfKitchenDay,
} from '../../shared/kitchenTime.js';
import { resolveSpan } from '../../shared/pricing.js';
import { timeDoesNotExist } from '../../shared/copy.js';
import type { BlockKind, StationBlock } from '../../shared/types.js';
import type { StationRow } from '../rows.js';

const ALL_ROLES = ['operator', 'shift_lead', 'renter'] as const;
const STAFF = ['operator', 'shift_lead'] as const;

/** `date` defaults to the server's kitchen date, which is what every screen calls today. */
function requestedDate(query: URLSearchParams): string {
  const raw = query.get('date');
  if (raw === null || raw === '') return kitchenToday();
  if (!isDateString(raw)) Validator.one('date', 'Enter a date as YYYY-MM-DD.');
  return raw;
}

interface BlockRow {
  kind: BlockKind;
  start_hhmm: string;
  end_hhmm: string;
  starts_at: Date;
  ends_at: Date;
  buffer_minutes: number;
  station_id: string;
  booking_id: string | null;
  renter_id: string | null;
  renter_business_name: string | null;
}

async function dayBlocks(date: string): Promise<BlockRow[]> {
  const dayStart = isoInstant(startOfKitchenDay(date));
  const dayEnd = isoInstant(endOfKitchenDay(date));
  return db.query<BlockRow>(
    `SELECT CASE WHEN b.status = 'hold' THEN 'hold' ELSE 'booking' END::text AS kind,
            b.start_hhmm, b.end_hhmm, b.starts_at, b.ends_at, b.buffer_minutes, b.station_id,
            b.id AS booking_id, b.renter_id, r.business_name AS renter_business_name
       FROM bookings b
       JOIN renters r ON r.id = b.renter_id
      WHERE b.status IN ('confirmed','checked_in','completed')
         OR (b.status = 'hold' AND b.hold_expires_at > now())
     UNION ALL
     SELECT 'maintenance'::text AS kind, m.start_hhmm, m.end_hhmm, m.starts_at, m.ends_at,
            0 AS buffer_minutes, m.station_id, NULL AS booking_id, NULL AS renter_id,
            NULL AS renter_business_name
       FROM maintenance_blocks m`,
  ).then((rows) =>
    rows.filter((row) => {
      const occupied = row.ends_at.getTime() + row.buffer_minutes * MINUTE_MS;
      return row.starts_at.toISOString() < dayEnd && isoInstant(occupied) > dayStart;
    }),
  );
}

/** Every occupied range on a station, used by the conflict rules. */
export async function stationOccupancy(stationId: string): Promise<OccupiedRange[]> {
  const rows = await db.query<{ kind: BlockKind; starts_at: Date; ends_at: Date; buffer_minutes: number }>(
    `SELECT CASE WHEN b.status = 'hold' THEN 'hold' ELSE 'booking' END::text AS kind,
            b.starts_at, b.ends_at, b.buffer_minutes
       FROM bookings b
      WHERE b.station_id = $1
        AND (b.status IN ('confirmed','checked_in','completed')
             OR (b.status = 'hold' AND b.hold_expires_at > now()))
     UNION ALL
     SELECT 'maintenance'::text AS kind, m.starts_at, m.ends_at, 0 AS buffer_minutes
       FROM maintenance_blocks m WHERE m.station_id = $1`,
    [stationId],
  );
  return rows.map((row) => ({
    kind: row.kind === 'maintenance' ? 'maintenance' : 'booking',
    startMs: row.starts_at.getTime(),
    ownEndMs: row.ends_at.getTime(),
    endMs: occupiedEnd(row.ends_at.getTime(), row.buffer_minutes),
  }));
}

async function board(context: SessionContext): Promise<RouteResult> {
  const date = requestedDate(context.query);
  const today = kitchenToday();
  const callerRenterId = context.principal.renterId;
  const isStaff = context.principal.role !== 'renter';

  const stations = await db.query<StationRow>(
    'SELECT id, name, sort_order FROM stations ORDER BY sort_order',
  );
  const settings = await db.query<SettingsRow>(
    `SELECT station_id, effective_from, hour_weight, off_peak_percent,
            overage_usd_per_hour::text AS overage_usd_per_hour, buffer_minutes
       FROM station_settings`,
  );
  const blocks = await dayBlocks(date);

  return json(200, {
    date,
    time_zone: KITCHEN_TIME_ZONE,
    server_now: isoInstant(nowMs()),
    stations: stations.map((station) => {
      const own = settings.filter((row) => row.station_id === station.id);
      const inForce = settingsInForce(own, today);
      if (!inForce) throw new Error(`station ${station.id} has no settings in force`);
      return {
        id: station.id,
        name: station.name,
        hour_weight: inForce.hour_weight,
        off_peak_percent: inForce.off_peak_percent,
        overage_usd_per_hour: inForce.overage_usd_per_hour,
        buffer_minutes: inForce.buffer_minutes,
        upcoming_settings: upcomingSettings(own, today),
        blocks: blocks
          .filter((row) => row.station_id === station.id)
          .map((row): StationBlock => {
            const mine = callerRenterId !== null && row.renter_id === callerRenterId;
            const visible = isStaff || mine;
            return {
              kind: row.kind,
              start: row.start_hhmm,
              end: row.end_hhmm,
              starts_at: row.starts_at.toISOString(),
              ends_at: row.ends_at.toISOString(),
              buffer_ends_at: isoInstant(
                row.ends_at.getTime() + row.buffer_minutes * MINUTE_MS,
              ),
              mine,
              booking_id: visible ? row.booking_id : null,
              renter_business_name: visible ? row.renter_business_name : null,
            };
          })
          .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)),
      };
    }),
  });
}

async function saveSettings(context: SessionContext): Promise<RouteResult> {
  const station = requireResolved(context.resolved, 'station');
  const validator = new Validator(context.body);
  const effectiveFromRaw = context.body['effective_from'];
  const today = kitchenToday();
  let effectiveFrom = today;
  if (!isDateString(effectiveFromRaw)) {
    validator.fail('effective_from', 'Enter a date as YYYY-MM-DD.');
  } else if (effectiveFromRaw < today) {
    validator.fail('effective_from', 'Enter today or a later date.');
  } else {
    effectiveFrom = effectiveFromRaw;
  }
  const hourWeight = validator.integer('hour_weight', 1, 3);
  const offPeakPercent = validator.integer('off_peak_percent', 50, 100);
  if (!validator.hasFailed('off_peak_percent') && offPeakPercent % 10 !== 0) {
    validator.fail('off_peak_percent', 'Enter 50, 60, 70, 80, 90 or 100.');
  }
  const overageRate = validator.money('overage_usd_per_hour', '0.00', '500.00');
  const bufferMinutes = validator.integer('buffer_minutes', 0, 120);
  if (!validator.hasFailed('buffer_minutes') && bufferMinutes % 15 !== 0) {
    validator.fail('buffer_minutes', 'Enter 0 to 120 minutes in steps of 15.');
  }
  validator.done();

  const saved = await db.one<SettingsRow>(
    `INSERT INTO station_settings
       (station_id, effective_from, hour_weight, off_peak_percent, overage_usd_per_hour, buffer_minutes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (station_id, effective_from) DO UPDATE SET
       hour_weight = EXCLUDED.hour_weight,
       off_peak_percent = EXCLUDED.off_peak_percent,
       overage_usd_per_hour = EXCLUDED.overage_usd_per_hour,
       buffer_minutes = EXCLUDED.buffer_minutes
     RETURNING station_id, effective_from, hour_weight, off_peak_percent,
               overage_usd_per_hour::text AS overage_usd_per_hour, buffer_minutes`,
    [station.id, effectiveFrom, hourWeight, offPeakPercent, overageRate, bufferMinutes],
  );
  return json(201, { settings: saved });
}

interface DisplacedRow {
  id: string;
  renter_id: string;
  renter_email: string;
  date: string;
  start_hhmm: string;
  end_hhmm: string;
  minutes_debited: number;
}

async function blockStation(context: SessionContext): Promise<RouteResult> {
  const station = requireResolved(context.resolved, 'station');
  const validator = new Validator(context.body);
  const dateRaw = context.body['date'];
  if (!isDateString(dateRaw)) validator.fail('date', 'Enter a date as YYYY-MM-DD.');
  const startRaw = context.body['start'];
  if (!isHhmm(startRaw)) validator.fail('start', 'Enter a time on a 15-minute mark.');
  const endRaw = context.body['end'];
  if (!isHhmm(endRaw, true)) validator.fail('end', 'Enter a time on a 15-minute mark.');
  const reason = validator.text('reason', 1, 200);
  validator.done();

  const date = dateRaw as string;
  const start = startRaw as string;
  const end = endRaw as string;
  const span = resolveSpan(date, start, end);
  if (span.kind === 'skipped') Validator.one(span.field, timeDoesNotExist(date));
  if (span.endMs <= span.startMs) Validator.one('end', 'Enter an end after the start.');

  try {
    return await transaction(async (tx) => {
      await expireDueHolds(tx);

      const inUse = await tx.maybeOne<{ id: string }>(
        `SELECT b.id FROM bookings b
          WHERE b.station_id = $1 AND b.status = 'checked_in'
            AND b.starts_at < $3
            AND b.ends_at + make_interval(mins => b.buffer_minutes) > $2
          LIMIT 1`,
        [station.id, new Date(span.startMs), new Date(span.endMs)],
      );
      if (inUse) throw errors.stationInUse();

      const clashingBlock = await tx.maybeOne<{ starts_at: Date; ends_at: Date }>(
        `SELECT starts_at, ends_at FROM maintenance_blocks
          WHERE station_id = $1 AND starts_at < $3 AND ends_at > $2
          ORDER BY starts_at LIMIT 1`,
        [station.id, new Date(span.startMs), new Date(span.endMs)],
      );
      if (clashingBlock) {
        const details = describeConflict(date, span.startMs, span.endMs, 0, [
          {
            kind: 'maintenance',
            startMs: clashingBlock.starts_at.getTime(),
            ownEndMs: clashingBlock.ends_at.getTime(),
            endMs: clashingBlock.ends_at.getTime(),
          },
        ]);
        if (details) throw errors.slotConflict(date, details);
      }

      const displaced = await tx.query<DisplacedRow>(
        `SELECT b.id, b.renter_id, r.email AS renter_email, b.date, b.start_hhmm, b.end_hhmm,
                b.minutes_debited
           FROM bookings b
           JOIN renters r ON r.id = b.renter_id
          WHERE b.station_id = $1 AND b.status IN ('hold','confirmed')
            AND b.starts_at < $3
            AND b.ends_at + make_interval(mins => b.buffer_minutes) > $2
          ORDER BY b.starts_at
          FOR UPDATE OF b`,
        [station.id, new Date(span.startMs), new Date(span.endMs)],
      );

      for (const renterId of new Set(displaced.map((row) => row.renter_id))) {
        await lockRenterHours(tx, renterId);
      }
      for (const booking of displaced) {
        await tx.query("UPDATE bookings SET status = 'displaced' WHERE id = $1", [booking.id]);
        await tx.query('DELETE FROM station_occupancy WHERE booking_id = $1', [booking.id]);
        await recordMovement(tx, {
          renterId: booking.renter_id,
          kind: 'displacement_credit',
          minutes: booking.minutes_debited,
          bookingId: booking.id,
          note: reason,
        });
        await queueNotification(
          tx,
          bookingDisplacedMail(
            booking.renter_email,
            station.name,
            booking.date,
            booking.start_hhmm,
            booking.end_hhmm,
            booking.minutes_debited,
            reason,
          ),
        );
      }

      const block = await tx.one<{ id: string }>(
        `INSERT INTO maintenance_blocks
           (station_id, date, start_hhmm, end_hhmm, starts_at, ends_at, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [station.id, date, start, end, new Date(span.startMs), new Date(span.endMs), reason],
      );
      await tx.query(
        `INSERT INTO station_occupancy (station_id, kind, block_id, occupied)
         VALUES ($1, 'maintenance', $2, tstzrange($3, $4, '[)'))`,
        [station.id, block.id, new Date(span.startMs), new Date(span.endMs)],
      );

      return json(201, {
        block: { id: block.id, station_id: station.id, date, start, end, reason },
        displaced_booking_ids: displaced.map((row) => row.id),
      });
    });
  } catch (error) {
    if (pgErrorCode(error) === EXCLUSION_VIOLATION) {
      const details = describeConflict(
        date,
        span.startMs,
        span.endMs,
        0,
        await stationOccupancy(station.id),
      );
      if (details) throw errors.slotConflict(date, details);
    }
    throw error;
  }
}

export const stationRoutes: Route[] = [
  { method: 'GET', path: '/api/stations', auth: 'session', roles: [...ALL_ROLES], handle: board },
  {
    method: 'POST',
    path: '/api/stations/:station_id/settings',
    auth: 'session',
    roles: ['operator'],
    body: 'json',
    resolve: ['station'],
    handle: saveSettings,
  },
  {
    method: 'POST',
    path: '/api/stations/:station_id/maintenance',
    auth: 'session',
    roles: [...STAFF],
    body: 'json',
    resolve: ['station'],
    handle: blockStation,
  },
  {
    method: 'DELETE',
    path: '/api/maintenance/:block_id',
    auth: 'session',
    roles: [...STAFF],
    resolve: ['block'],
    async handle(context) {
      const block = requireResolved(context.resolved, 'block');
      await db.query('DELETE FROM maintenance_blocks WHERE id = $1', [block.id]);
      return empty(204);
    },
  },
];
