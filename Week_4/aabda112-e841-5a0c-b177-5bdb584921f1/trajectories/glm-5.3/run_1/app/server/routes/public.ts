import express from 'express';
import crypto from 'node:crypto';
import { q, one } from '../db.js';
import { settings } from '../settings.js';
import { clockNow } from '../clock.js';
import { t, validationError, notValid } from '../errors.js';
import { handler } from '../core.js';
import * as bus from '../live.js';
import { enqueueMail } from '../mail.js';
import { clinicDateOf, clinicTimeOf, clinicDayMonth, clinicDayShort } from '../tz.js';
import { parseStart, checkClinicHours, checkSlotBoundary, slotFree } from '../domain/appointments.js';

export const router = express.Router();

const PUBLIC_REASONS = ['Check-up', 'Vaccination', 'Limping or injury', 'Off their food'];
const REASON_TO_INTERNAL: Record<string, string> = {
  'Check-up': 'Consult',
  'Vaccination': 'Vaccination',
  'Limping or injury': 'Consult',
  'Off their food': 'Consult',
};
const SPECIES = ['dog', 'cat', 'rabbit', 'other'];

// The one place that decides the online booking window.
export function bookingWindow(now: Date): { earliest: Date; latest: Date } {
  return {
    earliest: new Date(now.getTime() + settings.bookingLeadMinutes * 60000),
    latest: new Date(now.getTime() + settings.bookingHorizonDays * 86400000),
  };
}

function withinWindow(start: Date, reason: string, now: Date): boolean {
  const { earliest, latest } = bookingWindow(now);
  if (start < earliest || start > latest) return false;
  checkSlotBoundary(start);
  checkClinicHours(start, settings.slotMinutes);
  const minutes = start.getUTCHours() * 60 + start.getUTCMinutes();
  void minutes;
  if (reason === 'Vaccination') {
    const hm = clinicHour(start);
    if (hm >= 12 * 60) return false;
  }
  return true;
}

function clinicHour(start: Date): number {
  const time = clinicTimeOf(start);
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

async function clinicBySlug(slug: string) {
  return one(`select * from clinics where slug = $1`, [slug]);
}

// The rolling per-address rate limit on the booking route only.
async function rateLimited(address: string): Promise<boolean> {
  const now = clockNow();
  const cutoff = new Date(now.getTime() - 60000);
  await q(`delete from rate_windows where at < now() - interval '5 minutes'`);
  const count = await one(
    `select count(*)::int as c from rate_windows where address = $1 and at > $2`,
    [address, cutoff]
  );
  return count.c >= settings.bookingRatePerMinute;
}

async function countAttempt(address: string): Promise<void> {
  await q(`insert into rate_windows (address, at) values ($1, $2) on conflict do nothing`, [address, clockNow()]);
}

export function clientAddress(req: express.Request): string {
  return req.socket.remoteAddress || 'unknown';
}

router.get('/public/clinics/:slug', handler(async (req, res) => {
  const clinic = await clinicBySlug(req.params.slug);
  if (!clinic) throw t('not_found');
  const vets = await q(
    `select id, name from users where clinic_id = $1 and role = 'vet' and status = 'Active' order by name`,
    [clinic.id]
  );
  return { status: 200, body: { name: clinic.name, slug: clinic.slug, vets: vets.rows } };
}));

router.get('/public/clinics/:slug/slots', handler(async (req, res) => {
  const clinic = await clinicBySlug(req.params.slug);
  if (!clinic) throw t('not_found');
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw notValid('date');
  const reason = typeof req.query.reason === 'string' && req.query.reason !== '' ? req.query.reason : null;
  if (reason && !PUBLIC_REASONS.includes(reason)) throw notValid('reason');
  const now = clockNow();
  const { earliest, latest } = bookingWindow(now);
  const rooms = await q(`select id from rooms where clinic_id = $1 order by position`, [clinic.id]);
  const vets = await q(
    `select id, name from users where clinic_id = $1 and role = 'vet' and status = 'Active' order by name`,
    [clinic.id]
  );
  const slots: { start: string; vetId: string; vetName: string }[] = [];
  for (const vet of vets.rows) {
    for (let minutes = 8 * 60; minutes < 18 * 60; minutes += settings.slotMinutes) {
      // build the instant from the clinic date + slot minute
      const [y, m, d] = date.split('-').map(Number);
      const { clinicToUtc } = await import('../tz.js');
      const start = clinicToUtc(y, m, d, Math.floor(minutes / 60), minutes % 60, true);
      if (!start) continue;
      if (start < earliest || start > latest) continue;
      if (reason === 'Vaccination' && clinicHour(start) >= 12 * 60) continue;
      let free = false;
      for (const room of rooms.rows) {
        if (await slotFree(clinic.id, vet.id, room.id, start, settings.slotMinutes)) {
          free = true;
          break;
        }
      }
      if (free) slots.push({ start: start.toISOString(), vetId: vet.id, vetName: vet.name });
    }
  }
  slots.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.vetId.localeCompare(b.vetId)));
  return { status: 200, body: { date, slots } };
}));

// Owner text: trimmed, 1 to 80 Unicode chars, no control characters.
export function validOwnerText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return null;
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return null;
  return trimmed;
}

router.get('/public/clinics/:slug/pets/:token', handler(async (req, res) => {
  const clinic = await clinicBySlug(req.params.slug);
  if (!clinic) throw t('not_found');
  const row = await one(
    `select v.*, p.name as pet_name, p.species, c.name as owner_name, c.email as owner_email
     from vaccinations v
     join patients p on p.id = v.patient_id
     join clients c on c.id = p.client_id
     where v.pet_token = $1 and v.clinic_id = $2`,
    [req.params.token, clinic.id]
  );
  if (!row) throw t('not_found');
  const today = clinicDateOf(clockNow());
  if (today > row.due_date) throw t('not_found');
  return {
    status: 200,
    body: { petName: row.pet_name, species: row.species, ownerName: row.owner_name, ownerEmail: row.owner_email },
  };
}));

