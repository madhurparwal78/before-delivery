import { createHash } from 'node:crypto';
import { one, query } from '../db/pool';
import { Decimal } from '../domain/decimal';
import { group } from '../domain/display';
import { copy } from '../domain/copy';
import { readLocalNumber } from '../domain/numbers';
import {
  LISBON,
  TOWNS,
  dayHours,
  isRealDate,
  isRealTime,
  isTown,
  iso,
  localDate,
  localTime,
  shownDate,
  shownDateOfLocalDate,
  wallToInstants,
} from '../domain/time';
import { newId, nextSortIndex } from '../ids';
import { problem } from '../http/problem';
import type { Ctx, Reply } from '../http/router';
import { FieldCollector, requiredText } from '../store/fields';
import { findLabel, visitShape } from '../store/read';
import type { ReadingRow, VisitRow } from '../store/rows';

const UNITS = ['kWh', 'MJ', 'm3'] as const;

function shownBoth(visit: VisitRow): string {
  const at = Number(visit.at);
  const town = TOWNS[visit.town];
  const townPart = `${shownDate(at, town.zone)}, ${localTime(at, town.zone)} ${town.name} time`;
  if (visit.town === 'porto') return townPart;
  return `${townPart} \u00b7 ${localTime(at, LISBON)} Lisbon time`;
}

function shapeVisit(visit: VisitRow): Record<string, unknown> {
  const at = Number(visit.at);
  const lisbonDate = localDate(at, LISBON);
  return visitShape(visit, lisbonDate, dayHours(lisbonDate, LISBON), shownBoth(visit));
}

export async function readVisitRows(deskId: string): Promise<VisitRow[]> {
  return query<VisitRow>(
    `select v.* from visits v join labels l on l.id = v.label_id
     where v.assessor_id = $1 and l.state <> 'erased' order by v.at`,
    [deskId],
  );
}

export async function listVisits(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const visits = await readVisitRows(desk.id);
  return { status: 200, json: { visits: visits.map(shapeVisit) } };
}

