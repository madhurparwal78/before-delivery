import { randomToken, route, sha256 } from './http.js';
import { PUBLIC_REASONS, SPECIES, type PublicReason } from '../shared/domain.js';
import { addDays, clinicDate, clinicInstant, clinicMinuteOfDay, dayLabel, clinicHm, isIsoDate } from '../shared/clinictime.js';
import { clinicHours, config } from './config.js';
import { now } from './clock.js';
import { type Db, one, pool, rows, transaction } from './db.js';
import { AppError, invalid, notFound } from './errors.js';
import { publish } from './live.js';
import { enqueueMail, flushMail } from './mail.js';
import { createAppointment } from './appointments.js';

interface ClinicRow {
  id: string;
  name: string;
  slug: string;
}

async function clinicBySlug(db: Db, slug: string): Promise<ClinicRow> {
  const clinic = await one<ClinicRow>(db, 'SELECT id, name, slug FROM clinics WHERE slug = $1', [slug]);
  if (!clinic) throw notFound();
  return clinic;
}

const vetsOf = (db: Db, clinicId: string) =>
  rows<{ id: string; name: string }>(db, `SELECT id, name FROM users WHERE clinic_id = $1 AND role = 'vet' AND status = 'Active' ORDER BY name`, [clinicId]);

/** The one online-booking window rule: slot boundary, clinic hours, lead time to horizon, Vaccination only before noon. */
function offered(start: Date, reason: PublicReason, at: Date): boolean {
  if ((start.getTime() / 60_000) % config.slotMinutes !== 0) return false;
  const minute = clinicMinuteOfDay(start);
  if (minute < clinicHours.openMinute || minute + config.slotMinutes > clinicHours.closeMinute) return false;
  if (reason === 'Vaccination' && minute >= 12 * 60) return false;
  const earliest = at.getTime() + config.bookingLeadMinutes * 60_000;
  const latest = at.getTime() + config.bookingHorizonDays * 86_400_000;
  return start.getTime() >= earliest && start.getTime() <= latest;
}

interface Busy {
  vet_id: string;
  room_id: string;
  start_at: Date;
  minutes: number;
}

const overlaps = (b: Busy, start: Date) => b.start_at.getTime() < start.getTime() + config.slotMinutes * 60_000 && b.start_at.getTime() + b.minutes * 60_000 > start.getTime();

async function dayBusy(db: Db, clinicId: string, date: string): Promise<Busy[]> {
  return rows<Busy>(
    db,
    `SELECT vet_id, room_id, start_at, minutes FROM appointments
      WHERE clinic_id = $1 AND status IN ('booked','checked-in','in-consult','completed') AND start_at >= $2 AND start_at < $3`,
    [clinicId, clinicInstant(addDays(date, -1), 0, 0)!, clinicInstant(addDays(date, 2), 0, 0)!],
  );
}

