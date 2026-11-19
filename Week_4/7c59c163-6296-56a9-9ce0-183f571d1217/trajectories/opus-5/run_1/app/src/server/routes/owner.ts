import { randomBytes, randomUUID } from 'node:crypto';
import { inTransaction, pool } from '../db/pool.js';
import { config } from '../config.js';
import { ApiError, ValidationError } from '../http/errors.js';
import { json, memberRoute } from '../http/router.js';
import { RANGES, asObject, isEmail, isMonth, onlyFields, readInteger, readString } from '../domain/validate.js';
import { currentMonth, monthRange, startOfToday } from '../domain/time.js';
import { openInterest } from '../domain/views.js';
import { enqueue } from '../domain/queue.js';
import { effectivePlan } from '../domain/plans.js';
import { ProviderUnreachable } from '../providers/http.js';
import { ensureUser } from '../providers/keycloak.js';
import type { BillingState, MarketRow, Plan, Role, Venue } from '../domain/types.js';
import type { Route } from '../http/router.js';

const INVITE_ROLES: readonly Role[] = ['trader', 'builder', 'market_admin'];

export const identityUnavailable = (): ApiError => new ApiError(503, 'identity_unavailable');

export interface InviteResult {
  member_id: string;
  email: string;
  roles: Role[];
}

/**
 * Creates the person in Keycloak in the venue with the chosen roles and the UPDATE_PASSWORD required
 * action, and emails them a one-time link.
 */
export async function inviteMember(
  venue: Venue,
  email: string,
  displayName: string,
  roles: readonly Role[],
): Promise<InviteResult> {
  const existing = await pool.query('select 1 from members where venue_id = $1 and lower(email) = lower($2)', [
    venue.id,
    email,
  ]);
  if (existing.rowCount !== 0) throw new ApiError(409, 'already_member');

  const username = `${venue.slug}-${email.split('@')[0]}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  let keycloakUserId: string;
  try {
    const user = await ensureUser({
      username,
      email,
      displayName,
      roles,
      venueSlug: venue.slug,
      requireUpdatePassword: true,
    });
    keycloakUserId = user.id;
  } catch (error) {
    if (error instanceof ProviderUnreachable) throw identityUnavailable();
    throw error;
  }

  const memberId = randomUUID();
  const token = randomBytes(24).toString('base64url');
  await inTransaction(async (client) => {
    await client.query(
      `insert into members (id, venue_id, keycloak_user_id, username, display_name, email, roles)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (keycloak_user_id) do update set venue_id = $2, roles = $7`,
      [memberId, venue.id, keycloakUserId, username, displayName, email, roles],
    );
    const member = await client.query<{ id: string }>(
      'select id from members where keycloak_user_id = $1',
      [keycloakUserId],
    );
    const id = member.rows[0]?.id as string;
    await client.query('insert into member_balances (member_id) values ($1) on conflict do nothing', [id]);
    await client.query(
      `insert into invites (token, venue_id, member_id, email, expires_at)
       values ($1,$2,$3,$4, now() + ($5 || ' seconds')::interval)`,
      [token, venue.id, id, email, config.app.inviteTtlSeconds],
    );
    await enqueue(client, 'email', `invite:${token}`, {
      to: email,
      subject: `You're invited to ${venue.name}`,
      body: `You have been invited to ${venue.name} on Plumtide Venue. Accept your invite at ${config.app.publicUrl}/invites/${token}`,
    });
  });

  const stored = await pool.query<{ id: string }>(
    'select id from members where keycloak_user_id = $1',
    [keycloakUserId],
  );
  return { member_id: stored.rows[0]?.id as string, email, roles: [...roles] };
}

