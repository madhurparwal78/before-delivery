// Routes: sessions, members, membership, settings, calendar, board, items, holds.

import { Ctx, requireCoordinator, requireMember, requireStaff, requireUser, RouteContext } from './context';
import { sendJsonResponse } from '../http';
import { COPY, conflict, notFound, providerDown, signOutFirst, validation } from '../errors';
import { readJson } from '../body';
import { createSession, setSessionCookie, endSession, clearSessionCookie } from '../sessions';
import { verifyPassword, hashPassword } from '../passwords';
import { TIER_PLANS, KillBillDown } from '../killbill';
import { getCalendar, getSettings, membershipIsActive, moveDueDates, recomputeItemStatus } from '../domain';
import { readBoard } from '../serialize';
import { WEEKDAYS, isQuarterHourTime, parseTimeMinutes, weekdayOpens, isDateValid, nextOpenDayAfter, today } from '../calendar';
import { dateInZone } from '../libraryTime';
import type { CalendarHours, Hold, Item, Membership, User } from '../../shared/api';


// POST /api/session
export async function postSession(ctx: Ctx): Promise<void> {
  const body = await readJson<{ email?: unknown; password?: unknown }>(ctx.req);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const row = await ctx.route.db.one<{ id: number; name: string; email: string; role: string; password_hash: string }>(
    'SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = $1',
    [email],
  );
  if (row === null || !(await verifyPassword(password, row.password_hash))) {
    sendJsonResponse(ctx.res, 401, { error: COPY.badCredentials });
    return;
  }
  if (ctx.auth.token !== null) await endSession(ctx.route.db, ctx.auth.token);
  const token = await createSession(ctx.route.db, row.id);
  setSessionCookie(ctx.res, token);
  sendJsonResponse(ctx.res, 200, { user: { id: row.id, name: row.name, email: row.email, role: row.role as User['role'] } });
}

// DELETE /api/session
export async function deleteSession(ctx: Ctx): Promise<void> {
  if (ctx.auth.token !== null) await endSession(ctx.route.db, ctx.auth.token);
  clearSessionCookie(ctx.res);
  ctx.res.writeHead(204).end();
}

// GET /api/me
export async function getMe(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  if (user.role === 'member') {
    await refreshMembershipFromKillBill(ctx.route, user.id);
  }
  const membership = await ctx.route.db.one<{ status: string; tier: string; active_until: string | null; ends_at_term: boolean }>(
    `SELECT status, tier, to_char(active_until, 'YYYY-MM-DD') as active_until, ends_at_term FROM memberships WHERE user_id = $1`,
    [user.id],
  );
  sendJsonResponse(ctx.res, 200, {
    user,
    membership:
      membership === null
        ? null
        : {
            status: membership.status as Membership['status'],
            tier: membership.tier as Membership['tier'],
            active_until: membership.active_until,
            ends_at_term: membership.ends_at_term,
          },
  });
}

// POST /api/members
export async function postMember(ctx: Ctx): Promise<void> {
  if (ctx.auth.user !== null) throw signOutFirst();
  const body = await readJson<{ name?: unknown; email?: unknown; password?: unknown; tier?: unknown }>(ctx.req);
  const fields: Record<string, string> = {};
  const order: string[] = [];
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const tier = typeof body?.tier === 'string' ? body.tier : '';
  if (name.length < 1 || name.length > 80) {
    fields['name'] = 'Enter a name up to 80 characters.';
    order.push('name');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fields['email'] = 'Enter an email address.';
    order.push('email');
  }
  if (password.length < 10) {
    fields['password'] = 'Use at least 10 characters.';
    order.push('password');
  }
  if (TIER_PLANS[tier] === undefined) {
    fields['tier'] = 'Pick a membership tier.';
    order.push('tier');
  }
  if (order.length > 0) throw validation(reorder(fields, order));

  const existing = await ctx.route.db.one<{ id: number }>('SELECT id FROM users WHERE lower(email) = $1', [email]);
  if (existing !== null) throw conflict(COPY.emailTaken);

  // Billing first: a failed join creates nothing in Pegworth.
  const tierPlan = TIER_PLANS[tier]!;
  let kbAccountId: string;
  let kbSubscriptionId: string;
  try {
    kbAccountId = await ensureKillBillAccount(ctx.route, email, name);
    kbSubscriptionId = await ensureSubscription(ctx.route, kbAccountId, tierPlan);
    await recordFirstInvoicePayment(ctx.route, kbAccountId);
  } catch (err) {
    if (err instanceof KillBillDown) throw providerDown(COPY.billingDownJoin);
    throw err;
  }

  const hash = await hashPassword(password);
  const result = await ctx.route.db.withClient(async (client) => {
    const userRow = await client.query<{ id: number; name: string; email: string; role: string }>(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id, name, email, role',
      [name, email, hash, 'member'],
    );
    if (userRow.rows.length === 0) return null;
    const user = userRow.rows[0]!;
    await client.query(
      'INSERT INTO memberships (user_id, status, tier, killbill_account_id, killbill_subscription_id) VALUES ($1, $2, $3, $4, $5)',
      [user.id, 'pending-payment', tier, kbAccountId, kbSubscriptionId],
    );
    return user;
  });
  if (result === null) throw conflict(COPY.emailTaken);

  const token = await createSession(ctx.route.db, result.id);
  setSessionCookie(ctx.res, token);
  sendJsonResponse(ctx.res, 202, {
    user: { id: result.id, name: result.name, email: result.email, role: result.role as User['role'] },
    membership: { status: 'pending-payment', tier: tier as Membership['tier'], active_until: null, ends_at_term: false },
  });
}

