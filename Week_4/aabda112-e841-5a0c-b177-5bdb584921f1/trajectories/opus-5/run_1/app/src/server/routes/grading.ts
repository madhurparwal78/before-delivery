import { Router } from 'express';
import { config } from '../config';
import { isClinicDate, parseClinicDateTime, serverNow, serverNowIso, setServerClock } from '../clock';
import { query, transaction, type Tx } from '../db';
import { AppError, invalid } from '../errors';
import { body, created, ok, route } from '../http';
import { createLoginToken, isRole, type Role } from '../auth';
import {
  addNoteParagraphs,
  createAppointment,
  createClient,
  createClinic,
  createHospitalisation,
  createInvoice,
  createPatient,
  createRoom,
  createStockItem,
  createUser,
} from '../seedkit';
import { pushAfterClockChange } from '../ticker';
import { appUrl } from './staff';
import { isSpecies } from '../domain/booking';

export const gradingRouter = Router();

function requireGradingToken(token: string | undefined): void {
  if (!config.gradingToken) throw new AppError('not_found');
  if (token !== config.gradingToken) throw new AppError('unauthenticated');
}

gradingRouter.get(
  '/api/grading/clock',
  route(async (request) => {
    requireGradingToken(request.header('X-Grading-Token') ?? undefined);
    return ok({ now: serverNowIso() });
  }),
);

gradingRouter.post(
  '/api/grading/clock',
  route(async (request) => {
    requireGradingToken(request.header('X-Grading-Token') ?? undefined);
    const input = body(request);
    if (typeof input.now !== 'string' || Number.isNaN(Date.parse(input.now))) {
      throw invalid('now');
    }
    await setServerClock(Date.parse(input.now));
    await query('delete from booking_attempts');
    await pushAfterClockChange();
    return ok({ now: serverNowIso() });
  }),
);

type Refs = Map<string, string>;

function refLookup(refs: Refs, value: unknown, field: string): string {
  if (typeof value !== 'string' || !refs.has(value)) throw invalid(field);
  return refs.get(value) as string;
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  return value.map((item) => (item ?? {}) as Record<string, unknown>);
}

function readString(item: Record<string, unknown>, key: string, field: string): string {
  const value = item[key];
  if (typeof value !== 'string' || value.trim().length === 0) throw invalid(field);
  return value.trim();
}

function readInstant(item: Record<string, unknown>, key: string, field: string): number {
  const value = item[key];
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw invalid(field);
  return Date.parse(value);
}

