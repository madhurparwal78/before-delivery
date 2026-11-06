import { loadHolds, loadQueue, waitingCounts } from '../data/runs';
import { loadTrain, loadTrains, stationExists } from '../data/trains';
import { availabilityCounts, availabilityLabel } from '../domain/availability';
import type { Quota, TravelClass } from '../domain/berths';
import { COACH_BERTHS, RAC_PLACES_PER_BERTH, isQuota, isTravelClass } from '../domain/berths';
import { passengerFare, quoteFare } from '../domain/fare';
import { addDaysToDate, isValidDateString, istTimestamp } from '../domain/ist';
import { RunInventory } from '../domain/inventory';
import type { Stretch } from '../domain/inventory';
import type { StopRow, TrainRow } from '../domain/schedule';
import {
  chartAt,
  coachesOfClass,
  findStop,
  generalWaitingList,
  runStops,
  stopBySeq,
} from '../domain/schedule';
import { opensAt, windowState } from '../domain/windows';
import type { AppServices, Route } from '../http/context';
import type { FieldErrors } from '../http/errors';
import { FIELD_MESSAGES, errors } from '../http/errors';

export interface RouteStretch {
  readonly fromStop: StopRow;
  readonly toStop: StopRow;
}

/** The train must call at the From stop and later at the To stop. */
export function routeStretch(train: TrainRow, from: string, to: string): RouteStretch | null {
  const fromStop = findStop(train.stops, from);
  const toStop = findStop(train.stops, to);
  if (fromStop === null || toStop === null || fromStop.seq >= toStop.seq) return null;
  return { fromStop, toStop };
}

function classesCarried(train: TrainRow): TravelClass[] {
  const carried: TravelClass[] = [];
  for (const coach of train.coaches) {
    if (!carried.includes(coach.travelClass)) carried.push(coach.travelClass);
  }
  return carried;
}

export async function classEntry(
  app: AppServices,
  train: TrainRow,
  runDate: string,
  travelClass: TravelClass,
  quota: Quota,
  route: RouteStretch,
  now: number,
): Promise<Record<string, unknown>> {
  const key = { train: train.number, runDate, travelClass };
  const holds = await loadHolds(app.database, key);
  const queue = await loadQueue(app.database, key, holds);
  const coaches = coachesOfClass(train, travelClass);
  const inventory = new RunInventory(coaches, holds);
  const stretch: Stretch = { fromSeq: route.fromStop.seq, toSeq: route.toStop.seq };
  const counts = availabilityCounts(
    inventory,
    travelClass,
    quota,
    stretch,
    generalWaitingList(route.fromStop),
    waitingCounts(queue),
  );
  const opening = opensAt(runDate, travelClass, quota);
  const state = windowState(now, chartAt(train, runDate), opening);
  return {
    class: travelClass,
    quota,
    window: state,
    opens_at: istTimestamp(opening),
    avl: counts.avl,
    rac: counts.rac,
    wl_type: counts.wl_type,
    wl: counts.wl,
    wl_cap: counts.wl_cap,
    label: availabilityLabel(quota, state, opening, counts),
    adult_fare_paise: passengerFare(
      route.toStop.km - route.fromStop.km,
      travelClass,
      quota,
    ).total,
  };
}

async function trainEntry(
  app: AppServices,
  train: TrainRow,
  route: RouteStretch,
  runDate: string,
  quota: Quota,
  travelClass: TravelClass | null,
  now: number,
): Promise<Record<string, unknown>> {
  const stops = runStops(train, runDate);
  const classes: Record<string, unknown>[] = [];
  for (const carried of travelClass === null ? classesCarried(train) : [travelClass]) {
    classes.push(await classEntry(app, train, runDate, carried, quota, route, now));
  }
  const chartInstant = chartAt(train, runDate);
  return {
    number: train.number,
    name: train.name,
    run_date: runDate,
    from: {
      code: route.fromStop.code,
      name: route.fromStop.name,
      departure_at: istTimestamp(stopBySeq(stops, route.fromStop.seq).at),
    },
    to: {
      code: route.toStop.code,
      name: route.toStop.name,
      arrival_at: istTimestamp(stopBySeq(stops, route.toStop.seq).at),
    },
    stops: stops.map((stop) => ({
      code: stop.code,
      name: stop.name,
      km: stop.km,
      departure_at: istTimestamp(stop.at),
    })),
    chart_at: istTimestamp(chartInstant),
    chart_prepared: now >= chartInstant,
    classes,
  };
}

function berthState(
  inventory: RunInventory,
  coach: string,
  berth: number,
  pool: string,
  stretch: Stretch,
): string {
  if (pool !== 'RAC') {
    return inventory.isBerthFree(coach, berth, stretch) ? 'free' : 'taken';
  }
  let free = 0;
  for (let slot = 1; slot <= RAC_PLACES_PER_BERTH; slot += 1) {
    if (inventory.isRacPlaceFree(coach, berth, slot, stretch)) free += 1;
  }
  if (free === RAC_PLACES_PER_BERTH) return 'rac_free';
  return free === 1 ? 'rac_one_free' : 'rac_full';
}