// GET /api/members
export async function getMembers(ctx: Ctx): Promise<void> {
  requireStaff(ctx);
  const rows = await ctx.route.db.query<{ id: number; name: string; email: string; membership_status: string | null }>(
    `SELECT u.id, u.name, u.email, m.status as membership_status
     FROM users u LEFT JOIN memberships m ON m.user_id = u.id
     WHERE u.role = 'member' ORDER BY u.name, u.id`,
  );
  sendJsonResponse(ctx.res, 200, {
    members: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      membership_status: (row.membership_status ?? 'pending-payment') as 'pending-payment' | 'active' | 'lapsed',
    })),
  });
}

// POST /api/membership/cancel
export async function cancelMembership(ctx: Ctx): Promise<void> {
  const user = requireMember(ctx);
  const membership = await ctx.route.db.one<{ status: string; ends_at_term: boolean; killbill_subscription_id: string | null }>(
    'SELECT status, ends_at_term, killbill_subscription_id FROM memberships WHERE user_id = $1',
    [user.id],
  );
  if (membership === null) throw conflict(COPY.onlyActiveCancel);
  if (membership.status !== 'active') throw conflict(COPY.onlyActiveCancel);
  if (membership.ends_at_term) throw conflict(COPY.alreadyEnding);
  try {
    if (membership.killbill_subscription_id !== null) {
      await ctx.route.killbill.cancelAtEndOfTerm(membership.killbill_subscription_id);
      const sub = await ctx.route.killbill.getSubscription(membership.killbill_subscription_id);
      const endDate = sub.billingEndDate ?? sub.chargedThroughDate;
      const activeUntil = endDate !== null ? endDate.slice(0, 10) : null;
      await ctx.route.db.exec('UPDATE memberships SET ends_at_term = true, active_until = $2 WHERE user_id = $1', [user.id, activeUntil]);
    }
  } catch (err) {
    if (err instanceof KillBillDown) throw providerDown(COPY.billingDownJoin);
    throw err;
  }
  const updated = await ctx.route.db.one<{ status: string; tier: string; active_until: string | null; ends_at_term: boolean }>(
    `SELECT status, tier, to_char(active_until, 'YYYY-MM-DD') as active_until, ends_at_term FROM memberships WHERE user_id = $1`,
    [user.id],
  );
  sendJsonResponse(ctx.res, 200, {
    membership: {
      status: updated!.status as Membership['status'],
      tier: updated!.tier as Membership['tier'],
      active_until: updated!.active_until,
      ends_at_term: updated!.ends_at_term,
    },
  });
}

// GET /api/settings
export async function getSettingsRoute(ctx: Ctx): Promise<void> {
  requireStaff(ctx);
  const settings = await getSettings(ctx.route.db);
  sendJsonResponse(ctx.res, 200, settings);
}

// PUT /api/settings
export async function putSettings(ctx: Ctx): Promise<void> {
  requireCoordinator(ctx);
  const body = await readJson<{ time_zone?: unknown; late_fee_cents?: unknown; damage_fee_cents?: unknown; loan_period_days?: unknown }>(ctx.req);
  const order: string[] = [];
  const fields: Record<string, string> = {};
  const timeZone = typeof body?.time_zone === 'string' ? body.time_zone : '';
  const lateFee = body?.late_fee_cents;
  const damageFee = body?.damage_fee_cents;
  const loanPeriod = body?.loan_period_days;
  let validZone = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone });
    validZone = timeZone !== '' && !/^[+-]\d/.test(timeZone);
  } catch {
    validZone = false;
  }
  if (!validZone) {
    fields['time_zone'] = 'Use an IANA time zone name, like America/Chicago.';
    order.push('time_zone');
  }
  if (!isWhole(lateFee) || Number(lateFee) < 0 || Number(lateFee) > 10000) {
    fields['late_fee_cents'] = 'Use a whole number of cents from 0 to 10,000.';
    order.push('late_fee_cents');
  }
  if (!isWhole(damageFee) || Number(damageFee) < 0 || Number(damageFee) > 100000) {
    fields['damage_fee_cents'] = 'Use a whole number of cents from 0 to 100,000.';
    order.push('damage_fee_cents');
  }
  if (!isWhole(loanPeriod) || Number(loanPeriod) < 1 || Number(loanPeriod) > 28) {
    fields['loan_period_days'] = 'Use a whole number of days from 1 to 28.';
    order.push('loan_period_days');
  }
  if (order.length > 0) throw validation(reorder(fields, order));
  await ctx.route.db.exec(
    'UPDATE settings SET time_zone = $1, late_fee_cents = $2, damage_fee_cents = $3, loan_period_days = $4 WHERE id = 1',
    [timeZone, Number(lateFee), Number(damageFee), Number(loanPeriod)],
  );
  const settings = await getSettings(ctx.route.db);
  sendJsonResponse(ctx.res, 200, settings);
}

