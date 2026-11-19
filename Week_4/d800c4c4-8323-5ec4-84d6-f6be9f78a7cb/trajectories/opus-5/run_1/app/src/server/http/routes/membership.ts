import * as copy from '../../../shared/copy';
import type { Membership, Tier } from '../../../shared/types';
import { TIER_ORDER } from '../../../shared/types';
import { env } from '../../env';
import { hashPassword, verifyPassword } from '../../domain/password';
import { cancelMembershipConflict } from '../../domain/transitions';
import { today } from '../../../shared/time';
import { pool, withTransaction } from '../../repo/db';
import { readSettings } from '../../repo/calendar';
import {
  endSession,
  findUserByEmail,
  insertMembership,
  insertUser,
  listMemberSummaries,
  markMembershipActive,
  markMembershipEnding,
  membershipView,
  readMembershipRow,
  recordBillingIds,
  startSession,
} from '../../repo/users';
import {
  BillingUnreachable,
  cancelAtEndOfTerm,
  ensureAccount,
  ensureFirstYearPayment,
  ensureSubscription,
  readMembershipBillingState,
} from '../../services/killbill';
import { billingProbe } from '../../services/status';
import * as fail from '../errors';
import { FieldProblems } from '../errors';
import { jsonReply, SESSION_COOKIE, type Reply, type Route } from '../pipeline';
import { isEmail, readString } from '../validate';

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function sessionCookie(value: string) {
  return { name: SESSION_COOKIE, value, maxAge: SESSION_MAX_AGE };
}

function billingDown(message: string): never {
  billingProbe.markDown();
  throw fail.providerDown(message);
}

/** Records the membership as active once Kill Bill reports both of its conditions. */
export async function refreshMembershipFromBilling(userId: number): Promise<void> {
  const row = await readMembershipRow(pool, userId);
  if (!row || row.status !== 'pending-payment') return;
  if (!row.killbill_account_id || !row.killbill_subscription_id) return;
  try {
    await ensureFirstYearPayment(row.killbill_account_id, row.killbill_subscription_id);
    const state = await readMembershipBillingState(
      row.killbill_account_id,
      row.killbill_subscription_id,
    );
    billingProbe.markUp();
    if (state.subscriptionActive && state.firstInvoicePaid) {
      await markMembershipActive(pool, userId);
    }
  } catch {
    billingProbe.markDown();
  }
}

async function membershipFor(userId: number): Promise<Membership | null> {
  const settings = await readSettings(pool);
  const row = await readMembershipRow(pool, userId);
  return row ? membershipView(row, today(settings.time_zone, new Date())) : null;
}

export const healthRoute: Route = {
  method: 'GET',
  pattern: '/api/health',
  body: 'json',
  auth: 'anyone',
  run: async (): Promise<Reply> => {
    try {
      await pool.query('select 1');
    } catch {
      return jsonReply(503, { status: 'starting' });
    }
    return jsonReply(200, { status: 'ok' });
  },
};

export const signInRoute: Route = {
  method: 'POST',
  pattern: '/api/session',
  body: 'json',
  auth: 'anyone',
  run: async (ctx): Promise<Reply> => {
    const body = ctx.json();
    const email = readString(body, 'email') ?? '';
    const password = readString(body, 'password') ?? '';
    const user = await findUserByEmail(pool, email.trim());
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw fail.signInRefused();
    }
    const token = await startSession(pool, user.id);
    return jsonReply(
      200,
      { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
      sessionCookie(token),
    );
  },
};

export const signOutRoute: Route = {
  method: 'DELETE',
  pattern: '/api/session',
  body: 'json',
  auth: 'anyone',
  run: async (ctx): Promise<Reply> => {
    if (ctx.session) await endSession(pool, ctx.session.id);
    return { kind: 'empty', status: 204, cookie: { name: SESSION_COOKIE, value: '', maxAge: 0 } };
  },
};

export const meRoute: Route = {
  method: 'GET',
  pattern: '/api/me',
  body: 'json',
  auth: 'signed-in',
  run: async (ctx): Promise<Reply> => {
    const user = ctx.requireUser();
    if (user.role === 'member') await refreshMembershipFromBilling(user.id);
    return jsonReply(200, { user, membership: await membershipFor(user.id) });
  },
};

