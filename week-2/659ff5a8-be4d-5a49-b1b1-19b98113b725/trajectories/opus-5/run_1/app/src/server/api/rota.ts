import { randomUUID } from 'node:crypto';
import type { RotaHeat } from '../../shared/api';
import { hasClubRole } from '../auth';
import { isUniqueViolation, query, queryOne } from '../db/pool';
import { isRotaOpen } from '../domain/eventState';
import { apiError } from '../http/errors';
import { json, memberRoute, noContent, type Route } from '../http/router';
import { attemptDelivery, enqueueDelivery } from '../services/deliveries';
import {
  clubOf,
  isUuid,
  listRegistrations,
  listStations,
  loadEvent,
  loadEventById,
  loadRegistration,
  registrationDto,
  statusOf,
  type EventRecord,
  type RegistrationRecord,
  type StationRecord,
} from './support';

interface StationWithEvent {
  station: StationRecord;
  event: EventRecord;
}

async function loadStation(clubId: string, stationId: string): Promise<StationWithEvent> {
  if (!isUuid(stationId)) throw apiError.notFound();
  const station = await queryOne<StationRecord>(
    `SELECT s.id, s.event_id, s.heat, s.name, s.ordinal, s.worker_registration_id
       FROM stations s JOIN events e ON e.id = s.event_id
      WHERE s.id = $1 AND e.club_id = $2`,
    [stationId, clubId],
  );
  if (!station) throw apiError.notFound();
  const event = await loadEventById(clubId, station.event_id);
  if (!event) throw apiError.notFound();
  return { station, event };
}

function stationPayload(
  station: StationRecord,
  worker: RegistrationRecord | null,
  assignmentEmail: 'sent' | 'pending',
): unknown {
  return {
    id: station.id,
    name: station.name,
    heat: station.heat,
    assignmentEmail,
    worker: worker
      ? {
          registrationId: worker.id,
          driverName: worker.driver_name,
          carNumber: worker.car_number,
          classCode: worker.class_code,
        }
      : null,
  };
}

async function takeStation(
  station: StationRecord,
  event: EventRecord,
  registration: RegistrationRecord,
  now: Date,
  clubId: string,
  recipientEmail: string,
): Promise<'sent' | 'pending'> {
  if (!isRotaOpen(statusOf(event, now))) {
    throw apiError.conflict('rota_locked', 'The rota is closed for this event.');
  }
  if (registration.event_id !== event.id) {
    throw apiError.conflict('not_registered', 'That driver is not registered for this event.');
  }
  const held = await queryOne<{ id: string }>(
    'SELECT id FROM stations WHERE event_id = $1 AND worker_registration_id = $2',
    [event.id, registration.id],
  );
  if (held) {
    throw apiError.conflict(
      'already_assigned',
      'You already have a work station for this event.',
    );
  }
  if (registration.run_heat === station.heat) {
    throw apiError.conflict(
      'own_heat',
      `You drive in heat ${registration.run_heat}. Pick a station in another heat.`,
    );
  }
  const claimed = await query<{ id: string }>(
    `UPDATE stations SET worker_registration_id = $2
      WHERE id = $1 AND worker_registration_id IS NULL
      RETURNING id`,
    [station.id, registration.id],
  ).catch((error: unknown) => {
    if (isUniqueViolation(error, 'stations_one_per_event')) {
      throw apiError.conflict(
        'already_assigned',
        'You already have a work station for this event.',
      );
    }
    throw error;
  });
  if (claimed.length === 0) {
    throw apiError.conflict('station_taken', 'That station was just taken. Pick another.');
  }

  const deliveryId = await enqueueDelivery({
    clubId,
    eventId: event.id,
    registrationId: registration.id,
    kind: 'work_assignment',
    dedupeKey: `work_assignment:${randomUUID()}`,
    recipient: recipientEmail,
    subject: `Work assignment for ${event.name}: ${station.name}, heat ${station.heat}`,
    body: [
      `You are working ${station.name} in heat ${station.heat}.`,
      '',
      `Event: ${event.name}`,
      `Date: ${event.event_date}`,
      `Station: ${station.name}`,
      `Heat: ${station.heat}`,
    ].join('\n'),
  });
  if (deliveryId === null) return 'pending';
  return (await attemptDelivery(deliveryId)) ? 'sent' : 'pending';
}