function readBody(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

export const trainRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/trains',
    auth: 'optional',
    handler: async (context) => {
      const from = context.query.get('from') ?? '';
      const to = context.query.get('to') ?? '';
      const date = context.query.get('date') ?? '';
      const quotaParam = context.query.get('quota') ?? 'GN';
      const classParam = context.query.get('class');
      if (!await stationExists(context.app.database, from)) throw errors.notFound();
      if (!await stationExists(context.app.database, to)) throw errors.notFound();
      const fields: FieldErrors = {};
      if (!isValidDateString(date)) fields.date = FIELD_MESSAGES.date;
      if (!isQuota(quotaParam)) fields.quota = FIELD_MESSAGES.quota;
      if (classParam !== null && !isTravelClass(classParam)) {
        fields.class = FIELD_MESSAGES.travelClass;
      }
      if (from === to) fields.to = FIELD_MESSAGES.sameStation;
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      const quota = quotaParam as Quota;
      const travelClass = classParam === null ? null : (classParam as TravelClass);
      const trains = await loadTrains(context.app.database);
      const entries: { departure: number; body: Record<string, unknown> }[] = [];
      for (const train of trains) {
        const route = routeStretch(train, from, to);
        if (route === null) continue;
        const runDate = addDaysToDate(date, -route.fromStop.dayOffset);
        const stops = runStops(train, runDate);
        entries.push({
          departure: stopBySeq(stops, route.fromStop.seq).at,
          body: await trainEntry(
            context.app,
            train,
            route,
            runDate,
            quota,
            travelClass,
            context.now,
          ),
        });
      }
      entries.sort((a, b) => a.departure - b.departure);
      return { status: 200, json: { trains: entries.map((entry) => entry.body) } };
    },
  },
  {
    method: 'GET',
    path: '/api/trains/:number/runs/:run_date/coaches',
    auth: 'optional',
    handler: async (context) => {
      const train = await loadTrain(context.app.database, context.params.number);
      if (train === null) throw errors.notFound();
      const runDate = context.params.run_date;
      const classParam = context.query.get('class');
      const from = context.query.get('from') ?? '';
      const to = context.query.get('to') ?? '';
      if (!await stationExists(context.app.database, from)) throw errors.notFound();
      if (!await stationExists(context.app.database, to)) throw errors.notFound();
      const fields: FieldErrors = {};
      if (!isValidDateString(runDate)) fields.run_date = FIELD_MESSAGES.date;
      if (!isTravelClass(classParam)) fields.class = FIELD_MESSAGES.travelClass;
      if (from === to) fields.to = FIELD_MESSAGES.sameStation;
      const route = routeStretch(train, from, to);
      if (route === null) {
        if (fields.to === undefined) fields.to = FIELD_MESSAGES.notOnRoute;
        throw errors.validation(fields);
      }
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      const travelClass = classParam as TravelClass;
      const key = { train: train.number, runDate, travelClass };
      const holds = await loadHolds(context.app.database, key);
      const coaches = coachesOfClass(train, travelClass);
      const inventory = new RunInventory(coaches, holds);
      const stretch: Stretch = { fromSeq: route.fromStop.seq, toSeq: route.toStop.seq };
      return {
        status: 200,
        json: {
          coaches: coaches.map((coach) => ({
            coach: coach.code,
            berths: COACH_BERTHS.map((spec) => ({
              berth: spec.berth,
              bay: spec.bay,
              type: spec.type,
              quota: spec.pool,
              state: berthState(inventory, coach.code, spec.berth, spec.pool, stretch),
            })),
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/fare-quote',
    auth: 'optional',
    handler: async (context) => {
      const input = readBody(context.body);
      const train = typeof input.train === 'string'
        ? await loadTrain(context.app.database, input.train)
        : null;
      if (train === null) throw errors.notFound();
      const from = typeof input.from === 'string' ? input.from : '';
      const to = typeof input.to === 'string' ? input.to : '';
      if (!await stationExists(context.app.database, from)) throw errors.notFound();
      if (!await stationExists(context.app.database, to)) throw errors.notFound();
      const fields: FieldErrors = {};
      if (!isValidDateString(input.run_date)) fields.run_date = FIELD_MESSAGES.date;
      if (!isTravelClass(input.class)) fields.class = FIELD_MESSAGES.travelClass;
      if (!isQuota(input.quota)) fields.quota = FIELD_MESSAGES.quota;
      if (from === to) fields.to = FIELD_MESSAGES.sameStation;
      const ages = Array.isArray(input.passengers)
        ? input.passengers.map((passenger) => {
          const record = readBody(passenger);
          return typeof record.age === 'number' ? record.age : -1;
        })
        : [];
      if (ages.length === 0 || ages.some((age) => !Number.isInteger(age) || age < 0 || age > 125)) {
        fields.passengers = FIELD_MESSAGES.atLeastOneAdult;
      }
      const route = routeStretch(train, from, to);
      if (route === null) {
        if (fields.to === undefined) fields.to = FIELD_MESSAGES.notOnRoute;
        throw errors.validation(fields);
      }
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      const quote = quoteFare(
        ages,
        route.toStop.km - route.fromStop.km,
        input.class as TravelClass,
        input.quota as Quota,
      );
      return { status: 200, json: { lines: quote.lines, total_paise: quote.total_paise } };
    },
  },
];
