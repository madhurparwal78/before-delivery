import { Router } from 'express';
import type { MemberSummary, User } from '../../../shared/types.js';
import { formatHours, hhmmToMinutes } from '../../../shared/format.js';
import { pool, query } from '../../db/pool.js';
import { coveredUntil } from '../../domain/cover.js';
import {
  cardInForce,
  kitchenView,
  loadRateCards,
  loadStations,
  type KitchenRecord,
} from '../../domain/kitchens.js';
import { packBalanceQuarters } from '../../domain/pack.js';
import { monthQuarters } from '../../domain/quoting.js';
import { verifyPassword } from '../../domain/secrets.js';
import { kitchenToday, monthOf } from '../../domain/time.js';
import { statusView } from '../../services/health.js';
import { requireKitchen, requireMember, requireRole, requireUser } from '../access.js';
import { noContent, ok, param, route } from '../context.js';
import { failures } from '../errors.js';
import {
  clearSessionCookie,
  endSession,
  setSessionCookie,
  startSession,
} from '../session.js';

export const coreRoutes = Router();

coreRoutes.get(
  '/health',
  route(async () => ok({ status: 'ok' })),
);

coreRoutes.get(
  '/status',
  route(async () => ok(statusView())),
);

coreRoutes.post(
  '/session',
  route(async (ctx) => {
    const email = ctx.body.email;
    const password = ctx.body.password;
    const errors: Record<string, string> = {};
    if (typeof email !== 'string' || email.trim() === '') errors.email = 'Enter your email.';
    if (typeof password !== 'string' || password === '') errors.password = 'Enter your password.';
    if (Object.keys(errors).length > 0) throw failures.validation(errors);

    const found = await query<{
      id: string;
      name: string;
      email: string;
      role: User['role'];
      kitchen_id: string;
      member_id: string | null;
      password_hash: string;
    }>(
      pool,
      `SELECT id, name, email, role, kitchen_id, member_id, password_hash
         FROM users WHERE lower(email) = lower($1)`,
      [String(email).trim()],
    );
    const user = found[0];
    if (!user || !(await verifyPassword(String(password), user.password_hash))) {
      throw failures.invalidCredentials();
    }
    const sessionId = await startSession(user.id, ctx.now);
    setSessionCookie(ctx.res, sessionId);
    return ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        kitchen_id: user.kitchen_id,
        member_id: user.member_id,
      },
    });
  }),
);

coreRoutes.delete(
  '/session',
  route(async (ctx) => {
    requireUser(ctx.user);
    await endSession(ctx.req);
    clearSessionCookie(ctx.res);
    return noContent();
  }),
);

coreRoutes.get(
  '/me',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    return ok({ user: toUserBody(user) });
  }),
);

function toUserBody(user: {
  id: string;
  name: string;
  email: string;
  role: User['role'];
  kitchen_id: string;
  member_id: string | null;
}): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    kitchen_id: user.kitchen_id,
    member_id: user.member_id,
  };
}

async function kitchenBody(kitchen: KitchenRecord, now: Date): Promise<unknown> {
  const stations = await loadStations(pool, kitchen.id);
  const today = kitchenToday(kitchen.timezone, now);
  const inForce = cardInForce(await loadRateCards(pool, kitchen.id), today);
  return {
    kitchen: kitchenView(
      kitchen,
      stations,
      now,
      inForce ? inForce.cancellation_window_hours : 0,
    ),
  };
}

coreRoutes.get(
  '/kitchens/:kitchen_id',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const kitchen = await requireKitchen(pool, user, param(ctx.req, 'kitchen_id'));
    return ok(await kitchenBody(kitchen, ctx.now));
  }),
);

coreRoutes.patch(
  '/kitchens/:kitchen_id/settings',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const kitchen = await requireKitchen(pool, user, param(ctx.req, 'kitchen_id'));
    requireRole(user, 'operator');
    const raw = ctx.body.same_day_cutoff;
    const minutes = typeof raw === 'string' ? hhmmToMinutes(raw) : null;
    if (minutes === null || minutes % 15 !== 0 || minutes > 1425) {
      throw failures.validation({ same_day_cutoff: 'Enter a time on a quarter hour.' });
    }
    await pool.query('UPDATE kitchens SET same_day_cutoff_minutes = $2 WHERE id = $1', [
      kitchen.id,
      minutes,
    ]);
    return ok(await kitchenBody({ ...kitchen, same_day_cutoff_minutes: minutes }, ctx.now));
  }),
);

async function memberSummary(
  member: { id: string; business: string; contact_email: string },
  today: string,
): Promise<MemberSummary> {
  return {
    id: member.id,
    business: member.business,
    contact_email: member.contact_email,
    covered_until: await coveredUntil(pool, member.id, today),
    month_hours: formatHours(await monthQuarters(pool, member.id, monthOf(today))),
    pack_balance_quarters: await packBalanceQuarters(pool, member.id),
  };
}

coreRoutes.get(
  '/kitchens/:kitchen_id/members',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const kitchen = await requireKitchen(pool, user, param(ctx.req, 'kitchen_id'));
    requireRole(user, 'operator');
    const today = kitchenToday(kitchen.timezone, ctx.now);
    const rows = await query<{ id: string; business: string; contact_email: string }>(
      pool,
      'SELECT id, business, contact_email FROM members WHERE kitchen_id = $1 ORDER BY business',
      [kitchen.id],
    );
    const members: MemberSummary[] = [];
    for (const row of rows) members.push(await memberSummary(row, today));
    return ok({ members });
  }),
);

coreRoutes.get(
  '/members/:member_id',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const member = await requireMember(pool, user, param(ctx.req, 'member_id'));
    requireRole(user, 'operator', 'member');
    const kitchen = await requireKitchen(pool, user, member.kitchen_id);
    const today = kitchenToday(kitchen.timezone, ctx.now);
    return ok({ member: await memberSummary(member, today) });
  }),
);