export async function createVisit(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const body = ctx.json();
  const label = await findLabel(desk.id, typeof body.labelId === 'string' ? body.labelId : '');

  const problems = new FieldCollector();
  const factoryName = requiredText(body, 'factoryName', problems);
  if (!isTown(body.town)) problems.add('town', copy.emptyField);
  const localDateGiven = typeof body.localDate === 'string' ? body.localDate.trim() : '';
  if (!isRealDate(localDateGiven)) problems.add('localDate', copy.dateForm);
  const localTimeGiven = typeof body.localTime === 'string' ? body.localTime.trim() : '';
  if (!isRealTime(localTimeGiven)) problems.add('localTime', copy.timeForm);

  let at: number | null = null;
  if (problems.empty && isTown(body.town)) {
    const [year, month, day] = localDateGiven.split('-').map(Number) as [number, number, number];
    const [hour, minute] = localTimeGiven.split(':').map(Number) as [number, number];
    const found = wallToInstants(
      { year, month, day, hour, minute, second: 0 },
      TOWNS[body.town].zone,
    );
    if (found.length === 0) {
      problems.add(
        'localTime',
        copy.skippedTime(TOWNS[body.town].name, shownDateOfLocalDate(localDateGiven)),
      );
    } else {
      at = found[0] as number;
    }
  }
  problems.throwIfAny();
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);

  const id = newId();
  await query(
    `insert into visits (id, assessor_id, label_id, factory_name, town, local_date, local_time, at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, desk.id, label.id, factoryName, body.town as string, localDateGiven, localTimeGiven, at, ctx.now],
  );
  const made = await one<VisitRow>('select * from visits where id = $1', [id]);
  return { status: 201, json: shapeVisit(made as VisitRow) };
}

export async function findVisit(deskId: string, visitId: string): Promise<VisitRow> {
  const visit = await one<VisitRow>(
    `select v.* from visits v join labels l on l.id = v.label_id
     where v.id = $1 and v.assessor_id = $2 and l.state <> 'erased'`,
    [visitId, deskId],
  );
  if (!visit) throw problem.notFound();
  return visit;
}

export async function readVisitReadings(visitId: string): Promise<ReadingRow[]> {
  return query<ReadingRow>('select * from readings where visit_id = $1 order by sort_index', [visitId]);
}

function shapeReading(reading: ReadingRow): Record<string, unknown> {
  return {
    id: reading.id,
    meter: reading.meter,
    value: reading.value,
    unit: reading.unit,
    takenAt: iso(Number(reading.taken_at)),
  };
}

export async function readVisit(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const visit = await findVisit(desk.id, ctx.params.id as string);
  const readings = await readVisitReadings(visit.id);
  return { status: 200, json: { ...shapeVisit(visit), readings: readings.map(shapeReading) } };
}

export async function readCalendarDay(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const date = ctx.params.date as string;
  if (!isRealDate(date)) throw problem.validation(copy.dateForm);
  const visits = await readVisitRows(desk.id);
  const sameDay = visits.filter((visit) => localDate(Number(visit.at), LISBON) === date);
  return {
    status: 200,
    json: {
      date,
      shown: shownDateOfLocalDate(date),
      hours: dayHours(date, LISBON),
      visits: sameDay.map(shapeVisit),
    },
  };
}

function readingBodyHash(body: Record<string, unknown>): string {
  const held = {
    meter: body.meter ?? null,
    value: typeof body.value === 'string' ? body.value : null,
    unit: body.unit ?? null,
    keepMine: body.keepMine === true,
  };
  return createHash('sha256').update(JSON.stringify(held)).digest('hex');
}

/** A reading typed the English way or as a plain decimal, kept exactly. */
function readReadingValue(text: string): Decimal | null {
  return readLocalNumber(text, 'en');
}

export async function recordReading(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const visit = await findVisit(desk.id, ctx.params.id as string);
  const requestKey = typeof ctx.headers['request-key'] === 'string' ? ctx.headers['request-key'] : null;

  if (requestKey !== null) {
    const stored = await one<{ body_hash: string; status: number; body: unknown }>(
      'select body_hash, status, body from request_keys where assessor_id = $1 and key = $2',
      [desk.id, requestKey],
    );
    if (stored) {
      const hash = readingBodyHash(ctx.json());
      if (hash !== stored.body_hash) throw problem.keyReused();
      return { status: stored.status, json: stored.body };
    }
  }

  const body = ctx.json();
  const problems = new FieldCollector();
  const meter = body.meter;
  if (typeof meter !== 'number' || !Number.isInteger(meter) || meter < 1) problems.add('meter', copy.emptyField);
  const valueText = typeof body.value === 'string' ? body.value : '';
  const value = readReadingValue(valueText);
  if (value === null) problems.add('value', copy.emptyField);
  const unit = body.unit;
  if (typeof unit !== 'string' || !(UNITS as readonly string[]).includes(unit)) {
    problems.add('unit', copy.emptyField);
  }
  const secondsAgo = body.secondsAgo;
  if (secondsAgo !== undefined && (typeof secondsAgo !== 'number' || !Number.isInteger(secondsAgo) || secondsAgo < 0)) {
    problems.add('secondsAgo', copy.emptyField);
  }
  problems.throwIfAny();

  const earlier = await query<ReadingRow>(
    'select * from readings where visit_id = $1 and meter = $2 order by sort_index',
    [visit.id, meter as number],
  );
  const last = earlier[earlier.length - 1];
  if (last && last.unit !== unit) {
    throw problem.fields({ unit: copy.meterUnit(meter as number, last.unit) });
  }
  if (last && body.keepMine !== true && (value as Decimal).lessThan(new Decimal(last.value))) {
    const town = TOWNS[visit.town];
    throw problem.lowerReading(
      copy.lowerReading(
        meter as number,
        group(new Decimal(last.value).toFixed()),
        last.unit,
        localTime(Number(last.taken_at), town.zone),
        town.name,
      ),
      new Decimal(last.value).toFixed(),
      iso(Number(last.taken_at)),
    );
  }

  const id = newId();
  const takenAt = ctx.now - (typeof secondsAgo === 'number' ? secondsAgo : 0);
  await query(
    `insert into readings (id, visit_id, meter, value, unit, taken_at, created_at, sort_index)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, visit.id, meter as number, (value as Decimal).toFixed(), unit as string, takenAt, ctx.now, nextSortIndex()],
  );
  const json = {
    id,
    meter: meter as number,
    value: (value as Decimal).toFixed(),
    unit: unit as string,
    takenAt: iso(takenAt),
  };
  if (requestKey !== null) {
    await query(
      `insert into request_keys (assessor_id, key, body_hash, status, body, created_at)
       values ($1,$2,$3,$4,$5,$6) on conflict (assessor_id, key) do nothing`,
      [desk.id, requestKey, readingBodyHash(body), 201, JSON.stringify(json), ctx.now],
    );
  }
  return { status: 201, json };
}
