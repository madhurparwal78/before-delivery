import type { AuditEntry, Booking, SessionUser } from '../../../shared/api.js';
import { query } from '../../db/pool.js';
import {
  agencyDate,
  agencyIso,
  dateOnlyAddDays,
  daysBetweenDateOnly,
  parseDateOnly,
} from '../../domain/time.js';
import {
  assignSeat,
  cancelBooking,
  checkInBooking,
  claimSeat,
  completeBooking,
  createBooking,
  makeTeamBooking,
  postOpenCall,
  quoteFor,
  releaseSeat,
} from '../../actions/bookings.js';
import { loadBookings, type BookingRecord } from '../../store/bookings.js';
import { credentialsOf, requireVisibleBooking } from '../../store/visibility.js';
import { bookingView, isOfferedTo, openCallStatusOf } from '../../views/booking.js';
import { apiError, FIELD_MESSAGES, invalidTransition, validationError } from '../errors.js';
import { requireRole } from '../roles.js';
import { actor, route, type RequestContext } from '../router.js';
import { validateBookingDraft } from '../validation.js';

function view(booking: BookingRecord, user: SessionUser, now: Date): Booking {
  return bookingView(booking, user, now);
}

async function knownOrgIds(): Promise<string[]> {
  const rows = await query<{ id: string }>('SELECT id FROM orgs');
  return rows.map((row) => row.id);
}

function rangeFrom(ctx: RequestContext): { from: string; to: string } {
  const rawFrom = ctx.url.searchParams.get('from');
  const rawTo = ctx.url.searchParams.get('to');
  const from = rawFrom === null ? agencyDate(ctx.now) : parseDateOnly(rawFrom);
  if (from === null) throw validationError({ from: FIELD_MESSAGES.range });
  const to = rawTo === null ? dateOnlyAddDays(from, 13) : parseDateOnly(rawTo);
  if (to === null) throw validationError({ to: FIELD_MESSAGES.range });
  const span = daysBetweenDateOnly(from, to);
  if (span < 0 || span > 30) {
    throw validationError({ from: FIELD_MESSAGES.range, to: FIELD_MESSAGES.range });
  }
  return { from, to };
}

route('GET', '/api/bookings', async (ctx) => {
  const user = actor(ctx);
  const { from, to } = rangeFrom(ctx);
  const clauses = ['b.assignment_date BETWEEN $1 AND $2'];
  const params: unknown[] = [from, to];
  if (user.role === 'requester') {
    clauses.push(`b.org_id = $${params.length + 1}`);
    params.push(user.org_id);
  } else if (user.role === 'interpreter') {
    clauses.push(
      `b.id IN (SELECT booking_id FROM seats WHERE holder_id = $${params.length + 1})`,
    );
    params.push(user.id);
  }
  const bookings = await loadBookings(clauses.join(' AND '), params);
  return {
    status: 200,
    body: { bookings: bookings.map((booking) => view(booking, user, ctx.now)) },
  };
});

route('GET', '/api/open-calls', async (ctx) => {
  const user = requireRole(actor(ctx), 'interpreter');
  const credentials = await credentialsOf(user.id);
  const bookings = await loadBookings('b.open_call_closes_at IS NOT NULL', [], 'b.start_at, b.ref');
  const offered = bookings.filter(
    (booking) =>
      isOfferedTo(booking, credentials) &&
      openCallStatusOf(booking, ctx.now) === 'open' &&
      booking.seats.some((seat) => seat.holder === null) &&
      !booking.seats.some((seat) => seat.holder?.id === user.id),
  );
  return {
    status: 200,
    body: { bookings: offered.map((booking) => view(booking, user, ctx.now)) },
  };
});

route(
  'POST',
  '/api/bookings',
  async (ctx) => {
    const user = requireRole(actor(ctx), 'requester', 'coordinator');
    const draft = validateBookingDraft(ctx.body, {
      now: ctx.now,
      orgIdFromBody: user.role === 'coordinator',
      knownOrgIds: await knownOrgIds(),
      requesterOrgId: user.org_id,
    });
    const booking = await createBooking(user, draft);
    return { status: 201, body: view(booking, user, ctx.now) };
  },
  { idempotent: true },
);

route('GET', '/api/bookings/:id', async (ctx) => {
  const user = actor(ctx);
  const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
  return { status: 200, body: view(booking, user, ctx.now) };
});

