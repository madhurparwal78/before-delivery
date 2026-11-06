import { randomUUID } from 'node:crypto';
import { isUniqueViolation, query, queryOne, withTransaction } from '../db/pool';
import { isCheckInOpen, isRegistrationOpen, isWithdrawalOpen } from '../domain/eventState';
import { isoUtc } from '../domain/clubTime';
import { apiError } from '../http/errors';
import { json, memberRoute, noContent, pdfResult, type Route } from '../http/router';
import { withIdempotency } from '../http/idempotency';
import { FieldErrors, readInteger, readString } from '../http/validate';
import { recordDeliveryFailure, attemptDelivery, enqueueDelivery } from '../services/deliveries';
import { RendererUnavailable, renderPdf } from '../services/renderer';
import { StorageUnavailable, getObject, putObjectOnce, waiverKey } from '../services/storage';
import { waiverHtml } from '../services/documents';
import {
  clubOf,
  heatForClass,
  listRegistrations,
  loadEvent,
  loadRegistration,
  registrationDto,
  statusOf,
  type EventRecord,
  type RegistrationRecord,
} from './support';
import { hasClubRole } from '../auth';

async function loadOwnRegistration(
  clubId: string,
  registrationId: string,
): Promise<{ registration: RegistrationRecord; event: EventRecord }> {
  const registration = await loadRegistration(clubId, registrationId);
  if (!registration) throw apiError.notFound();
  const event = await queryOne<EventRecord>(
    `SELECT id, club_id, name, event_date, venue, registration_cutoff_local,
            registration_cutoff_utc, runs_per_driver, heats, stations, status, running_heat,
            provisional_at, protest_window_closes_at, version, published_at, results_checksum
       FROM events WHERE id = $1`,
    [registration.event_id],
  );
  if (!event) throw apiError.notFound();
  return { registration, event };
}