export const rotaRoutes: Route[] = [
  memberRoute('GET', '/api/events/:id/rota', async (ctx) => {
    clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    const [stations, registrations] = await Promise.all([
      listStations(event.id),
      listRegistrations(event.id),
    ]);
    const byRegistration = new Map(registrations.map((row) => [row.id, row]));
    const heats: RotaHeat[] = event.heats.map((heat) => {
      const heatStations = stations.filter((station) => station.heat === heat.number);
      return {
        number: heat.number,
        unfilled: heatStations.filter((station) => station.worker_registration_id === null).length,
        stations: heatStations.map((station) => {
          const worker = station.worker_registration_id
            ? byRegistration.get(station.worker_registration_id) ?? null
            : null;
          return {
            id: station.id,
            name: station.name,
            worker: worker
              ? {
                  registrationId: worker.id,
                  driverName: worker.driver_name,
                  carNumber: worker.car_number,
                  classCode: worker.class_code,
                }
              : null,
          };
        }),
      };
    });
    return json(200, { heats });
  }),

  memberRoute('POST', '/api/stations/:id/claim', async (ctx) => {
    const club = clubOf(ctx.actor);
    const { station, event } = await loadStation(club.id, ctx.params.id ?? '');
    if (!isRotaOpen(statusOf(event, ctx.now))) {
      throw apiError.conflict('rota_locked', 'The rota is closed for this event.');
    }
    const registration = await queryOne<{ id: string }>(
      'SELECT id FROM registrations WHERE event_id = $1 AND driver_id = $2',
      [event.id, ctx.actor.id],
    );
    if (!registration) {
      throw apiError.conflict('not_registered', 'Register for the event before claiming a station.');
    }
    const full = await loadRegistration(club.id, registration.id);
    if (!full) throw apiError.notFound();
    const assignmentEmail = await takeStation(
      station,
      event,
      full,
      ctx.now,
      club.id,
      ctx.actor.email,
    );
    const updated = await loadRegistration(club.id, full.id);
    if (!updated) throw apiError.notFound();
    return json(201, {
      station: stationPayload(station, updated, assignmentEmail),
      registration: await registrationDto(updated),
    });
  }),

  memberRoute('POST', '/api/stations/:id/assign', async (ctx) => {
    const club = clubOf(ctx.actor);
    const { station, event } = await loadStation(club.id, ctx.params.id ?? '');
    if (!hasClubRole(ctx.actor, 'workers')) throw apiError.forbidden();
    const registrationId =
      typeof ctx.body.registrationId === 'string' ? ctx.body.registrationId : '';
    if (!isUuid(registrationId)) {
      throw apiError.validation({ registrationId: 'Pick a driver to assign.' });
    }
    if (!isRotaOpen(statusOf(event, ctx.now))) {
      throw apiError.conflict('rota_locked', 'The rota is closed for this event.');
    }
    const registration = await loadRegistration(club.id, registrationId);
    if (!registration) {
      throw apiError.conflict('not_registered', 'That driver is not registered for this event.');
    }
    const email = await queryOne<{ email: string }>('SELECT email FROM users WHERE id = $1', [
      registration.driver_id,
    ]);
    const assignmentEmail = await takeStation(
      station,
      event,
      registration,
      ctx.now,
      club.id,
      email?.email ?? registration.driver_email,
    );
    const updated = await loadRegistration(club.id, registration.id);
    if (!updated) throw apiError.notFound();
    return json(201, {
      station: stationPayload(station, updated, assignmentEmail),
      registration: await registrationDto(updated),
    });
  }),

  memberRoute('DELETE', '/api/stations/:id/claim', async (ctx) => {
    const club = clubOf(ctx.actor);
    const { station, event } = await loadStation(club.id, ctx.params.id ?? '');
    const worker = station.worker_registration_id
      ? await loadRegistration(club.id, station.worker_registration_id)
      : null;
    const isOwnStation = worker !== null && worker.driver_id === ctx.actor.id;
    if (!isOwnStation && !hasClubRole(ctx.actor, 'workers')) throw apiError.forbidden();
    if (!isRotaOpen(statusOf(event, ctx.now))) {
      throw apiError.conflict('rota_locked', 'The rota is closed for this event.');
    }
    const released = await query<{ id: string }>(
      `UPDATE stations SET worker_registration_id = NULL
        WHERE id = $1 AND worker_registration_id IS NOT NULL RETURNING id`,
      [station.id],
    );
    if (released.length === 0) {
      throw apiError.conflict('station_open', 'That station is already open.');
    }
    return noContent();
  }),
];