function publicName(body: Record<string, unknown>, key: 'ownerName' | 'petName', message: string): string {
  const raw = body[key];
  if (typeof raw !== 'string' || /[\u0000-\u001f\u007f]/.test(raw)) throw new AppError('validation_failed', message, key);
  const value = raw.trim();
  const length = [...value].length;
  if (length < 1 || length > 80) throw new AppError('validation_failed', message, key);
  return value;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function attempts(db: Db, address: string, at: Date): Promise<number> {
  return (await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM booking_attempts WHERE address = $1 AND at > $2 AND at <= $3', [address, new Date(at.getTime() - 60_000), at]))!.n;
}

/** The pet a reminder token opens, only inside its own clinic and through the end of the due date in clinic time. */
async function petForToken(db: Db, clinic: ClinicRow, token: string) {
  const row = await one<{ pet_id: string; client_id: string; pet: string; species: string; owner: string; email: string; due: string; clinic_id: string }>(
    db,
    `SELECT p.id AS pet_id, p.client_id, p.name AS pet, p.species, c.name AS owner, c.email, to_char(v.due_date, 'YYYY-MM-DD') AS due, p.clinic_id
       FROM pet_tokens t JOIN vaccinations v ON v.id = t.vaccination_id JOIN patients p ON p.id = v.patient_id JOIN clients c ON c.id = p.client_id
      WHERE t.token_hash = $1`,
    [sha256(token)],
  );
  if (!row || row.clinic_id !== clinic.id || clinicDate(now()) > row.due) throw notFound();
  return row;
}

export function registerBookingRoutes(): void {
  route('GET', '/api/public/clinics/:slug', async (ctx) => {
    const clinic = await clinicBySlug(pool, ctx.params.slug);
    ctx.send(200, { name: clinic.name, slug: clinic.slug, vets: await vetsOf(pool, clinic.id) });
  });

  route('GET', '/api/public/clinics/:slug/slots', async (ctx) => {
    const clinic = await clinicBySlug(pool, ctx.params.slug);
    const date = ctx.query.get('date');
    if (!isIsoDate(date)) throw invalid('date', 'Day', date === null);
    const reasonParam = ctx.query.get('reason') ?? 'Check-up';
    if (!PUBLIC_REASONS.includes(reasonParam as PublicReason)) throw invalid('reason', 'Reason');
    const at = now();
    const [vets, busy, rooms] = await Promise.all([
      vetsOf(pool, clinic.id),
      dayBusy(pool, clinic.id, date),
      rows<{ id: string }>(pool, 'SELECT id FROM rooms WHERE clinic_id = $1', [clinic.id]),
    ]);
    const slots: { start: string; vetId: string; vetName: string }[] = [];
    for (let minute = clinicHours.openMinute; minute < clinicHours.closeMinute; minute += config.slotMinutes) {
      const start = clinicInstant(date, Math.floor(minute / 60), minute % 60)!;
      if (!offered(start, reasonParam as PublicReason, at)) continue;
      const taken = busy.filter((b) => overlaps(b, start));
      if (rooms.every((r) => taken.some((b) => b.room_id === r.id))) continue;
      for (const vet of vets) {
        if (!taken.some((b) => b.vet_id === vet.id)) slots.push({ start: start.toISOString(), vetId: vet.id, vetName: vet.name });
      }
    }
    ctx.send(200, { date, slots });
  });

  route('GET', '/api/public/clinics/:slug/pets/:token', async (ctx) => {
    const clinic = await clinicBySlug(pool, ctx.params.slug);
    const pet = await petForToken(pool, clinic, ctx.params.token);
    ctx.send(200, { petName: pet.pet, species: pet.species, ownerName: pet.owner, ownerEmail: pet.email });
  });

  route('POST', '/api/public/clinics/:slug/bookings', async (ctx) => {
    const at = now();
    if ((await attempts(pool, ctx.address, at)) >= config.bookingRatePerMinute) throw new AppError('rate_limited');
    await pool.query('INSERT INTO booking_attempts (address, at) VALUES ($1, $2)', [ctx.address, at]);
    await pool.query('DELETE FROM booking_attempts WHERE at < $1', [new Date(at.getTime() - 3_600_000)]);
    const clinic = await clinicBySlug(pool, ctx.params.slug);
    const body = await ctx.json();
    const vet = typeof body.vetId === 'string'
      ? await one<{ id: string; name: string }>(pool, `SELECT id, name FROM users WHERE id::text = $1 AND clinic_id = $2 AND role = 'vet' AND status = 'Active'`, [body.vetId, clinic.id])
      : undefined;
    if (body.vetId !== undefined && !vet) throw notFound();
    const token = typeof body.petToken === 'string' && body.petToken !== '' ? await petForToken(pool, clinic, body.petToken) : undefined;

    if (body.start === undefined || typeof body.start !== 'string' || Number.isNaN(new Date(body.start).getTime())) throw invalid('start', 'start', body.start === undefined);
    const start = new Date(body.start);
    if (!vet) throw invalid('vetId', 'vetId', true);
    const reason = body.reason;
    if (reason === undefined) throw invalid('reason', 'Reason', true);
    if (typeof reason !== 'string' || !PUBLIC_REASONS.includes(reason as PublicReason)) throw invalid('reason', 'Reason');
    if (!offered(start, reason as PublicReason, at)) throw new AppError('out_of_window', undefined, 'start');
    const ownerName = publicName(body, 'ownerName', 'Enter your name.');
    const ownerEmail = typeof body.ownerEmail === 'string' ? body.ownerEmail.trim() : '';
    if (!EMAIL.test(ownerEmail) || ownerEmail.length > 254 || /[\u0000-\u001f\u007f]/.test(ownerEmail)) {
      throw new AppError('validation_failed', 'Enter an email address like name@example.com.', 'ownerEmail');
    }
    const petName = publicName(body, 'petName', "Enter your pet's name.");
    const species = body.species;
    if (species === undefined) throw invalid('species', 'species', true);
    if (typeof species !== 'string' || !SPECIES.includes(species as (typeof SPECIES)[number])) throw invalid('species', 'species');

    const booked = await transaction(clinic.id, async (db) => {
      const busy = (await dayBusy(db, clinic.id, clinicDate(start))).filter((b) => overlaps(b, start));
      if (busy.some((b) => b.vet_id === vet.id)) throw new AppError('slot_taken');
      const room = (await rows<{ id: string }>(db, 'SELECT id FROM rooms WHERE clinic_id = $1 ORDER BY position', [clinic.id])).find((r) => !busy.some((b) => b.room_id === r.id));
      if (!room) throw new AppError('slot_taken');
      const pet = token
        ? { id: token.pet_id, name: token.pet }
        : await findOrCreatePet(db, clinic.id, { ownerName, ownerEmail, petName, species });
      const made = await createAppointment(db, clinic.id, {
        patientId: pet.id,
        vetId: vet.id,
        roomId: room.id,
        start,
        minutes: config.slotMinutes,
        reason: reason === 'Vaccination' ? 'Vaccination' : 'Consult',
      });
      const code = randomToken(24);
      await db.query('INSERT INTO online_bookings (code, clinic_id, appointment_id, owner_email) VALUES ($1, $2, $3, $4)', [code, clinic.id, made.id, ownerEmail]);
      await enqueueMail(db, {
        to: ownerEmail,
        subject: `Booking confirmed: ${pet.name} on ${dayLabel(clinicDate(start))} at ${clinicHm(start)}`,
        body: `Hello ${ownerName},\n\nYour visit is booked at ${clinic.name}.\n\nPet: ${pet.name}\nVet: ${vet.name}\nWhen: ${dayLabel(clinicDate(start))} at ${clinicHm(start)}\n`,
      });
      await publish(db, clinic.id, { t: 'calendar' });
      await publish(db, clinic.id, { t: 'bookings' });
      await publish(db, clinic.id, { t: 'patients' });
      return { code, petName: pet.name };
    });
    void flushMail();
    ctx.send(201, { code: booked.code, petName: booked.petName, vetName: vet.name, start: start.toISOString(), ownerEmail });
  });

  route('GET', '/api/public/bookings/:code', async (ctx) => {
    const row = await one<{ clinic: string; pet: string; vet: string; start_at: Date; owner_email: string }>(
      pool,
      `SELECT c.name AS clinic, p.name AS pet, v.name AS vet, a.start_at, b.owner_email
         FROM online_bookings b JOIN appointments a ON a.id = b.appointment_id JOIN patients p ON p.id = a.patient_id
         JOIN users v ON v.id = a.vet_id JOIN clinics c ON c.id = b.clinic_id WHERE b.code = $1`,
      [ctx.params.code],
    );
    if (!row) throw notFound();
    ctx.send(200, { clinicName: row.clinic, petName: row.pet, vetName: row.vet, start: row.start_at.toISOString(), ownerEmail: row.owner_email });
  });
}

/** An owner is matched by email within the clinic, else created; the pet by name within that owner, else created. */
async function findOrCreatePet(db: Db, clinicId: string, input: { ownerName: string; ownerEmail: string; petName: string; species: string }) {
  const client =
    (await one<{ id: string }>(db, 'SELECT id FROM clients WHERE clinic_id = $1 AND lower(email) = lower($2) ORDER BY name LIMIT 1', [clinicId, input.ownerEmail])) ??
    (await one<{ id: string }>(db, 'INSERT INTO clients (clinic_id, name, email) VALUES ($1, $2, $3) RETURNING id', [clinicId, input.ownerName, input.ownerEmail]))!;
  const pet =
    (await one<{ id: string; name: string }>(db, 'SELECT id, name FROM patients WHERE client_id = $1 AND name = $2 ORDER BY created_at LIMIT 1', [client.id, input.petName])) ??
    (await one<{ id: string; name: string }>(db, 'INSERT INTO patients (clinic_id, client_id, name, species) VALUES ($1, $2, $3, $4) RETURNING id, name', [clinicId, client.id, input.petName, input.species]))!;
  return pet;
}
