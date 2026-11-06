import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { EventStatus, HeatSpec } from '../../shared/api';
import { config } from '../config';
import { query, withTransaction } from '../db/pool';
import { zonedLocalToUtc } from '../domain/clubTime';
import {
  isEditable,
  isEventStatus,
  isLegalTransition,
  isProtestWindowOpen,
} from '../domain/eventState';
import { apiError } from '../http/errors';
import { json, memberRoute, type Route } from '../http/router';
import {
  FieldErrors,
  readDate,
  readInteger,
  readString,
  readStringArray,
} from '../http/validate';
import {
  clubOf,
  eventDto,
  listClubEvents,
  loadEvent,
  requireRole,
  requireTableInForce,
  statusOf,
  tableInForce,
  type EventRecord,
} from './support';

const CUTOFF_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

interface EventInput {
  name: string;
  date: string;
  venue: string;
  registrationCutoffLocal: string;
  registrationCutoffUtc: Date;
  runsPerDriver: number;
  heats: HeatSpec[];
  stations: string[];
}

function readHeats(body: Record<string, unknown>, errors: FieldErrors): HeatSpec[] {
  const raw = body.heats;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4) {
    errors.add('heats', 'An event has 2 to 4 heats.');
    return [];
  }
  const heats: HeatSpec[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const heat = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    const number = typeof heat.number === 'number' ? heat.number : Number.NaN;
    if (number !== index + 1) {
      errors.add('heats', 'Heats must be numbered 1 upwards in order.');
    }
    const classes = Array.isArray(heat.classes)
      ? heat.classes.filter((value): value is string => typeof value === 'string')
      : [];
    for (const classCode of classes) {
      if (seen.has(classCode)) {
        errors.add('heats', `Class ${classCode} appears in two heats.`);
      }
      seen.add(classCode);
    }
    heats.push({ number: index + 1, classes });
  });
  return heats;
}

async function readEventInput(
  body: Record<string, unknown>,
  timeZone: string,
  clubId: string,
  defaults?: EventRecord,
): Promise<EventInput> {
  const errors = new FieldErrors();
  const source = defaults
    ? {
        name: body.name ?? defaults.name,
        date: body.date ?? defaults.event_date,
        venue: body.venue ?? defaults.venue,
        registrationCutoff: body.registrationCutoff ?? defaults.registration_cutoff_local,
        runsPerDriver: body.runsPerDriver ?? defaults.runs_per_driver,
        heats: body.heats ?? defaults.heats,
        stations: body.stations ?? defaults.stations,
      }
    : body;

  const name = readString(source, 'name', { min: 1, max: 80, label: 'Event name' }, errors);
  const date = readDate(source, 'date', 'Date', errors);
  const venue = readString(source, 'venue', { min: 1, max: 80, label: 'Venue' }, errors);
  const cutoffRaw = source.registrationCutoff;
  const cutoffLocal = typeof cutoffRaw === 'string' ? cutoffRaw.trim() : '';
  if (!CUTOFF_PATTERN.test(cutoffLocal)) {
    errors.add('registrationCutoff', 'Registration cutoff must look like 2026-08-14T20:00.');
  } else if (date.length > 0 && cutoffLocal >= `${date}T00:00`) {
    errors.add('registrationCutoff', 'Registration cutoff must be before the event date.');
  }
  const runsPerDriver = readInteger(
    source,
    'runsPerDriver',
    { min: 1, max: 6, label: 'Runs per driver' },
    errors,
  );
  const heats = readHeats(source, errors);
  const stations = readStringArray(
    source,
    'stations',
    { min: 1, max: 20, itemMin: 1, itemMax: 40, label: 'Stations' },
    errors,
  );
  errors.throwIfAny();

  const table = await tableInForce(clubId, date);
  if (!table) {
    throw apiError.validation({ date: 'No index table is in force on that date.' });
  }
  for (const heat of heats) {
    if (heat.classes.length === 0) continue;
    for (const classCode of heat.classes) {
      if (table.factors[classCode] === undefined) {
        errors.add('heats', `Class ${classCode} is not in the index table in force.`);
      }
    }
  }
  if (heats.every((heat) => heat.classes.length === 0)) {
    errors.add('heats', 'Assign at least one class to a heat.');
  }
  errors.throwIfAny();

  const cutoffUtc = zonedLocalToUtc(cutoffLocal, timeZone);
  if (cutoffUtc === null) {
    throw apiError.validation({
      registrationCutoff: 'Registration cutoff must look like 2026-08-14T20:00.',
    });
  }

  return {
    name,
    date,
    venue,
    registrationCutoffLocal: cutoffLocal,
    registrationCutoffUtc: cutoffUtc,
    runsPerDriver,
    heats,
    stations,
  };
}

