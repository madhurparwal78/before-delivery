import { randomUUID } from 'node:crypto';
import { jsonResponse, type RequestContext } from '../http/context.js';
import {
  conflict,
  mailUnavailable,
  notFound,
  rateLimited,
  validationFailed,
} from '../http/errors.js';
import { route, type CompiledRoute } from '../http/router.js';
import { FieldProblems, isValidEmail, requireEmail, requireName } from '../http/validate.js';
import { inTransaction, instantOf, instantParam, isUniqueViolation, maybeInstant } from '../db.js';
import {
  bookableSlotsAfter,
  isBookableSlot,
  resolveWeek,
  slotEndsAt,
  slotRange,
  slotsOnDate,
  weekDays,
} from '../domain/slots.js';
import { addDays, formatDateTime, isoSeconds, startOfBrusselsDay } from '../../shared/brussels.js';
import { copy } from '../../shared/copy.js';
import { newToken } from '../http/sessions.js';
import { MailUnavailable } from '../services/mail.js';
import { APPOINTMENT_BOOKING_LIMIT } from '../../shared/shop.js';

interface AppointmentRecord {
  id: string;
  startsAt: number;
  endsAt: number;
  name: string;
  email: string;
  cancelToken: string;
  cancelledAt: number | null;
}

function appointmentOf(row: Record<string, unknown>): AppointmentRecord {
  return {
    id: row['id'] as string,
    startsAt: instantOf(row['starts_at']),
    endsAt: instantOf(row['ends_at']),
    name: row['name'] as string,
    email: row['email'] as string,
    cancelToken: row['cancel_token'] as string,
    cancelledAt: maybeInstant(row['cancelled_at']),
  };
}

async function takenSlots(ctx: RequestContext, from: number, to: number): Promise<Set<number>> {
  const { rows } = await ctx.app.db.query(
    `SELECT starts_at FROM appointments
      WHERE cancelled_at IS NULL AND starts_at >= $1 AND starts_at < $2`,
    [instantParam(from), instantParam(to)],
  );
  return new Set(rows.map((row) => instantOf(row['starts_at'])));
}

/** The earliest free slot after a taken one, inside the bookable range. */
async function nextFreeSlot(ctx: RequestContext, after: number): Promise<number | null> {
  const range = slotRange(ctx.now);
  const taken = await takenSlots(ctx, after, startOfBrusselsDay(range.endDate));
  for (const slot of bookableSlotsAfter(after, ctx.now)) {
    if (!taken.has(slot)) return slot;
  }
  return null;
}

async function appointmentByToken(ctx: RequestContext): Promise<AppointmentRecord> {
  const { rows } = await ctx.app.db.query(
    `SELECT id, starts_at, ends_at, name, email, cancel_token, cancelled_at
       FROM appointments WHERE cancel_token = $1`,
    [ctx.param('token')],
  );
  const row = rows[0];
  if (row === undefined) throw notFound();
  return appointmentOf(row);
}

