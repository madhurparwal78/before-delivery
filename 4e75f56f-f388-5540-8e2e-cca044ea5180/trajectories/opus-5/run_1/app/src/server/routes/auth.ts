import {
  createSession,
  deleteSession,
  findAccountByEmail,
  insertAccount,
  verifyPassword,
  type Account,
} from '../db/accounts.js';
import { pool } from '../db/pool.js';
import {
  loadReservationsForAccount,
  secondsRemaining,
  serializeReservation,
} from '../db/reservations.js';
import { activeWaitlistEntry, sweepIfDue, waitlistPosition } from '../domain/holds.js';
import { depositsOpen, serverNow, venueDate } from '../domain/venue.js';
import { clearedSessionCookie, sessionCookie } from '../http/app.js';
import type { Route } from '../http/context.js';
import { conflict, invalidCredentials } from '../http/errors.js';
import { FieldErrors, readEmail, readString } from './helpers.js';
import { groupIdsForBuyer, serializeGroup } from './serialize.js';

function accountBody(account: Account): Record<string, unknown> {
  return { id: account.id, name: account.name, email: account.email, role: account.role };
}

interface OfferRow {
  id: string;
  bench: string;
  tier: string;
  state: string;
  expires_at: Date;
}

export const authRoutes: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/api/auth/signup',
    access: 'anonymous',
    handler: async (ctx) => {
      const body = ctx.json();
      const errors = new FieldErrors();
      const name = readString(body, 'name', 1, 120, errors);
      const email = readEmail(body, 'email', errors);
      const password = readString(body, 'password', 10, 128, errors);
      const kind = body['kind'];
      if (kind !== 'practitioner' && kind !== 'clinic') {
        errors.add('kind', 'Choose Practitioner or Clinic.');
      }
      const clinicName =
        kind === 'clinic' ? readString(body, 'clinic_name', 1, 120, errors) : null;
      errors.throwIfAny();

      const role = kind === 'clinic' ? 'clinic' : 'practitioner';
      const account = await insertAccount(pool, {
        name,
        email,
        password,
        role,
        clinicName,
      });
      if (account === null) {
        throw conflict('email_taken', 'An account already uses that email address.');
      }
      const token = await createSession(account.id);
      return {
        status: 201,
        body: { account: accountBody(account) },
        cookies: [sessionCookie(token)],
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/signin',
    access: 'anonymous',
    handler: async (ctx) => {
      const body = ctx.json();
      const email = typeof body['email'] === 'string' ? body['email'] : '';
      const password = typeof body['password'] === 'string' ? body['password'] : '';
      const found = await findAccountByEmail(pool, email);
      if (found === null || !(await verifyPassword(password, found.passwordHash))) {
        throw invalidCredentials();
      }
      const token = await createSession(found.id);
      return {
        status: 200,
        body: { account: accountBody(found) },
        cookies: [sessionCookie(token)],
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/auth/signout',
    access: 'anonymous',
    handler: async (ctx) => {
      if (ctx.sessionToken !== null) await deleteSession(ctx.sessionToken);
      return { status: 204, body: null, cookies: [clearedSessionCookie()] };
    },
  },
  {
    method: 'GET',
    pattern: '/api/me',
    access: ['practitioner', 'clinic', 'director', 'registrar', 'frontdesk'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      await sweepIfDue();
      const at = serverNow();
      const reservations = await loadReservationsForAccount(pool, account.id);
      const groupRows = await groupIdsForBuyer(pool, account.id);
      const groups = [];
      for (const group of groupRows) {
        groups.push(await serializeGroup(pool, group, at));
      }
      const entry = await activeWaitlistEntry(pool, account.id);
      const waitlist = entry === null ? null : await waitlistPosition(pool, entry.id);
      const offerRows = await pool.query<OfferRow>(
        `select id, bench, tier, state, expires_at from offers
         where account_id = $1 order by created_at desc limit 5`,
        [account.id],
      );
      return {
        status: 200,
        body: {
          account: accountBody(account),
          reservations: reservations.map((row) => serializeReservation(row, at)),
          groups,
          waitlist,
          offers: offerRows.rows.map((offer) => ({
            id: offer.id,
            bench: offer.bench,
            tier: offer.tier,
            state: offer.state,
            seconds_remaining: secondsRemaining(offer.expires_at, at),
          })),
          venue_date: venueDate(),
          deposits_open: depositsOpen(),
          server_time: at.toISOString(),
        },
      };
    },
  },
];