route(
  'POST',
  '/api/bookings/:id/team',
  async (ctx) => {
    const user = actor(ctx);
    const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
    requireRole(user, 'coordinator');
    const updated = await makeTeamBooking(user, booking.id);
    return { status: 200, body: view(updated, user, ctx.now) };
  },
  { idempotent: true },
);

route(
  'POST',
  '/api/bookings/:id/open-call',
  async (ctx) => {
    const user = actor(ctx);
    const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
    requireRole(user, 'coordinator');
    const updated = await postOpenCall(user, booking.id, ctx.now);
    return { status: 200, body: view(updated, user, ctx.now) };
  },
  { idempotent: true },
);

route(
  'POST',
  '/api/bookings/:id/claim',
  async (ctx) => {
    const user = actor(ctx);
    const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
    requireRole(user, 'interpreter');
    const updated = await claimSeat(user, booking.id, ctx.now);
    return { status: 200, body: view(updated, user, ctx.now) };
  },
  { idempotent: true },
);

route(
  'POST',
  '/api/bookings/:id/assign',
  async (ctx) => {
    const user = actor(ctx);
    const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
    requireRole(user, 'coordinator');
    const updated = await assignSeat(user, booking.id, ctx.body);
    return { status: 200, body: view(updated, user, ctx.now) };
  },
  { idempotent: true },
);

route(
  'POST',
  '/api/bookings/:id/seats/:seat/release',
  async (ctx) => {
    const user = actor(ctx);
    const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
    requireRole(user, 'coordinator', 'interpreter');
    const seat = Number(ctx.params['seat']);
    if (!Number.isInteger(seat)) throw apiError('not_found');
    const updated = await releaseSeat(user, booking.id, seat);
    return { status: 200, body: view(updated, user, ctx.now) };
  },
  { idempotent: true },
);

route('GET', '/api/bookings/:id/cancellation-quote', async (ctx) => {
  const user = actor(ctx);
  const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
  requireRole(user, 'requester', 'coordinator');
  if (['completed', 'cancelled', 'cancelled_late', 'in_progress'].includes(booking.status)) {
    throw invalidTransition(booking.status);
  }
  return { status: 200, body: await quoteFor(booking, ctx.now) };
});

route(
  'POST',
  '/api/bookings/:id/cancel',
  async (ctx) => {
    const user = actor(ctx);
    const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
    requireRole(user, 'requester', 'coordinator');
    const updated = await cancelBooking(user, booking.id, ctx.body, ctx.now);
    return { status: 200, body: view(updated, user, ctx.now) };
  },
  { idempotent: true },
);

route(
  'POST',
  '/api/bookings/:id/check-in',
  async (ctx) => {
    const user = actor(ctx);
    const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
    requireRole(user, 'coordinator');
    const updated = await checkInBooking(user, booking.id);
    return { status: 200, body: view(updated, user, ctx.now) };
  },
  { idempotent: true },
);

route(
  'POST',
  '/api/bookings/:id/complete',
  async (ctx) => {
    const user = actor(ctx);
    const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
    requireRole(user, 'coordinator');
    const updated = await completeBooking(user, booking.id, ctx.body, ctx.now);
    return { status: 200, body: view(updated, user, ctx.now) };
  },
  { idempotent: true },
);

route('GET', '/api/bookings/:id/audit', async (ctx) => {
  const user = actor(ctx);
  const booking = await requireVisibleBooking(user, ctx.params['id'] ?? '');
  requireRole(user, 'coordinator', 'billing_manager');
  const rows = await query<{
    at: string;
    actor_name: string;
    action: string;
    from_status: AuditEntry['from_status'];
    to_status: AuditEntry['to_status'];
    seat: number | null;
    interpreter_name: string | null;
  }>(
    `SELECT at, actor_name, action, from_status, to_status, seat, interpreter_name
     FROM audit_entries WHERE booking_id = $1 ORDER BY id`,
    [booking.id],
  );
  const entries: AuditEntry[] = rows.map((row) => ({
    at: agencyIso(new Date(row.at)),
    actor_name: row.actor_name,
    action: row.action,
    from_status: row.from_status,
    to_status: row.to_status,
    seat: row.seat,
    interpreter_name: row.interpreter_name,
  }));
  return { status: 200, body: { entries } };
});