// GET /api/calendar
export async function getCalendarRoute(ctx: Ctx): Promise<void> {
  const calendar = await getCalendar(ctx.route.db);
  const hours: CalendarHours[] = [];
  for (const weekday of WEEKDAYS) {
    const h = calendar.hours[weekday];
    if (h !== undefined) hours.push({ weekday, opens: h.opens, closes: h.closes });
  }
  const { nextOpenDays } = await import('../calendar');
  const closures = [...calendar.closures.entries()].map(([date, reason]) => ({ date, reason })).sort((a, b) => a.date.localeCompare(b.date));
  sendJsonResponse(ctx.res, 200, {
    time_zone: calendar.zone,
    hours,
    closures,
    next_open_days: nextOpenDays(calendar, new Date()),
  });
}

// PUT /api/calendar/hours
export async function putHours(ctx: Ctx): Promise<void> {
  requireCoordinator(ctx);
  const body = await readJson<{ hours?: unknown }>(ctx.req);
  const list = body?.hours;
  const fields: Record<string, string> = {};
  const order: string[] = [];
  const entries: { weekday: string; opens: string; closes: string }[] = [];
  const validWeekdays = new Set<string>(WEEKDAYS);
  let structural = false;
  if (!Array.isArray(list)) structural = true;
  else {
    const seen = new Set<string>();
    for (const entry of list) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        structural = true;
        break;
      }
      const record = entry as Record<string, unknown>;
      const weekday = typeof record['weekday'] === 'string' ? record['weekday'].toLowerCase() : '';
      const opens = typeof record['opens'] === 'string' ? record['opens'] : '';
      const closes = typeof record['closes'] === 'string' ? record['closes'] : '';
      if (!validWeekdays.has(weekday) || seen.has(weekday)) {
        structural = true;
        break;
      }
      seen.add(weekday);
      entries.push({ weekday, opens, closes });
    }
    if (entries.length === 0) structural = true;
  }
  if (structural) {
    throw validation({ hours: 'List the weekdays the library opens, each once, with opening and closing times.' });
  }
  const perWeekday = new Map(entries.map((e) => [e.weekday, e]));
  for (const weekday of WEEKDAYS) {
    const entry = perWeekday.get(weekday);
    if (entry === undefined) continue;
    const opensOk = isQuarterHourTime(entry.opens);
    const closesOk = isQuarterHourTime(entry.closes);
    const closesLater = (parseTimeMinutes(entry.closes) ?? 0) > (parseTimeMinutes(entry.opens) ?? 0);
    if (!opensOk) {
      fields[`hours.${weekday}.opens`] = 'Use a 24-hour time on the quarter hour, like 18:15.';
      order.push(`hours.${weekday}.opens`);
    }
    // One message per field: the closing-time format check only applies when the time is well formed.
    if (!closesOk) {
      fields[`hours.${weekday}.closes`] = 'Use a 24-hour time on the quarter hour, like 18:15.';
      order.push(`hours.${weekday}.closes`);
    } else if (!closesLater) {
      fields[`hours.${weekday}.closes`] = 'Closing time must be later than opening time.';
      order.push(`hours.${weekday}.closes`);
    }
  }
  if (order.length > 0) throw validation(reorder(fields, order));

  await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    for (const weekday of WEEKDAYS) {
      await client.query('DELETE FROM opening_hours WHERE weekday = $1', [weekday]);
    }
    for (const entry of entries) {
      await client.query('INSERT INTO opening_hours (weekday, opens, closes) VALUES ($1, $2, $3)', [entry.weekday, entry.opens, entry.closes]);
    }
    await client.query('COMMIT');
  });
  const calendar = await getCalendar(ctx.route.db);
  const moved = await moveDueDates(ctx.route.db, calendar);
  const hours: CalendarHours[] = [];
  for (const weekday of WEEKDAYS) {
    const h = calendar.hours[weekday];
    if (h !== undefined) hours.push({ weekday, opens: h.opens, closes: h.closes });
  }
  sendJsonResponse(ctx.res, 200, { hours, moved_loans: moved.moved });
}