export const registrationRoutes: Route[] = [
  memberRoute('GET', '/api/events/:id/registrations', async (ctx) => {
    clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    const registrations = await listRegistrations(event.id);
    const dtos = await Promise.all(registrations.map((row) => registrationDto(row)));
    return json(200, { registrations: dtos });
  }),

  memberRoute('POST', '/api/events/:id/registrations', async (ctx) => {
    const club = clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    return withIdempotency(ctx, async () => {
      if (!isRegistrationOpen(event.status, event.registration_cutoff_utc, ctx.now)) {
        throw apiError.conflict('registration_closed', 'Registration for this event is closed.');
      }
      const existing = await queryOne<{ id: string }>(
        'SELECT id FROM registrations WHERE event_id = $1 AND driver_id = $2',
        [event.id, ctx.actor.id],
      );
      if (existing) {
        throw apiError.conflict('already_registered', 'You are already registered for this event.');
      }

      const errors = new FieldErrors();
      const classCode = readString(
        ctx.body,
        'classCode',
        { min: 1, max: 6, label: 'Class' },
        errors,
      );
      const carNumber = readInteger(
        ctx.body,
        'carNumber',
        { min: 1, max: 999, label: 'Car number' },
        errors,
      );
      const carDescription = readString(
        ctx.body,
        'carDescription',
        { min: 1, max: 80, label: 'Car description' },
        errors,
      );
      const runHeat = heatForClass(event, classCode);
      if (runHeat === null) {
        errors.add('classCode', 'That class does not run at this event.');
      }
      errors.throwIfAny();

      const taken = await queryOne<{ id: string }>(
        'SELECT id FROM registrations WHERE event_id = $1 AND class_code = $2 AND car_number = $3',
        [event.id, classCode, carNumber],
      );
      if (taken) {
        throw apiError.conflict(
          'car_number_taken',
          `Car ${carNumber} is already taken in ${classCode}.`,
        );
      }

      const registrationId = randomUUID();
      try {
        await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO registrations
               (id, event_id, driver_id, class_code, car_number, car_description, run_heat)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              registrationId,
              event.id,
              ctx.actor.id,
              classCode,
              carNumber,
              carDescription,
              runHeat,
            ],
          );
          for (let runNumber = 1; runNumber <= event.runs_per_driver; runNumber += 1) {
            await client.query(
              'INSERT INTO runs (id, registration_id, run_number) VALUES ($1, $2, $3)',
              [randomUUID(), registrationId, runNumber],
            );
          }
        });
      } catch (error) {
        if (isUniqueViolation(error, 'registrations_event_id_driver_id_key')) {
          throw apiError.conflict(
            'already_registered',
            'You are already registered for this event.',
          );
        }
        if (isUniqueViolation(error)) {
          throw apiError.conflict(
            'car_number_taken',
            `Car ${carNumber} is already taken in ${classCode}.`,
          );
        }
        throw error;
      }

      const deliveryId = await enqueueDelivery({
        clubId: club.id,
        eventId: event.id,
        registrationId,
        kind: 'registration_confirmation',
        dedupeKey: `registration_confirmation:${registrationId}`,
        recipient: ctx.actor.email,
        subject: `Registered for ${event.name}: car ${carNumber} ${classCode}`,
        body: [
          `You are registered for ${event.name} on ${event.event_date} at ${event.venue}.`,
          '',
          `Car ${carNumber} ${classCode}`,
          `Run heat ${runHeat}`,
          '',
          'Bring your helmet and check in at the registration table on event morning.',
        ].join('\n'),
      });
      if (deliveryId) await attemptDelivery(deliveryId);

      const created = await loadRegistration(club.id, registrationId);
      if (!created) throw apiError.notFound();
      return json(201, { registration: await registrationDto(created) });
    });
  }),

  memberRoute('DELETE', '/api/registrations/:id', async (ctx) => {
    const club = clubOf(ctx.actor);
    const { registration, event } = await loadOwnRegistration(club.id, ctx.params.id ?? '');
    if (registration.driver_id !== ctx.actor.id && !hasClubRole(ctx.actor, 'chair')) {
      throw apiError.forbidden();
    }
    if (!isWithdrawalOpen(statusOf(event, ctx.now))) {
      throw apiError.conflict('withdrawal_closed', 'Withdrawal closed once the event starts.');
    }
    await query('DELETE FROM registrations WHERE id = $1', [registration.id]);
    return noContent();
  }),

  memberRoute('POST', '/api/registrations/:id/check-in', async (ctx) => {
    const club = clubOf(ctx.actor);
    const { registration, event } = await loadOwnRegistration(club.id, ctx.params.id ?? '');
    if (registration.driver_id !== ctx.actor.id && !hasClubRole(ctx.actor, 'chair')) {
      throw apiError.forbidden();
    }
    if (!isCheckInOpen(statusOf(event, ctx.now))) {
      throw apiError.conflict('check_in_closed', 'Check-in is not open for this event.');
    }
    if (registration.checked_in) {
      throw apiError.conflict('already_checked_in', 'That driver is already checked in.');
    }
    const signature = typeof ctx.body.signature === 'string' ? ctx.body.signature.trim() : '';
    if (signature.toLowerCase() !== registration.driver_name.trim().toLowerCase()) {
      throw apiError.validation({ signature: 'Type your name exactly as registered.' });
    }

    const key = waiverKey(club.slug, event.id, registration.id);
    let pdf: Buffer;
    try {
      pdf = await renderPdf({
        html: waiverHtml({
          clubName: club.name,
          eventName: event.name,
          eventDate: event.event_date,
          driverName: registration.driver_name,
          carNumber: registration.car_number,
          classCode: registration.class_code,
          signature,
          signedAtUtc: isoUtc(ctx.now),
        }),
      });
    } catch (error) {
      if (error instanceof RendererUnavailable) {
        await recordDeliveryFailure(club.id, 'renderer', event.id);
        throw apiError.unavailable(
          'renderer_unavailable',
          'Waiver signing is unavailable right now.',
        );
      }
      throw error;
    }

    let checksum: string;
    try {
      checksum = await putObjectOnce(key, pdf, 'application/pdf');
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        await recordDeliveryFailure(club.id, 'storage', event.id);
        throw apiError.unavailable(
          'storage_unavailable',
          'We could not save your signed waiver.',
        );
      }
      throw error;
    }

    await query(
      `UPDATE registrations
          SET checked_in = true, checked_in_at = $2, waiver_key = $3, waiver_checksum = $4
        WHERE id = $1`,
      [registration.id, ctx.now, key, checksum],
    );
    const updated = await loadRegistration(club.id, registration.id);
    if (!updated) throw apiError.notFound();
    return json(201, { registration: await registrationDto(updated) });
  }),

  memberRoute('GET', '/api/registrations/:id/waiver.pdf', async (ctx) => {
    const club = clubOf(ctx.actor);
    const { registration } = await loadOwnRegistration(club.id, ctx.params.id ?? '');
    if (registration.driver_id !== ctx.actor.id && !hasClubRole(ctx.actor, 'chair')) {
      throw apiError.forbidden();
    }
    if (!registration.checked_in || registration.waiver_key === null) throw apiError.notFound();
    let bytes: Buffer | null;
    try {
      bytes = await getObject(registration.waiver_key);
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        throw apiError.unavailable('storage_unavailable', 'Waiver storage is offline.');
      }
      throw error;
    }
    if (bytes === null) throw apiError.notFound();
    return pdfResult(bytes);
  }),
];
