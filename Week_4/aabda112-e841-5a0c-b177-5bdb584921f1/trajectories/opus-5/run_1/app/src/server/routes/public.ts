import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { settings } from '../config';
import { clinicToday, isClinicDate, serverNow } from '../clock';
import { newId, one, query, transaction } from '../db';
import { AppError, invalid } from '../errors';
import { body, created, ok, route } from '../http';
import { publish } from '../live';
import { sendMail } from '../mail';
import { clinicDayDdMon, clinicTimeHm } from '../format';
import {
  appointmentReasonFor,
  firstFreeRoom,
  isPublicReason,
  isSpecies,
  offeredSlots,
  readOwnerEmail,
  readOwnerText,
  startIsBookable,
} from '../domain/booking';
import { assertSlotFree, lockClinicBookings } from '../domain/appointments';

export const publicRouter = Router();

type ClinicRow = { id: string; name: string; slug: string };

async function findClinic(slug: string): Promise<ClinicRow> {
  const clinic = await one<ClinicRow>('select id, name, slug from clinics where slug = $1', [slug]);
  if (!clinic) throw new AppError('not_found');
  return clinic;
}

publicRouter.get(
  '/api/public/clinics/:slug',
  route(async (request) => {
    const clinic = await findClinic(request.params.slug);
    const vets = await query<{ id: string; name: string }>(
      `select id, name from users where clinic_id = $1 and role = 'vet' and status = 'Active' order by name`,
      [clinic.id],
    );
    return ok({ name: clinic.name, slug: clinic.slug, vets });
  }),
);

publicRouter.get(
  '/api/public/clinics/:slug/slots',
  route(async (request) => {
    const clinic = await findClinic(request.params.slug);
    const date = typeof request.query.date === 'string' ? request.query.date : '';
    if (!isClinicDate(date)) throw invalid('date');
    const reasonInput = request.query.reason;
    const reason = reasonInput === undefined || reasonInput === '' ? 'Check-up' : reasonInput;
    if (!isPublicReason(reason)) throw invalid('reason');
    const now = serverNow();
    const slots = await transaction((tx) =>
      offeredSlots(tx, { clinicId: clinic.id, date, reason, now }),
    );
    return ok({ date, slots });
  }),
);

publicRouter.get(
  '/api/public/clinics/:slug/pets/:token',
  route(async (request) => {
    const clinic = await findClinic(request.params.slug);
    const row = await one<{
      patient_id: string;
      due_date: Date | string;
      pet_name: string;
      species: string;
      owner_name: string;
      owner_email: string;
    }>(
      `select t.patient_id, t.due_date, p.name as pet_name, p.species,
              c.name as owner_name, c.email as owner_email
         from pet_tokens t join patients p on p.id = t.patient_id
         join clients c on c.id = p.client_id
        where t.token = $1 and t.clinic_id = $2`,
      [request.params.token, clinic.id],
    );
    if (!row) throw new AppError('not_found');
    const dueDate =
      typeof row.due_date === 'string' ? row.due_date : row.due_date.toISOString().slice(0, 10);
    if (clinicToday() > dueDate) throw new AppError('not_found');
    return ok({
      petName: row.pet_name,
      species: row.species,
      ownerName: row.owner_name,
      ownerEmail: row.owner_email,
    });
  }),
);

publicRouter.get(
  '/api/public/bookings/:code',
  route(async (request) => {
    const row = await one<{
      clinic_name: string;
      pet_name: string;
      vet_name: string;
      start_at: Date;
      owner_email: string;
    }>(
      `select cl.name as clinic_name, p.name as pet_name, u.name as vet_name, a.start_at,
              c.email as owner_email
         from public_bookings b
         join appointments a on a.id = b.appointment_id
         join patients p on p.id = a.patient_id
         join clients c on c.id = p.client_id
         join users u on u.id = a.vet_id
         join clinics cl on cl.id = b.clinic_id
        where b.code = $1`,
      [request.params.code],
    );
    if (!row) throw new AppError('not_found');
    return ok({
      clinicName: row.clinic_name,
      petName: row.pet_name,
      vetName: row.vet_name,
      start: row.start_at.toISOString(),
      ownerEmail: row.owner_email,
    });
  }),
);