// POST /api/closures
export async function postClosure(ctx: Ctx): Promise<void> {
  requireCoordinator(ctx);
  const body = await readJson<{ date?: unknown; reason?: unknown }>(ctx.req);
  const date = typeof body?.date === 'string' ? body.date.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const fields: Record<string, string> = {};
  const order: string[] = [];
  const calendar = await getCalendar(ctx.route.db);
  const todayStr = today(calendar, new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isDateValid(date)) {
    fields['date'] = 'Use a date in YYYY-MM-DD form.';
    order.push('date');
  } else if (date < todayStr) {
    fields['date'] = 'Closures can only be declared for today or later.';
    order.push('date');
  } else if (!weekdayOpens(calendar, date)) {
    // The 422 covers a weekday the library does not open; an already-closed day is the 409.
    fields['date'] = 'The library does not open on that weekday.';
    order.push('date');
  }
  if (reason.length < 1 || reason.length > 120) {
    fields['reason'] = 'Enter a reason up to 120 characters.';
    order.push('reason');
  }
  if (order.length > 0) throw validation(reorder(fields, order));
  const existing = await ctx.route.db.one<{ date: string }>('SELECT to_char(date, \'YYYY-MM-DD\') as date FROM closures WHERE date = to_date($1, \'YYYY-MM-DD\')', [date]);
  if (existing !== null) throw conflict(COPY.dayAlreadyClosed);
  await ctx.route.db.exec('INSERT INTO closures (date, reason) VALUES (to_date($1, \'YYYY-MM-DD\'), $2)', [date, reason]);
  const updatedCalendar = await getCalendar(ctx.route.db);
  const moved = await moveDueDates(ctx.route.db, updatedCalendar);
  sendJsonResponse(ctx.res, 201, { closure: { date, reason }, moved_loans: moved.moved, new_due_date: nextOpenDayAfter(updatedCalendar, date) });
}

// DELETE /api/closures/<date>
export async function deleteClosure(ctx: Ctx, dateSegment: string): Promise<void> {
  requireCoordinator(ctx);
  const date = dateSegment ?? '';
  const calendar = await getCalendar(ctx.route.db);
  const todayStr = today(calendar, new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isDateValid(date)) throw notFound();
  const row = await ctx.route.db.one<{ date: string }>('SELECT to_char(date, \'YYYY-MM-DD\') as date FROM closures WHERE date = to_date($1, \'YYYY-MM-DD\')', [date]);
  if (row === null) throw notFound();
  if (date < todayStr) throw conflict(COPY.pastClosures);
  await ctx.route.db.exec('DELETE FROM closures WHERE date = to_date($1, \'YYYY-MM-DD\')', [date]);
  ctx.res.writeHead(204).end();
}

// GET /api/board
export async function getBoard(ctx: Ctx): Promise<void> {
  const board = await readBoard(ctx.route.db);
  sendJsonResponse(ctx.res, 200, board);
}

// GET /api/items/<id>
export async function getItem(ctx: Ctx, idSegment: string): Promise<void> {
  const id = wholeIdNumber(idSegment);
  if (id === null) throw notFound();
  const row = await ctx.route.db.one<{ id: number; tag: string; name: string; replacement_cost_cents: number; status: string; due_date: string | null }>(
    `SELECT i.id, i.tag, i.name, i.replacement_cost_cents, i.status,
            to_char(l.due_date, 'YYYY-MM-DD') as due_date
     FROM items i
     LEFT JOIN LATERAL (
       SELECT l.due_date FROM loans l JOIN loan_items li ON li.loan_id = l.id
       WHERE li.item_id = i.id AND l.status IN ('out','pending-photo') LIMIT 1
     ) l ON true
     WHERE i.id = $1`,
    [id],
  );
  if (row === null) throw notFound();
  const parts = await ctx.route.db.query<{ id: number; item_id: number; name: string; shape: string; col: number; row: number; width: number; height: number; state: string }>(
    'SELECT id, item_id, name, shape, col, row, width, height, state FROM parts WHERE item_id = $1 ORDER BY row, col',
    [id],
  );
  const holdCount = await ctx.route.db.one<{ n: string }>(
    `SELECT count(*)::text as n FROM holds WHERE item_id = $1 AND status IN ('queued','ready')`,
    [id],
  );
  const item = {
    id: row.id,
    tag: row.tag,
    name: row.name,
    replacement_cost_cents: row.replacement_cost_cents,
    status: row.status as Item['status'],
    due_date: row.due_date,
    hold_queue_length: Number(holdCount?.n ?? 0),
    parts: parts.map((p) => ({
      id: p.id,
      item_id: p.item_id,
      name: p.name,
      shape: p.shape,
      col: p.col,
      row: p.row,
      width: p.width,
      height: p.height,
      state: p.state,
    })),
  };
  if (ctx.auth.user !== null && ctx.auth.user.role !== 'member') {
    const queueRows = await ctx.route.db.query<{ id: number; member_id: number; status: string; placed_at: Date }>(
      'SELECT id, member_id, status, placed_at FROM holds WHERE item_id = $1 AND status = \'queued\' ORDER BY placed_at, id',
      [id],
    );
    const members = await ctx.route.db.query<{ id: number; name: string }>('SELECT id, name FROM users');
    const nameMap = new Map(members.map((m) => [m.id, m.name]));
    sendJsonResponse(ctx.res, 200, {
      item,
      queue: queueRows.map((h, index) => ({ position: index + 1, member_name: nameMap.get(h.member_id) ?? '', status: h.status })),
    });
    return;
  }
  sendJsonResponse(ctx.res, 200, { item });
}