export const appointmentRoutes: CompiledRoute[] = [
  route({
    method: 'GET',
    path: '/api/appointment-slots',
    access: 'public',
    handle: async (ctx) => {
      const week = resolveWeek(ctx.query('week'), ctx.now);
      if (week === null) {
        throw validationFailed({ week: 'Choose a Monday inside the next 32 weeks.' });
      }
      const range = slotRange(ctx.now);
      const firstBookable = startOfBrusselsDay(range.firstDate);
      const lastBookable = startOfBrusselsDay(range.endDate);
      const taken = await takenSlots(ctx, startOfBrusselsDay(week), startOfBrusselsDay(addDays(week, 7)));

      const slots = weekDays(week)
        .flatMap((date) => slotsOnDate(date))
        .filter((startsAt) => startsAt >= firstBookable && startsAt < lastBookable)
        .map((startsAt) => ({
          startsAt: isoSeconds(startsAt),
          endsAt: isoSeconds(slotEndsAt(startsAt)),
          free: !taken.has(startsAt),
        }));

      return jsonResponse(200, {
        weekStart: week,
        previousWeek: week > range.firstWeek ? addDays(week, -7) : null,
        nextWeek: week < range.lastWeek ? addDays(week, 7) : null,
        slots,
      });
    },
  }),

  route({
    method: 'POST',
    path: '/api/appointments',
    access: 'public',
    earlyLimit: async (ctx) => {
      // The booking limit is keyed on the request's email, so it is judged as soon as
      // that key is known.
      const body = ctx.peekJson();
      const email = body === null ? null : body['email'];
      if (!isValidEmail(email)) return;
      const windowMs = ctx.app.config.appointmentRateWindowSeconds * 1_000;
      const { rows } = await ctx.app.db.query(
        `SELECT created_at FROM appointments
          WHERE email_lower = $1 AND created_at > $2 ORDER BY created_at`,
        [email.trim().toLowerCase(), instantParam(ctx.now - windowMs)],
      );
      if (rows.length >= APPOINTMENT_BOOKING_LIMIT) {
        const oldest = instantOf(rows[0]?.['created_at']);
        throw rateLimited(copy.bookingLimit, (oldest + windowMs - ctx.now) / 1_000);
      }
    },
    handle: async (ctx) => {
      const body = ctx.json();
      const problems = new FieldProblems();
      const name = requireName(problems, body);
      const email = requireEmail(problems, body);
      const startsAtRaw = body['startsAt'];
      const startsAt =
        typeof startsAtRaw === 'string' && !Number.isNaN(Date.parse(startsAtRaw))
          ? Date.parse(startsAtRaw)
          : null;
      if (startsAt === null || !isBookableSlot(startsAt, ctx.now)) {
        problems.add('startsAt', 'Choose a free slot from the appointment page.');
      }
      problems.throwIfAny();

      const slot = startsAt as number;
      const id = randomUUID();
      const cancelToken = newToken();

      const created = await inTransaction(ctx.app.db, async (tx) => {
        try {
          await tx.query(
            `INSERT INTO appointments (id, starts_at, ends_at, name, email, email_lower,
                                       cancel_token, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              id,
              instantParam(slot),
              instantParam(slotEndsAt(slot)),
              name,
              email,
              email.toLowerCase(),
              cancelToken,
              instantParam(ctx.now),
            ],
          );
        } catch (error) {
          if (isUniqueViolation(error)) return null;
          throw error;
        }

        try {
          await ctx.app.mailer.sendSlotConfirmation({
            to: email,
            startsAt: slot,
            cancelUrl: `${ctx.app.config.publicUrl}/appointments/cancel/${cancelToken}`,
          });
        } catch (error) {
          if (error instanceof MailUnavailable) throw mailUnavailable(copy.mailDown);
          throw error;
        }
        return { id, startsAt: slot, endsAt: slotEndsAt(slot) };
      });

      if (created === null) {
        const free = await nextFreeSlot(ctx, slot);
        throw conflict(
          'slot_taken',
          free === null ? copy.slotTakenNoneLeft : copy.slotTaken(formatDateTime(free)),
        );
      }

      return jsonResponse(201, {
        appointment: {
          id: created.id,
          startsAt: isoSeconds(created.startsAt),
          endsAt: isoSeconds(created.endsAt),
        },
      });
    },
  }),

  route({
    method: 'GET',
    path: '/api/appointments',
    access: 'desk',
    handle: async (ctx) => {
      const { rows } = await ctx.app.db.query(
        `SELECT id, starts_at, ends_at, name, email, cancel_token, cancelled_at
           FROM appointments
          WHERE cancelled_at IS NULL AND starts_at >= $1
          ORDER BY starts_at`,
        [instantParam(ctx.now)],
      );
      return jsonResponse(200, {
        appointments: rows.map((row) => {
          const appointment = appointmentOf(row);
          return {
            id: appointment.id,
            startsAt: isoSeconds(appointment.startsAt),
            endsAt: isoSeconds(appointment.endsAt),
            name: appointment.name,
            email: appointment.email,
          };
        }),
      });
    },
  }),

  route({
    method: 'GET',
    path: '/api/appointments/by-token/:token',
    access: 'public',
    resolve: appointmentByToken,
    handle: async (_ctx, appointment) =>
      jsonResponse(200, {
        appointment: {
          startsAt: isoSeconds(appointment.startsAt),
          endsAt: isoSeconds(appointment.endsAt),
          status: appointment.cancelledAt === null ? 'booked' : 'cancelled',
        },
      }),
  }),

  route({
    method: 'POST',
    path: '/api/appointments/by-token/:token/cancel',
    access: 'public',
    expects: 'none',
    resolve: appointmentByToken,
    handle: async (ctx, appointment) => {
      if (appointment.cancelledAt !== null) {
        throw conflict('already_cancelled', 'This appointment was already cancelled.');
      }
      await ctx.app.db.query(`UPDATE appointments SET cancelled_at = $2 WHERE id = $1`, [
        appointment.id,
        instantParam(ctx.now),
      ]);
      return jsonResponse(200, {
        appointment: {
          startsAt: isoSeconds(appointment.startsAt),
          endsAt: isoSeconds(appointment.endsAt),
          status: 'cancelled',
        },
      });
    },
  }),
];