export const joinRoute: Route = {
  method: 'POST',
  pattern: '/api/members',
  body: 'json',
  auth: 'anyone',
  role: (ctx) => {
    if (ctx.user) throw fail.signOutBeforeJoining();
  },
  run: async (ctx): Promise<Reply> => {
    const body = ctx.json();
    const name = (readString(body, 'name') ?? '').trim();
    const email = (readString(body, 'email') ?? '').trim().toLowerCase();
    const password = readString(body, 'password') ?? '';
    const tier = readString(body, 'tier') ?? '';
    const problems = new FieldProblems();
    if (name.length < 1 || name.length > 80) {
      problems.add('name', 'Give a name of 1 to 80 characters.');
    }
    if (!isEmail(email)) problems.add('email', 'Give an email address like you@example.com.');
    if (password.length < 10) problems.add('password', 'Use at least 10 characters.');
    if (!TIER_ORDER.includes(tier as Tier)) problems.add('tier', 'Choose a membership tier.');
    problems.throwIfAny();

    return withTransaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`join:${email}`]);
      if (await findUserByEmail(client, email)) {
        throw fail.conflict(copy.EMAIL_TAKEN);
      }
      let accountId: string;
      let subscriptionId: string;
      try {
        accountId = await ensureAccount(email, name);
        subscriptionId = await ensureSubscription(accountId, tier as Tier);
        await ensureFirstYearPayment(accountId, subscriptionId);
        billingProbe.markUp();
      } catch (error) {
        if (error instanceof BillingUnreachable) billingDown(copy.BILLING_DOWN_GENERAL);
        throw error;
      }
      const user = await insertUser(client, name, email, await hashPassword(password), 'member');
      if (!user) throw fail.conflict(copy.EMAIL_TAKEN);
      await insertMembership(client, user.id, tier as Tier);
      await recordBillingIds(client, user.id, accountId, subscriptionId);
      const token = await startSession(client, user.id);
      const membership: Membership = {
        status: 'pending-payment',
        tier: tier as Tier,
        active_until: null,
        ends_at_term: false,
      };
      return jsonReply(202, { user, membership }, sessionCookie(token));
    });
  },
};

export const memberListRoute: Route = {
  method: 'GET',
  pattern: '/api/members',
  body: 'json',
  auth: 'signed-in',
  role: (ctx) => {
    if (ctx.role === 'member') throw fail.staffOnly();
  },
  run: async (): Promise<Reply> => {
    const settings = await readSettings(pool);
    return jsonReply(200, {
      members: await listMemberSummaries(pool, today(settings.time_zone, new Date())),
    });
  },
};

export const cancelMembershipRoute: Route = {
  method: 'POST',
  pattern: '/api/membership/cancel',
  body: 'json',
  auth: 'signed-in',
  role: (ctx) => {
    if (ctx.role !== 'member') throw fail.membersOnly();
  },
  run: async (ctx): Promise<Reply> => {
    const user = ctx.requireUser();
    const settings = await readSettings(pool);
    const libraryToday = today(settings.time_zone, ctx.now);
    return withTransaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`membership:${user.id}`]);
      const row = await readMembershipRow(client, user.id);
      if (!row) throw fail.notFound();
      const view = membershipView(row, libraryToday);
      const conflict = cancelMembershipConflict(view.status, row.ends_at_term);
      if (conflict) throw fail.conflict(conflict);
      if (!row.killbill_subscription_id) throw fail.providerDown(copy.BILLING_DOWN_GENERAL);
      let activeUntil: string | null;
      try {
        activeUntil = await cancelAtEndOfTerm(row.killbill_subscription_id);
        billingProbe.markUp();
      } catch (error) {
        if (error instanceof BillingUnreachable) billingDown(copy.BILLING_DOWN_GENERAL);
        throw error;
      }
      await markMembershipEnding(client, user.id, activeUntil);
      const updated = await readMembershipRow(client, user.id);
      if (!updated) throw fail.notFound();
      return jsonReply(200, { membership: membershipView(updated, libraryToday) });
    });
  },
};

export const SESSION_IDLE_SECONDS = env.sessionIdleSeconds;