// POST /api/items
export async function postItem(ctx: Ctx): Promise<void> {
  requireCoordinator(ctx);
  const body = await readJson<{ tag?: unknown; name?: unknown; replacement_cost_cents?: unknown; parts?: unknown }>(ctx.req);
  const fields: Record<string, string> = {};
  const order: string[] = [];
  const tag = typeof body?.tag === 'string' ? body.tag.trim().toUpperCase() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const cost = body?.replacement_cost_cents;
  const parts = Array.isArray(body?.parts) ? body!.parts : null;
  if (!/^PW-\d{3,5}$/.test(tag)) {
    fields['tag'] = 'Use a tag like PW-123: PW- followed by 3 to 5 digits.';
    order.push('tag');
  }
  if (name.length < 1 || name.length > 80) {
    fields['name'] = 'Enter a name up to 80 characters.';
    order.push('name');
  }
  if (!isWhole(cost) || Number(cost) < 1 || Number(cost) > 1000000) {
    fields['replacement_cost_cents'] = 'Use a whole number of cents from 1 to 1,000,000.';
    order.push('replacement_cost_cents');
  }
  let validParts: { name: string; shape: string; width: number; height: number }[] | null = null;
  if (parts === null || parts.length < 1 || parts.length > 8) {
    fields['parts'] = 'List between 1 and 8 parts.';
    order.push('parts');
  } else {
    validParts = [];
    let partsOk = true;
    for (const part of parts) {
      if (part === null || typeof part !== 'object') {
        partsOk = false;
        break;
      }
      const record = part as Record<string, unknown>;
      const partName = typeof record['name'] === 'string' ? record['name'].trim() : '';
      const shape = typeof record['shape'] === 'string' ? record['shape'] : '';
      const width = record['width'];
      const height = record['height'];
      const shapes = ['drill', 'saw', 'ladder', 'hammer', 'wrench', 'case', 'battery', 'cable', 'blade', 'generic'];
      const widthOk = isWhole(width) && Number(width) >= 2 && Number(width) <= 10;
      const heightOk = isWhole(height) && Number(height) >= 2 && Number(height) <= 10;
      if (partName.length === 0 || !shapes.includes(shape) || !widthOk || !heightOk) {
        partsOk = false;
        break;
      }
      validParts.push({ name: partName, shape, width: Number(width), height: Number(height) });
    }
    if (!partsOk) {
      fields['parts'] = 'Each part needs a name, a shape, and a width and height of 2 to 10 holes.';
      order.push('parts');
      validParts = null;
    }
  }
  if (order.length > 0) throw validation(reorder(fields, order));
  const tagTaken = await ctx.route.db.one<{ id: number }>('SELECT id FROM items WHERE upper(tag) = $1', [tag]);
  if (tagTaken !== null) {
    throw validation({ tag: 'That tag is already on the board.' });
  }
  const { placePart } = await import('../schema');
  // Compute placement against existing parts.
  const existing = await ctx.route.db.query<{ col: number; row: number; width: number; height: number }>(
    'SELECT col, row, width, height FROM parts ORDER BY row, col',
  );
  const taken: { col: number; row: number; width: number; height: number }[] = [...existing];
  const occupied = (col: number, row: number): boolean =>
    taken.some((p) => col >= p.col && col < p.col + p.width && row >= p.row && row < p.row + p.height);
  const created = await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    const itemRow = await client.query<{ id: number }>(
      'INSERT INTO items (tag, name, replacement_cost_cents, status) VALUES ($1, $2, $3, $4) ON CONFLICT (tag) DO NOTHING RETURNING id',
      [tag, name, Number(cost), 'on-wall'],
    );
    if (itemRow.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }
    const itemId = itemRow.rows[0]!.id;
    for (const part of validParts!) {
      const spot = placePart(part.width, part.height, occupied);
      await client.query(
        'INSERT INTO parts (item_id, name, shape, col, row, width, height, state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [itemId, part.name, part.shape, spot.col, spot.row, part.width, part.height, 'hung'],
      );
      taken.push({ col: spot.col, row: spot.row, width: part.width, height: part.height });
    }
    await client.query('COMMIT');
    return itemId;
  });
  if (created === null) throw validation({ tag: 'That tag is already on the board.' });
  const item = await loadItemById(ctx.route.db, created);
  sendJsonResponse(ctx.res, 201, { item });
}