router.post('/public/clinics/:slug/bookings', handler(async (req, res) => {
  const address = clientAddress(req);
  if (await rateLimited(address)) throw t('rate_limited');
  await countAttempt(address);
  const clinic = await clinicBySlug(req.params.slug);
  const body0 = req.body ?? {};
  const { start, vetId, reason, ownerEmail, petToken, species } = body0;
  const ownerName = validOwnerText(body0.ownerName);
  const petName = validOwnerText(body0.petName);
  if (!ownerName) {
    throw validationError('ownerName', 'Enter your name.');
  }
  if (typeof ownerEmail !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) {
    throw validationError('ownerEmail', 'Enter an email address like name@example.com.');
  }
  if (!petName) {
    throw validationError('petName', "Enter your pet's name.");
  }
  if (!clinic) throw t('not_found');
  if (typeof species !== 'string' || !SPECIES.includes(species)) throw notValid('species');
  if (typeof reason !== 'string' || !PUBLIC_REASONS.includes(reason)) throw notValid('reason');
  const startAt = parseStart(start);
  const now = clockNow();
  if (!withinWindow(startAt, reason, now)) throw t('out_of_window', { field: 'start' });

  // petToken, when valid, books for its own pet and client
  let patientId: string | null = null;
  let clientId: string | null = null;
  if (petToken !== undefined && petToken !== null) {
    const tokenRow = await one(
      `select v.*, p.name as pet_name, p.client_id from vaccinations v
       join patients p on p.id = v.patient_id
       where v.pet_token = $1 and v.clinic_id = $2`,
      [petToken, clinic.id]
    );
    if (!tokenRow || clinicDateOf(now) > tokenRow.due_date) throw t('not_found');
    patientId = tokenRow.patient_id;
    clientId = tokenRow.client_id;
  }

  const vet = await one(
    `select id, name from users where id = $1 and clinic_id = $2 and role = 'vet' and status = 'Active'`,
    [vetId, clinic.id]
  );
  if (!vet) throw t('not_found');

  // match or create the client and pet
  if (!patientId) {
    const existingClient = await one(
      `select id from clients where clinic_id = $1 and lower(email) = lower($2)`,
      [clinic.id, ownerEmail]
    );
    if (existingClient) {
      clientId = existingClient.id;
      const existingPet = await one(
        `select id from patients where client_id = $1 and lower(name) = lower($2)`,
        [clientId, petName]
      );
      if (existingPet) patientId = existingPet.id;
    } else {
      const r = await q(
        `insert into clients (clinic_id, name, email) values ($1, $2, $3) returning id`,
        [clinic.id, ownerName, ownerEmail]
      );
      clientId = r.rows[0].id;
    }
    if (!patientId) {
      const pr = await q(
        `insert into patients (clinic_id, client_id, name, species) values ($1, $2, $3, $4) returning id`,
        [clinic.id, clientId, petName, species]
      );
      patientId = pr.rows[0].id;
    }
  }

  // take the first free room
  const rooms = await q(`select id, name from rooms where clinic_id = $1 order by position`, [clinic.id]);
  let booked = false;
  for (const room of rooms.rows) {
    if (await slotFree(clinic.id, vet.id, room.id, startAt, settings.slotMinutes)) {
      const ar = await q(
        `insert into appointments (clinic_id, patient_id, vet_id, room_id, start_at, minutes, reason)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [clinic.id, patientId, vet.id, room.id, startAt, settings.slotMinutes, REASON_TO_INTERNAL[reason]]
      );
      booked = true;
      const code = crypto.randomBytes(16).toString('base64url').replace(/[-_]/g, 'a');
      await q(
        `insert into bookings (code, clinic_id, appointment_id, owner_email) values ($1, $2, $3, $4)`,
        [code, clinic.id, ar.rows[0].id, ownerEmail]
      );
      bus.pushClinic(clinic.id, 'appointments', {});
      bus.pushClinic(clinic.id, 'beacons', {});
      enqueueMail({
        to: ownerEmail,
        subject: `Booking confirmed: ${petName} on ${clinicDayShort(startAt)} ${clinicDayMonth(startAt)} at ${clinicTimeOf(startAt)}`,
        text: `Hello ${ownerName},\n\n${clinic.name} has booked ${petName} with ${vet.name} on ${clinicDayShort(startAt)} ${clinicDayMonth(startAt)} at ${clinicTimeOf(startAt)} (clinic time).\n`,
        clinicId: clinic.id,
        kind: 'booking',
      });
      return {
        status: 201,
        body: { code, petName, vetName: vet.name, start: startAt.toISOString(), ownerEmail },
      };
    }
  }
  if (!booked) throw t('slot_taken');
}));

router.get('/public/bookings/:code', handler(async (req, res) => {
  const row = await one(
    `select b.*, a.start_at, a.vet_id, p.name as pet_name, c.name as clinic_name
     from bookings b
     join appointments a on a.id = b.appointment_id
     join patients p on p.id = a.patient_id
     join clinics c on c.id = b.clinic_id
     where b.code = $1`,
    [req.params.code]
  );
  if (!row) throw t('not_found');
  const vet = await one(`select name from users where id = $1`, [row.vet_id]);
  return {
    status: 200,
    body: {
      clinicName: row.clinic_name,
      petName: row.pet_name,
      vetName: vet?.name,
      start: new Date(row.start_at).toISOString(),
      ownerEmail: row.owner_email,
    },
  };
}));

export default router;