gradingRouter.post(
  '/api/grading/seed',
  route(async (request) => {
    requireGradingToken(request.header('X-Grading-Token') ?? undefined);
    const input = body(request);
    const now = serverNow();
    const clinics: Refs = new Map();
    const users: Refs = new Map();
    const rooms: Refs = new Map();
    const clients: Refs = new Map();
    const patients: Refs = new Map();
    const appointments: Refs = new Map();
    const hospitalised: Refs = new Map();
    const stock: Refs = new Map();
    const invoices: Refs = new Map();
    const treatmentIds = new Map<string, string[]>();
    const clinicOfUser = new Map<string, string>();

    await transaction(async (tx: Tx) => {
      for (const [index, item] of asArray(input.clinics).entries()) {
        const id = await createClinic(tx, {
          name: readString(item, 'name', `clinics.${index}.name`),
          slug: readString(item, 'slug', `clinics.${index}.slug`),
        });
        clinics.set(readString(item, 'ref', `clinics.${index}.ref`), id);
      }
      for (const [index, item] of asArray(input.users).entries()) {
        const clinicId = refLookup(clinics, item.clinic, `users.${index}.clinic`);
        if (!isRole(item.role)) throw invalid(`users.${index}.role`);
        const id = await createUser(tx, {
          clinicId,
          name: readString(item, 'name', `users.${index}.name`),
          email: readString(item, 'email', `users.${index}.email`),
          role: item.role as Role,
        });
        users.set(readString(item, 'ref', `users.${index}.ref`), id);
        clinicOfUser.set(id, clinicId);
      }
      for (const [index, item] of asArray(input.rooms).entries()) {
        const clinicId = refLookup(clinics, item.clinic, `rooms.${index}.clinic`);
        const id = await createRoom(tx, {
          clinicId,
          name: readString(item, 'name', `rooms.${index}.name`),
          sort: index,
        });
        rooms.set(readString(item, 'ref', `rooms.${index}.ref`), id);
      }
      for (const [index, item] of asArray(input.clients).entries()) {
        const clinicId = refLookup(clinics, item.clinic, `clients.${index}.clinic`);
        const id = await createClient(tx, {
          clinicId,
          name: readString(item, 'name', `clients.${index}.name`),
          email: readString(item, 'email', `clients.${index}.email`),
        });
        clients.set(readString(item, 'ref', `clients.${index}.ref`), id);
      }
      for (const [index, item] of asArray(input.patients).entries()) {
        const clinicId = refLookup(clinics, item.clinic, `patients.${index}.clinic`);
        const clientId = refLookup(clients, item.client, `patients.${index}.client`);
        if (!isSpecies(item.species)) throw invalid(`patients.${index}.species`);
        const vaccinations = asArray(item.vaccinations).map((entry, vIndex) => {
          const dueDate = entry.dueDate;
          if (!isClinicDate(dueDate)) throw invalid(`patients.${index}.vaccinations.${vIndex}.dueDate`);
          return {
            vaccine: readString(entry, 'vaccine', `patients.${index}.vaccinations.${vIndex}.vaccine`),
            dueDate,
          };
        });
        const weights = asArray(item.weights).map((entry, wIndex) => {
          const recordedOn = entry.recordedOn;
          if (!isClinicDate(recordedOn)) throw invalid(`patients.${index}.weights.${wIndex}.recordedOn`);
          if (typeof entry.grams !== 'number') throw invalid(`patients.${index}.weights.${wIndex}.grams`);
          return { recordedOn, grams: entry.grams };
        });
        const id = await createPatient(tx, {
          clinicId,
          clientId,
          name: readString(item, 'name', `patients.${index}.name`),
          species: item.species,
          weightGrams: typeof item.weightGrams === 'number' ? item.weightGrams : null,
          photo: item.photo === true,
          vaccinations,
          weights,
        });
        patients.set(readString(item, 'ref', `patients.${index}.ref`), id);
      }
      for (const [index, item] of asArray(input.appointments).entries()) {
        const clinicId = refLookup(clinics, item.clinic, `appointments.${index}.clinic`);
        const patientId = refLookup(patients, item.patient, `appointments.${index}.patient`);
        const vetId = refLookup(users, item.vet, `appointments.${index}.vet`);
        const roomId = refLookup(rooms, item.room, `appointments.${index}.room`);
        const start = readInstant(item, 'start', `appointments.${index}.start`);
        const minutes = typeof item.minutes === 'number' ? item.minutes : 15;
        const status = typeof item.status === 'string' ? item.status : 'booked';
        const checkedInAt =
          typeof item.checkedInAt === 'string' && !Number.isNaN(Date.parse(item.checkedInAt))
            ? Date.parse(item.checkedInAt)
            : null;
        const id = await createAppointment(tx, {
          clinicId,
          patientId,
          vetId,
          roomId,
          start,
          minutes,
          reason: typeof item.reason === 'string' ? item.reason : 'Consult',
          status,
          checkedInAt,
        });
        if (status === 'completed' && Array.isArray(item.note)) {
          await addNoteParagraphs(
            tx,
            id,
            (item.note as unknown[]).map(String),
            vetId,
          );
        }
        appointments.set(readString(item, 'ref', `appointments.${index}.ref`), id);
      }
      for (const [index, item] of asArray(input.hospitalised).entries()) {
        const patientId = refLookup(patients, item.patient, `hospitalised.${index}.patient`);
        const patientClinic = await tx.one<{ clinic_id: string }>(
          'select clinic_id from patients where id = $1',
          [patientId],
        );
        const treatments = asArray(item.treatments).map((entry, tIndex) => {
          const path = `hospitalised.${index}.treatments.${tIndex}`;
          const firstAtRaw = entry.firstAt;
          let firstAt: number;
          if (typeof firstAtRaw === 'string' && /Z$/.test(firstAtRaw.trim())) {
            firstAt = readInstant(entry, 'firstAt', `${path}.firstAt`);
          } else {
            const parsed = parseClinicDateTime(firstAtRaw);
            if (parsed === 'malformed' || parsed === null) throw invalid(`${path}.firstAt`);
            firstAt = parsed;
          }
          if (typeof entry.intervalHours !== 'number') throw invalid(`${path}.intervalHours`);
          if (typeof entry.count !== 'number') throw invalid(`${path}.count`);
          return {
            name: readString(entry, 'name', `${path}.name`),
            firstAt,
            intervalHours: entry.intervalHours,
            count: entry.count,
            givenDoses: Array.isArray(entry.givenDoses)
              ? (entry.givenDoses as unknown[]).map(Number)
              : [],
          };
        });
        const nurse = await tx.one<{ id: string }>(
          `select id from users where clinic_id = $1 and role in ('nurse','vet','manager')
            order by case role when 'nurse' then 0 when 'vet' then 1 else 2 end, created_at limit 1`,
          [patientClinic?.clinic_id ?? ''],
        );
        const result = await createHospitalisation(tx, {
          clinicId: patientClinic?.clinic_id ?? '',
          patientId,
          kennel: readString(item, 'kennel', `hospitalised.${index}.kennel`),
          treatments,
          now,
          givenBy: nurse?.id ?? null,
        });
        const ref = readString(item, 'ref', `hospitalised.${index}.ref`);
        hospitalised.set(ref, result.id);
        treatmentIds.set(ref, result.treatmentIds);
      }
      for (const [index, item] of asArray(input.stock).entries()) {
        const clinicId = refLookup(clinics, item.clinic, `stock.${index}.clinic`);
        const batches = asArray(item.batches).map((entry, bIndex) => {
          const path = `stock.${index}.batches.${bIndex}`;
          if (!isClinicDate(entry.expiresOn)) throw invalid(`${path}.expiresOn`);
          if (typeof entry.quantity !== 'number') throw invalid(`${path}.quantity`);
          return {
            batch: readString(entry, 'batch', `${path}.batch`),
            expiresOn: entry.expiresOn,
            quantity: entry.quantity,
          };
        });
        const id = await createStockItem(tx, {
          clinicId,
          name: readString(item, 'name', `stock.${index}.name`),
          onHand: typeof item.onHand === 'number' ? item.onHand : 0,
          reorderPoint: typeof item.reorderPoint === 'number' ? item.reorderPoint : 0,
          unitPricePence: typeof item.unitPricePence === 'number' ? item.unitPricePence : 0,
          batches,
          now,
        });
        stock.set(readString(item, 'ref', `stock.${index}.ref`), id);
      }
      for (const [index, item] of asArray(input.invoices).entries()) {
        const clinicId = refLookup(clinics, item.clinic, `invoices.${index}.clinic`);
        const patientId = refLookup(patients, item.patient, `invoices.${index}.patient`);
        const lines = asArray(item.lines).map((entry, lIndex) => {
          const path = `invoices.${index}.lines.${lIndex}`;
          if (typeof entry.quantity !== 'number') throw invalid(`${path}.quantity`);
          return {
            stockItemId: refLookup(stock, entry.stock, `${path}.stock`),
            quantity: entry.quantity,
          };
        });
        const fallback = await tx.one<{ id: string }>(
          `select id from users where clinic_id = $1 and role in ('front-desk','manager')
            order by case role when 'front-desk' then 0 else 1 end, created_at limit 1`,
          [clinicId],
        );
        const payments = asArray(item.payments).map((entry, pIndex) => {
          const path = `invoices.${index}.payments.${pIndex}`;
          if (typeof entry.pence !== 'number') throw invalid(`${path}.pence`);
          const by = entry.by === undefined ? fallback?.id : refLookup(users, entry.by, `${path}.by`);
          if (!by) throw invalid(`${path}.by`);
          return { pence: entry.pence, by };
        });
        const actorId = fallback?.id ?? '';
        const id = await createInvoice(tx, {
          clinicId,
          patientId,
          status: item.status === 'issued' ? 'issued' : 'draft',
          discountPercent: typeof item.discountPercent === 'number' ? item.discountPercent : 0,
          lines,
          payments,
          now,
          actorId,
        });
        invoices.set(readString(item, 'ref', `invoices.${index}.ref`), id);
      }
    });

    const userPayload: Record<string, { id: string; login_url: string }> = {};
    for (const [ref, id] of users) {
      const token = await createLoginToken(id);
      userPayload[ref] = { id, login_url: `${appUrl(request)}/auth/link/${token}` };
    }
    await pushAfterClockChange();
    return created({
      clinics: Object.fromEntries(clinics),
      users: userPayload,
      rooms: Object.fromEntries(rooms),
      clients: Object.fromEntries(clients),
      patients: Object.fromEntries(patients),
      appointments: Object.fromEntries(appointments),
      hospitalised: Object.fromEntries(hospitalised),
      treatments: Object.fromEntries(treatmentIds),
      stock: Object.fromEntries(stock),
      invoices: Object.fromEntries(invoices),
    });
  }),
);