// PATCH /api/items/<id>
export async function patchItem(ctx: Ctx, idSegment: string): Promise<void> {
  requireCoordinator(ctx);
  const id = wholeIdNumber(idSegment);
  if (id === null) throw notFound();
  const body = await readJson<{ name?: unknown; replacement_cost_cents?: unknown }>(ctx.req);
  const record = (body ?? {}) as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((k) => k !== 'name' && k !== 'replacement_cost_cents');
  if (unknownKeys.length > 0) throw notFound();
  const fields: Record<string, string> = {};
  const order: string[] = [];
  if ('name' in record) {
    const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
    if (name.length < 1 || name.length > 80) {
      fields['name'] = 'Enter a name up to 80 characters.';
      order.push('name');
    }
  }
  if ('replacement_cost_cents' in record) {
    const cost = record['replacement_cost_cents'];
    if (!isWhole(cost) || Number(cost) < 1 || Number(cost) > 1000000) {
      fields['replacement_cost_cents'] = 'Use a whole number of cents from 1 to 1,000,000.';
      order.push('replacement_cost_cents');
    }
  }
  if (order.length > 0) throw validation(reorder(fields, order));
  const exists = await ctx.route.db.one<{ id: number }>('SELECT id FROM items WHERE id = $1', [id]);
  if (exists === null) throw notFound();
  if (typeof record['name'] === 'string') {
    await ctx.route.db.exec('UPDATE items SET name = $2 WHERE id = $1', [id, record['name'].trim()]);
  }
  if ('replacement_cost_cents' in record) {
    await ctx.route.db.exec('UPDATE items SET replacement_cost_cents = $2 WHERE id = $1', [id, Number(record['replacement_cost_cents'])]);
  }
  const item = await loadItemById(ctx.route.db, id);
  sendJsonResponse(ctx.res, 200, { item });
}

// GET /api/holds
export async function getHolds(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const itemFilter = ctx.query.get('item_id');
  if (user.role === 'member') {
    const rows = await ctx.route.db.query<{ id: number; item_id: number; member_id: number; status: string; placed_at: Date }>(
      'SELECT id, item_id, member_id, status, placed_at FROM holds WHERE member_id = $1 ORDER BY placed_at, id',
      [user.id],
    );
    const withPositions = await positionsFor(ctx.route.db, rows);
    sendJsonResponse(ctx.res, 200, { holds: rows.map((row) => holdApi(row, withPositions)) });
    return;
  }
  requireStaff(ctx);
  let rows: { id: number; item_id: number; member_id: number; status: string; placed_at: Date }[];
  if (itemFilter !== null && itemFilter !== undefined && itemFilter !== '') {
    if (wholeIdNumber(itemFilter) === null) throw notFound();
    rows = await ctx.route.db.query(
      'SELECT id, item_id, member_id, status, placed_at FROM holds WHERE item_id = $1 ORDER BY placed_at, id',
      [Number(itemFilter)],
    );
  } else {
    rows = await ctx.route.db.query('SELECT id, item_id, member_id, status, placed_at FROM holds ORDER BY placed_at, id');
  }
  const withPositions = await positionsFor(ctx.route.db, rows);
  sendJsonResponse(ctx.res, 200, { holds: rows.map((row) => holdApi(row, withPositions)) });
}

// POST /api/holds
export async function postHold(ctx: Ctx): Promise<void> {
  const user = requireMember(ctx);
  const body = await readJson<{ item_id?: unknown }>(ctx.req);
  const itemId = body?.item_id;
  if (!isWhole(itemId)) throw validation({ item_id: 'Name the tool to hold.' });
  const item = await ctx.route.db.one<{ id: number; tag: string; status: string }>('SELECT id, tag, status FROM items WHERE id = $1', [Number(itemId)]);
  if (item === null) throw notFound();
  const active = await membershipIsActive(ctx.route.db, user.id);
  if (!active) throw conflict(COPY.membershipNotActive);
  if (item.status === 'on-wall') throw conflict(COPY.toolOnWall);
  const existing = await ctx.route.db.one<{ id: number }>(
    `SELECT id FROM holds WHERE item_id = $1 AND member_id = $2 AND status IN ('queued','ready')`,
    [item.id, user.id],
  );
  if (existing !== null) throw conflict(COPY.alreadyHold);
  const result = await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    const again = await client.query<{ id: number }>(
      `SELECT id FROM holds WHERE item_id = $1 AND member_id = $2 AND status IN ('queued','ready') FOR UPDATE`,
      [item.id, user.id],
    );
    if (again.rows.length > 0) {
      await client.query('COMMIT');
      return null;
    }
    const inserted = await client.query<{ id: number; item_id: number; member_id: number; status: string; placed_at: Date }>(
      `INSERT INTO holds (item_id, member_id, status) VALUES ($1, $2, 'queued') RETURNING id, item_id, member_id, status, placed_at`,
      [item.id, user.id],
    );
    await client.query('COMMIT');
    return inserted.rows[0]!;
  });
  if (result === null) throw conflict(COPY.alreadyHold);
  const rows = await ctx.route.db.query<{ id: number; item_id: number; member_id: number; status: string; placed_at: Date }>(
    'SELECT id, item_id, member_id, status, placed_at FROM holds WHERE item_id = $1 AND status IN (\'queued\',\'ready\') ORDER BY placed_at, id',
    [item.id],
  );
  const positions = await positionsFor(ctx.route.db, rows);
  sendJsonResponse(ctx.res, 201, { hold: holdApi(result, positions) });
}