publicRouter.post(
  '/api/public/clinics/:slug/bookings',
  route(async (request) => {
    const now = serverNow();
    const address = request.socket.remoteAddress ?? 'unknown';
    const windowStart = new Date(now - 60_000).toISOString();
    const recent = await one<{ count: string }>(
      'select count(*)::text as count from booking_attempts where ip = $1 and at > $2',
      [address, windowStart],
    );
    if (Number(recent?.count ?? 0) >= settings.bookingRatePerMinute) {
      throw new AppError('rate_limited');
    }
    await query('insert into booking_attempts (ip, at) values ($1,$2)', [
      address,
      new Date(now).toISOString(),
    ]);

    const clinic = await findClinic(request.params.slug);
    const input = body(request);
    const vet = await one<{ id: string; name: string }>(
      `select id, name from users where id = $1 and clinic_id = $2 and role = 'vet' and status = 'Active'`,
      [typeof input.vetId === 'string' ? input.vetId : '', clinic.id],
    );
    if (!vet) throw new AppError('not_found');

    let tokenPatient: { id: string; client_id: string } | null = null;
    if (input.petToken !== undefined && input.petToken !== null && input.petToken !== '') {
      const row = await one<{ patient_id: string; due_date: Date | string; client_id: string }>(
        `select t.patient_id, t.due_date, p.client_id from pet_tokens t
           join patients p on p.id = t.patient_id
          where t.token = $1 and t.clinic_id = $2`,
        [String(input.petToken), clinic.id],
      );
      const dueDate = row
        ? typeof row.due_date === 'string'
          ? row.due_date
          : row.due_date.toISOString().slice(0, 10)
        : '';
      if (!row || clinicToday() > dueDate) throw new AppError('not_found');
      tokenPatient = { id: row.patient_id, client_id: row.client_id };
    }

    if (!isPublicReason(input.reason)) {
      throw invalid('reason', input.reason === undefined ? 'missing' : 'invalid');
    }
    const reason = input.reason;
    if (typeof input.start !== 'string' || Number.isNaN(Date.parse(input.start))) {
      throw invalid('start');
    }
    const start = Date.parse(input.start);
    const end = start + settings.slotMinutes * 60_000;
    if (!startIsBookable(start, reason, now)) {
      throw new AppError('out_of_window', { field: 'start' });
    }
    const ownerName = tokenPatient ? null : readOwnerText(input.ownerName, 'ownerName');
    const ownerEmail = readOwnerEmail(input.ownerEmail);
    const petName = tokenPatient ? null : readOwnerText(input.petName, 'petName');
    if (!tokenPatient && !isSpecies(input.species)) throw invalid('species');

    const result = await transaction(async (tx) => {
      await lockClinicBookings(tx, clinic.id);
      const roomId = await firstFreeRoom(tx, { clinicId: clinic.id, start, end });
      if (!roomId) throw new AppError('slot_taken');
      await assertSlotFree(tx, {
        clinicId: clinic.id,
        vetId: vet.id,
        roomId,
        start,
        end,
      });
      let patientId: string;
      let clientEmail = ownerEmail;
      if (tokenPatient) {
        patientId = tokenPatient.id;
        const client = await tx.one<{ email: string }>('select email from clients where id = $1', [
          tokenPatient.client_id,
        ]);
        clientEmail = client?.email ?? ownerEmail;
      } else {
        let client = await tx.one<{ id: string }>(
          'select id from clients where clinic_id = $1 and lower(email) = lower($2) limit 1',
          [clinic.id, ownerEmail],
        );
        if (!client) {
          const clientId = newId();
          await tx.query(
            'insert into clients (id, clinic_id, name, email) values ($1,$2,$3,$4)',
            [clientId, clinic.id, ownerName, ownerEmail],
          );
          client = { id: clientId };
        }
        const pet = await tx.one<{ id: string }>(
          'select id from patients where client_id = $1 and lower(name) = lower($2) limit 1',
          [client.id, petName],
        );
        if (pet) {
          patientId = pet.id;
        } else {
          patientId = newId();
          await tx.query(
            'insert into patients (id, clinic_id, client_id, name, species) values ($1,$2,$3,$4,$5)',
            [patientId, clinic.id, client.id, petName, input.species],
          );
        }
      }
      const appointmentId = newId();
      await tx.query(
        `insert into appointments (id, clinic_id, patient_id, vet_id, room_id, start_at, end_at, reason, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'booked')`,
        [
          appointmentId,
          clinic.id,
          patientId,
          vet.id,
          roomId,
          new Date(start).toISOString(),
          new Date(end).toISOString(),
            appointmentReasonFor(reason),
        ],
      );
      const code = randomBytes(16).toString('hex');
      await tx.query(
        'insert into public_bookings (code, clinic_id, appointment_id) values ($1,$2,$3)',
        [code, clinic.id, appointmentId],
      );
      const patient = await tx.one<{ name: string }>('select name from patients where id = $1', [
        patientId,
      ]);
      const client = await tx.one<{ name: string }>(
        'select c.name from clients c join patients p on p.client_id = c.id where p.id = $1',
        [patientId],
      );
      return {
        code,
        petName: patient?.name ?? '',
        ownerName: ownerName ?? client?.name ?? '',
        ownerEmail: clientEmail,
      };
    });

    publish(clinic.id, { kind: 'changed', topics: ['calendar', 'patients'] });
    await sendMail({
      to: result.ownerEmail,
      subject: `Booking confirmed: ${result.petName} on ${clinicDayDdMon(start)} at ${clinicTimeHm(start)}`,
      body: `Hello ${result.ownerName},\n\nYour visit to ${clinic.name} is booked with ${vet.name} on ${clinicDayDdMon(
        start,
      )} at ${clinicTimeHm(start)} clinic time.\n\nThank you for choosing ${clinic.name}.\n`,
    });

    return created({
      code: result.code,
      petName: result.petName,
      vetName: vet.name,
      start: new Date(start).toISOString(),
      ownerEmail: result.ownerEmail,
    });
  }),
);
