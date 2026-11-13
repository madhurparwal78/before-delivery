import type { InterpreterChoice } from '../../../shared/api.js';
import { isBusy } from '../../actions/common.js';
import { pool } from '../../db/pool.js';
import { isQualified } from '../../domain/qualification.js';
import { codePointLength } from '../../domain/text.js';
import { allInterpreters } from '../../store/people.js';
import { requireVisibleBooking } from '../../store/visibility.js';
import { FIELD_MESSAGES, validationError } from '../errors.js';
import { requireRole } from '../roles.js';
import { actor, route } from '../router.js';

route('GET', '/api/interpreters', async (ctx) => {
  const user = requireRole(actor(ctx), 'coordinator');
  const rawQuery = ctx.url.searchParams.get('q');
  if (rawQuery !== null && codePointLength(rawQuery) > 80) {
    throw validationError({ q: FIELD_MESSAGES.q });
  }
  const needle = (rawQuery ?? '').trim().toLowerCase();
  const bookingId = ctx.url.searchParams.get('booking_id');
  const booking = bookingId === null ? null : await requireVisibleBooking(user, bookingId);

  const interpreters = await allInterpreters();
  const matching = interpreters.filter((interpreter) =>
    needle === '' ? true : interpreter.name.toLowerCase().includes(needle),
  );

  const choices: InterpreterChoice[] = [];
  for (const interpreter of matching) {
    const qualified =
      booking === null
        ? null
        : isQualified(interpreter.credentials, booking.setting, booking.assignment_date);
    choices.push({
      id: interpreter.id,
      name: interpreter.name,
      initials: interpreter.initials,
      credentials: interpreter.credentials,
      phone: interpreter.phone,
      email: interpreter.email,
      home_city: interpreter.home_city,
      pay_rate_cents: interpreter.pay_rate_cents,
      qualified,
      busy: booking === null ? null : await isBusy(pool, interpreter.id, booking),
    });
  }
  return { status: 200, body: { interpreters: choices } };
});