// DELETE /api/holds/<id>
export async function cancelHold(ctx: Ctx, idSegment: string): Promise<void> {
  const user = requireMember(ctx);
  const id = wholeIdNumber(idSegment);
  if (id === null) throw notFound();
  const row = await ctx.route.db.one<{ id: number; item_id: number; member_id: number; status: string; placed_at: Date }>(
    'SELECT id, item_id, member_id, status, placed_at FROM holds WHERE id = $1',
    [id],
  );
  if (row === null || row.member_id !== user.id) throw notFound();
  if (row.status === 'collected' || row.status === 'cancelled') throw conflict(COPY.holdNoLongerActive);
  await ctx.route.db.withClient(async (client) => {
    await client.query('BEGIN');
    const updated = await client.query<{ status: string }>(
      `UPDATE holds SET status = 'cancelled' WHERE id = $1 AND status IN ('queued','ready') RETURNING status`,
      [id],
    );
    if (updated.rows.length === 0) {
      await client.query('COMMIT');
      return false;
    }
    await client.query('COMMIT');
    return true;
  });
  // If a ready hold was cancelled while the tool is on the wall and complete, promote the next.
  const item = await ctx.route.db.one<{ id: number; status: string }>('SELECT id, status FROM items WHERE id = $1', [row.item_id]);
  if (item !== null && row.status === 'ready' && item.status === 'on-wall') {
    await promoteNextHold(ctx.route, row.item_id);
  }
  const fresh = await ctx.route.db.one<{ id: number; item_id: number; member_id: number; status: string; placed_at: Date }>(
    'SELECT id, item_id, member_id, status, placed_at FROM holds WHERE id = $1',
    [id],
  );
  const rows = fresh === null ? [] : await ctx.route.db.query<{ id: number; item_id: number; member_id: number; status: string; placed_at: Date }>(
    'SELECT id, item_id, member_id, status, placed_at FROM holds WHERE item_id = $1 AND status IN (\'queued\',\'ready\') ORDER BY placed_at, id',
    [fresh.item_id],
  );
  const positions = await positionsFor(ctx.route.db, rows);
  sendJsonResponse(ctx.res, 200, { hold: holdApi(fresh!, positions) });
}

// -- helpers ---------------------------------------------------------------

export function reorder(fields: Record<string, string>, order: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of order) out[key] = fields[key]!;
  return out;
}