const csvField = (value: string | number | null): string => {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const ownerRoutes: Route[] = [
  memberRoute('GET', '/api/venue/totals', { venue: true, roles: ['org_owner'] }, async ({ actor }) => {
    const venue = actor.venue as Venue;
    const counts = await pool.query<{
      members: number;
      open_orders: number;
      deposits_cents: string | null;
      refunds_cents: string | null;
      fees_cents: string | null;
    }>(
      `select (select count(*) from members where venue_id = $1)::int as members,
              (select count(*) from orders where venue_id = $1 and status in ('resting','partially_filled'))::int as open_orders,
              (select sum(amount_cents) from deposits where venue_id = $1 and status = 'succeeded') as deposits_cents,
              (select sum(amount_cents) from refunds where venue_id = $1) as refunds_cents,
              (select sum(fee_cents) from fills where venue_id = $1) as fees_cents`,
      [venue.id],
    );
    const volume = await pool.query<{ total: string | null }>(
      'select sum(price * quantity) as total from trades where venue_id = $1 and at >= $2',
      [venue.id, startOfToday(venue.time_zone)],
    );
    const markets = await pool.query<MarketRow>(
      `select id, venue_id, kind, symbol, title, status, closes_at, outcome, last_price, book_sequence,
              resolved_at, settled_at from markets where venue_id = $1`,
      [venue.id],
    );
    let contracts = 0;
    for (const market of markets.rows) contracts += await openInterest(pool, market);
    const row = counts.rows[0];
    return json(200, {
      members: row?.members ?? 0,
      open_orders: row?.open_orders ?? 0,
      deposits_cents: Number(row?.deposits_cents ?? 0),
      refunds_cents: Number(row?.refunds_cents ?? 0),
      fees_cents: Number(row?.fees_cents ?? 0),
      volume_cents_today: Number(volume.rows[0]?.total ?? 0),
      open_interest_contracts: contracts,
    });
  }),

  memberRoute(
    'GET',
    '/api/venue/members',
    { venue: true, roles: ['org_owner', 'market_admin'] },
    async ({ actor, url }) => {
      const venue = actor.venue as Venue;
      const query = url.searchParams.get('q') ?? '';
      if (query.length < RANGES.memberQuery.min || query.length > RANGES.memberQuery.max) {
        throw new ValidationError({ q: 'invalid' });
      }
      const result = await pool.query<{
        id: string;
        display_name: string;
        email: string;
        roles: Role[];
      }>(
        `select id, display_name, email, roles from members
          where venue_id = $1 and (display_name ilike '%' || $2 || '%' or email ilike '%' || $2 || '%')
          order by display_name limit 10`,
        [venue.id, query],
      );
      return json(200, { members: result.rows });
    },
  ),

  memberRoute('POST', '/api/venue/invites', { venue: true, roles: ['org_owner'] }, async ({ actor, body }) => {
    const venue = actor.venue as Venue;
    const fields = asObject(body);
    onlyFields(fields, ['email', 'display_name', 'roles']);
    const email = readString(fields, 'email');
    const displayName = readString(fields, 'display_name');
    const roles = fields.roles;
    const errors: Record<string, string> = {};
    if (!isEmail(email)) errors.email = 'invalid';
    if (displayName.trim().length < RANGES.displayName.min || displayName.length > RANGES.displayName.max) {
      errors.display_name = 'invalid';
    }
    if (
      !Array.isArray(roles) ||
      roles.length === 0 ||
      !roles.every((role) => typeof role === 'string' && INVITE_ROLES.includes(role as Role))
    ) {
      errors.roles = 'invalid';
    }
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);

    return json(201, await inviteMember(venue, email, displayName.trim(), roles as Role[]));
  }),

  memberRoute('PUT', '/api/venue/fees', { venue: true, roles: ['org_owner'] }, async ({ actor, body }) => {
    const venue = actor.venue as Venue;
    const fields = asObject(body);
    onlyFields(fields, ['taker_fee_bps', 'maker_fee_bps']);
    const taker = readInteger(fields, 'taker_fee_bps');
    const maker = readInteger(fields, 'maker_fee_bps');
    const errors: Record<string, string> = {};
    if (taker < RANGES.feeBps.min || taker > RANGES.feeBps.max) errors.taker_fee_bps = 'out_of_range';
    if (maker < RANGES.feeBps.min || maker > RANGES.feeBps.max) errors.maker_fee_bps = 'out_of_range';
    if (Object.keys(errors).length === 0 && maker > taker) errors.maker_fee_bps = 'exceeds_taker';
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);

    await pool.query('update venues set taker_fee_bps = $2, maker_fee_bps = $3 where id = $1', [
      venue.id,
      taker,
      maker,
    ]);
    return json(200, { taker_fee_bps: taker, maker_fee_bps: maker });
  }),

  memberRoute(
    'GET',
    '/api/venue/fills.csv',
    { venue: true, roles: ['org_owner'] },
    async ({ actor, url }) => {
      const venue = actor.venue as Venue;
      const month = url.searchParams.get('month') ?? currentMonth(venue.time_zone);
      if (!isMonth(month)) throw new ValidationError({ month: 'invalid' });
      const { start, end } = monthRange(venue.time_zone, month);
      const result = await pool.query<{
        id: string;
        filled_at: Date;
        symbol: string;
        email: string;
        mode: string | null;
        side: string;
        outcome: string | null;
        price: number;
        quantity: number;
        fee_cents: number;
        liquidity: string;
      }>(
        `select f.id, f.filled_at, m.symbol, me.email, f.mode, f.side, f.outcome, f.price, f.quantity,
                f.fee_cents, f.liquidity
           from fills f
           join markets m on m.id = f.market_id
           join members me on me.id = f.member_id
          where f.venue_id = $1 and f.filled_at >= $2 and f.filled_at < $3
          order by f.sequence`,
        [venue.id, start, end],
      );
      const header =
        'fill_id,filled_at,market_symbol,member_email,mode,side,outcome,price,quantity,fee_cents,liquidity';
      const rows = result.rows.map((row) =>
        [
          row.id,
          row.filled_at.toISOString(),
          row.symbol,
          row.email,
          row.mode,
          row.side,
          row.outcome,
          row.price,
          row.quantity,
          row.fee_cents,
          row.liquidity,
        ]
          .map(csvField)
          .join(','),
      );
      return {
        status: 200,
        raw: { contentType: 'text/csv; charset=utf-8', payload: [header, ...rows].join('\n') + '\n' },
        headers: {
          'content-disposition': `attachment; filename="fills-${venue.slug}-${month}.csv"`,
        },
      };
    },
  ),

  memberRoute('GET', '/api/venue/billing', { venue: true, roles: ['org_owner'] }, async ({ actor }) => {
    const venue = actor.venue as Venue;
    const result = await pool.query<{
      member_id: string;
      display_name: string;
      plan: Plan | null;
      state: BillingState | null;
    }>(
      `select m.id as member_id, m.display_name, b.plan, b.state
         from members m left join builder_billing b on b.member_id = m.id
        where m.venue_id = $1 and 'builder' = any(m.roles)
        order by m.display_name`,
      [venue.id],
    );
    return json(200, {
      builders: result.rows.map((row) => {
        const plan = row.plan ?? 'sandbox';
        const state = row.state ?? 'active';
        return {
          member_id: row.member_id,
          display_name: row.display_name,
          plan,
          effective_plan: effectivePlan(plan, state),
          state,
        };
      }),
    });
  }),
];