async function writeStations(
  client: PoolClient,
  eventId: string,
  heats: HeatSpec[],
  stations: string[],
): Promise<void> {
  await client.query('DELETE FROM stations WHERE event_id = $1', [eventId]);
  for (const heat of heats) {
    for (const [ordinal, name] of stations.entries()) {
      await client.query(
        'INSERT INTO stations (id, event_id, heat, name, ordinal) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), eventId, heat.number, name, ordinal],
      );
    }
  }
}

export const eventRoutes: Route[] = [
  memberRoute('GET', '/api/events', async (ctx) => {
    const club = clubOf(ctx.actor);
    const events = await listClubEvents(club.id);
    const dtos = await Promise.all(
      events.map(async (event) => {
        const table = await requireTableInForce(club.id, event.event_date);
        return eventDto(event, club, table, ctx.now);
      }),
    );
    return json(200, { events: dtos });
  }),

  memberRoute('POST', '/api/events', async (ctx) => {
    const club = clubOf(ctx.actor);
    requireRole(ctx.actor, 'chair');
    const input = await readEventInput(ctx.body, club.time_zone, club.id);
    const id = randomUUID();
    const created = await withTransaction(async (client) => {
      const result = await client.query<EventRecord>(
        `INSERT INTO events (id, club_id, name, event_date, venue, registration_cutoff_local,
            registration_cutoff_utc, runs_per_driver, heats, stations, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, 'draft')
         RETURNING id, club_id, name, event_date, venue, registration_cutoff_local,
                   registration_cutoff_utc, runs_per_driver, heats, stations, status,
                   running_heat, provisional_at, protest_window_closes_at, version,
                   published_at, results_checksum`,
        [
          id,
          club.id,
          input.name,
          input.date,
          input.venue,
          input.registrationCutoffLocal,
          input.registrationCutoffUtc,
          input.runsPerDriver,
          JSON.stringify(input.heats),
          input.stations,
        ],
      );
      const event = result.rows[0];
      if (!event) throw new Error('Event insert returned no row');
      await writeStations(client, event.id, input.heats, input.stations);
      return event;
    });
    const table = await requireTableInForce(club.id, created.event_date);
    return json(201, { event: eventDto(created, club, table, ctx.now) });
  }),

  memberRoute('GET', '/api/events/:id', async (ctx) => {
    const club = clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    const table = await requireTableInForce(club.id, event.event_date);
    return json(200, { event: eventDto(event, club, table, ctx.now) });
  }),

  memberRoute('PATCH', '/api/events/:id', async (ctx) => {
    const club = clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    requireRole(ctx.actor, 'chair');
    if (!isEditable(statusOf(event, ctx.now))) {
      throw apiError.conflict('event_locked', 'Only draft events can be edited.');
    }
    const versionRaw = ctx.body.version;
    if (typeof versionRaw !== 'number' || !Number.isInteger(versionRaw)) {
      throw apiError.validation({ version: 'Version is required.' });
    }
    if (versionRaw !== event.version) throw apiError.staleVersion();
    const input = await readEventInput(ctx.body, club.time_zone, club.id, event);
    const updated = await withTransaction(async (client) => {
      const result = await client.query<EventRecord>(
        `UPDATE events
            SET name = $2, event_date = $3, venue = $4, registration_cutoff_local = $5,
                registration_cutoff_utc = $6, runs_per_driver = $7, heats = $8::jsonb,
                stations = $9, version = version + 1
          WHERE id = $1 AND version = $10
          RETURNING id, club_id, name, event_date, venue, registration_cutoff_local,
                    registration_cutoff_utc, runs_per_driver, heats, stations, status,
                    running_heat, provisional_at, protest_window_closes_at, version,
                    published_at, results_checksum`,
        [
          event.id,
          input.name,
          input.date,
          input.venue,
          input.registrationCutoffLocal,
          input.registrationCutoffUtc,
          input.runsPerDriver,
          JSON.stringify(input.heats),
          input.stations,
          versionRaw,
        ],
      );
      const next = result.rows[0];
      if (!next) throw apiError.staleVersion();
      await writeStations(client, next.id, input.heats, input.stations);
      return next;
    });
    const table = await requireTableInForce(club.id, updated.event_date);
    return json(200, { event: eventDto(updated, club, table, ctx.now) });
  }),

  memberRoute('POST', '/api/events/:id/transition', async (ctx) => {
    const club = clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    requireRole(ctx.actor, 'chair');
    const target = ctx.body.to;
    if (!isEventStatus(target)) {
      throw apiError.validation({ to: 'Pick a status the event can move to.' });
    }
    const current = statusOf(event, ctx.now);
    if (!isLegalTransition(current, target)) {
      throw apiError.conflict('illegal_transition', `That step is not available from ${current}.`);
    }
    if (target === 'final') {
      if (isProtestWindowOpen(event.protest_window_closes_at, ctx.now)) {
        throw apiError.conflict('protest_window_open', 'The protest window is still open.');
      }
      const pending = await query<{ id: string }>(
        `SELECT id FROM protests WHERE event_id = $1 AND status = 'pending' LIMIT 1`,
        [event.id],
      );
      if (pending.length > 0) {
        throw apiError.conflict(
          'protests_pending',
          'Decide every protest before setting results final.',
        );
      }
    }

    const updated = await applyTransition(event, target, ctx.now);
    const table = await requireTableInForce(club.id, updated.event_date);
    return json(200, { event: eventDto(updated, club, table, ctx.now) });
  }),

  memberRoute('POST', '/api/events/:id/running-heat', async (ctx) => {
    const club = clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    requireRole(ctx.actor, 'timing');
    if (statusOf(event, ctx.now) !== 'running') {
      throw apiError.conflict('event_not_running', 'The event is not running.');
    }
    const heatRaw = ctx.body.heat;
    const heat = typeof heatRaw === 'number' ? heatRaw : Number.NaN;
    if (!event.heats.some((candidate) => candidate.number === heat)) {
      throw apiError.validation({ heat: 'Pick one of the event heats.' });
    }
    const rows = await query<EventRecord>(
      `UPDATE events SET running_heat = $2 WHERE id = $1
       RETURNING id, club_id, name, event_date, venue, registration_cutoff_local,
                 registration_cutoff_utc, runs_per_driver, heats, stations, status,
                 running_heat, provisional_at, protest_window_closes_at, version,
                 published_at, results_checksum`,
      [event.id, heat],
    );
    const updated = rows[0];
    if (!updated) throw apiError.notFound();
    const table = await requireTableInForce(club.id, updated.event_date);
    return json(200, { event: eventDto(updated, club, table, ctx.now) });
  }),
];

async function applyTransition(
  event: EventRecord,
  target: EventStatus,
  now: Date,
): Promise<EventRecord> {
  const runningHeat = target === 'running' ? 1 : target === 'provisional' ? null : event.running_heat;
  const provisionalAt = target === 'provisional' ? now : event.provisional_at;
  const windowClosesAt =
    target === 'provisional'
      ? new Date(now.getTime() + config.protestWindowSeconds * 1000)
      : event.protest_window_closes_at;
  const rows = await query<EventRecord>(
    `UPDATE events
        SET status = $2, running_heat = $3, provisional_at = $4, protest_window_closes_at = $5
      WHERE id = $1
      RETURNING id, club_id, name, event_date, venue, registration_cutoff_local,
                registration_cutoff_utc, runs_per_driver, heats, stations, status,
                running_heat, provisional_at, protest_window_closes_at, version,
                published_at, results_checksum`,
    [event.id, target, runningHeat, provisionalAt, windowClosesAt],
  );
  const updated = rows[0];
  if (!updated) throw apiError.notFound();
  return updated;
}