export function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function wholeIdNumber(segment: string | undefined): number | null {
  if (segment === undefined || !/^\d+$/.test(segment)) return null;
  const n = Number(segment);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

async function positionsFor(db: RouteContext['db'], rows: { item_id: number; status: string; placed_at: Date }[]): Promise<Map<number, number>> {
  const byItem = new Map<number, { id: number; item_id: number; member_id: number; status: string; placed_at: Date }[]>();
  void byItem;
  const out = new Map<number, number>();
  const itemIds = [...new Set(rows.map((r) => r.item_id))];
  for (const itemId of itemIds) {
    const holds = await db.query<{ id: number; status: string; placed_at: Date }>(
      'SELECT id, status, placed_at FROM holds WHERE item_id = $1 AND status = \'queued\' ORDER BY placed_at, id',
      [itemId],
    );
    holds.forEach((h, index) => out.set(h.id, index + 1));
  }
  return out;
}

function holdApi(row: { id: number; item_id: number; member_id: number; status: string; placed_at: Date }, positions: Map<number, number>): Hold {
  return {
    id: row.id,
    item_id: row.item_id,
    member_id: row.member_id,
    status: row.status as Hold['status'],
    position: row.status === 'queued' ? positions.get(row.id) ?? null : null,
    placed_at: row.placed_at.toISOString(),
  };
}

async function loadItemById(db: RouteContext['db'], id: number): Promise<Item> {
  const board = await readBoard(db);
  const item = board.items.find((i) => i.id === id);
  if (item === undefined) throw notFound();
  return item;
}

// -- Kill Bill membership helpers ------------------------------------------

export async function ensureKillBillAccount(route: RouteContext, email: string, name: string): Promise<string> {
  const existing = await route.killbill.findAccount(email);
  if (existing !== null) return existing.accountId;
  const account = await route.killbill.createAccount(email, name, email);
  return account.accountId;
}

export async function ensureSubscription(route: RouteContext, accountId: string, planName: string): Promise<string> {
  const existing = await route.killbill.findActiveSubscription(accountId, planName);
  if (existing !== null) return existing.subscriptionId;
  const sub = await route.killbill.createSubscription(accountId, planName);
  return sub.subscriptionId;
}

/** Record the external payment for the subscription's first invoice, unless one already succeeded. */
export async function recordFirstInvoicePayment(route: RouteContext, accountId: string): Promise<void> {
  let invoiceId: string | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const invoices = await route.killbill.accountInvoices(accountId);
    if (invoices.length > 0) {
      invoiceId = invoices[0]!.invoiceId;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (invoiceId === null) return;
  const invoice = await route.killbill.getInvoice(invoiceId);
  if (invoice.balance <= 0.001) return; // already carries a successful payment
  await route.killbill.recordPayment(accountId, invoiceId, Math.round(invoice.balance * 100), `pegworth-join-${accountId}`);
}

/** Check Kill Bill for subscription ACTIVE and first invoice paid; update the membership. */
export async function refreshMembershipFromKillBill(route: RouteContext, userId: number): Promise<void> {
  const membership = await route.db.one<{
    status: string;
    tier: string;
    killbill_account_id: string | null;
    killbill_subscription_id: string | null;
  }>(
    'SELECT status, tier, killbill_account_id, killbill_subscription_id FROM memberships WHERE user_id = $1',
    [userId],
  );
  if (membership === null || membership.status !== 'pending-payment' || membership.killbill_account_id === null) return;
  try {
    const plan = TIER_PLANS[membership.tier];
    const sub =
      membership.killbill_subscription_id !== null
        ? await route.killbill.getSubscription(membership.killbill_subscription_id)
        : plan === undefined
          ? null
          : await route.killbill.findActiveSubscription(membership.killbill_account_id, plan);
    if (sub === null || sub.state !== 'ACTIVE') return;
    const invoices = await route.killbill.accountInvoices(membership.killbill_account_id);
    if (invoices.length === 0) return;
    const invoice = await route.killbill.getInvoice(invoices[0]!.invoiceId);
    if (invoice.balance > 0.001) return;
    await route.db.exec('UPDATE memberships SET status = \'active\', killbill_subscription_id = $2 WHERE user_id = $1 AND status = \'pending-payment\'', [
      userId,
      sub.subscriptionId,
    ]);
  } catch (err) {
    if (err instanceof KillBillDown) {
      route.status.billing = 'down';
      return;
    }
    throw err;
  }
}

export async function promoteNextHold(route: RouteContext, itemId: number): Promise<void> {
  const queued = await route.db.query<{ id: number; member_id: number; status: string; placed_at: Date }>(
    `SELECT id, member_id, status, placed_at FROM holds WHERE item_id = $1 AND status = 'queued' ORDER BY placed_at, id`,
    [itemId],
  );
  for (const hold of queued) {
    const active = await membershipIsActive(route.db, hold.member_id);
    if (!active) continue;
    const updated = await route.db.withClient(async (client) => {
      await client.query('BEGIN');
      const result = await client.query<{ id: number; member_id: number }>(
        `UPDATE holds SET status = 'ready', ready_at = now() WHERE id = $1 AND status = 'queued' RETURNING id, member_id`,
        [hold.id],
      );
      if (result.rows.length === 0) {
        await client.query('COMMIT');
        return null;
      }
      const notice = await client.query<{ hold_id: number }>(
        'INSERT INTO hold_notices (hold_id) VALUES ($1) ON CONFLICT (hold_id) DO NOTHING RETURNING hold_id',
        [hold.id],
      );
      await client.query('COMMIT');
      if (notice.rows.length === 0) return null; // another process already promoted and queued the email
      return result.rows[0]!;
    });
    if (updated !== null) {
      await sendHoldReadyEmail(route, updated.id, itemId, hold.member_id);
      // The promoted hold changes what the board shows; refresh the stored item status.
      const status = await recomputeItemStatus(route.db, itemId);
      await route.db.exec('UPDATE items SET status = $2 WHERE id = $1', [itemId, status]);
    }
    return;
  }
}

async function sendHoldReadyEmail(route: RouteContext, holdId: number, itemId: number, memberId: number): Promise<void> {
  void holdId;
  const item = await route.db.one<{ tag: string; name: string }>('SELECT tag, name FROM items WHERE id = $1', [itemId]);
  const member = await route.db.one<{ email: string }>('SELECT email FROM users WHERE id = $1', [memberId]);
  if (item === null || member === null) return;
  const calendar = await getCalendar(route.db);
  const hangDate = new Date();
  const nextDay = await import('../calendar').then((m) => m.nextOpenDayAfter(calendar, dateInZone(hangDate, calendar.zone)));
  const hoursOfNext = calendar.hours[weekdayOf(nextDay)];
  const body = [
    `Your hold is ready: ${item.name} (${item.tag}).`,
    ``,
    `The tool was hung back on ${dateInZone(hangDate, calendar.zone)}.`,
    `The next open day is ${nextDay}${hoursOfNext !== undefined ? `, ${hoursOfNext.opens} to ${hoursOfNext.closes}` : ''}.`,
    `Come to the desk to collect it.`,
  ].join('\n');
  await route.mailer.enqueue(member.email, `Your hold is ready: ${item.name} (${item.tag})`, body);
}

function weekdayOf(date: string): 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday' {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (parts === null) return 'monday';
  const utc = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  const index = (new Date(utc).getUTCDay() + 6) % 7;
  return WEEKDAYS[index]!;
}
