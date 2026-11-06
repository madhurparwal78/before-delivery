import type { Queryable } from '../db.js';
import { takeIslandLocks, takeLock } from '../db.js';
import { fail, notFound } from '../http/errors.js';
import { checkFields, FieldErrors, parseBodyId, readEmail } from '../http/validate.js';
import { FIELD_MESSAGES } from '../../shared/messages.js';
import {
  publicRoute,
  sessionRoute,
  verifiedRoute,
  type Reply,
  type Route
} from '../http/route.js';
import { isUnitKey, type UnitKey } from '../../shared/types.js';
import { findAccountById, normaliseEmail, villageIdOf } from '../domain/accounts.js';
import {
  checkDemotion,
  checkPromotion,
  checkRemoval,
  clanById,
  clanStandings,
  clanTrophies,
  dissolveClan,
  isWarden,
  loadPendingInvitation,
  mateCount,
  memberCount,
  membersOf,
  membershipOf,
  MAX_CLAN_MEMBERS,
  rankOf,
  removeMembership,
  succeedSkipper,
  type Membership
} from '../domain/clans.js';
import { enforceThrottle } from '../domain/throttle.js';
import { movePair, unitsOf } from '../domain/ledger.js';
import { housingCapacity, housingUsed, loadIsland } from '../domain/village.js';
import { applyLapsedRaids, attackerHasActiveRaid } from '../domain/raids.js';
import { nextLocalDayStart, localDayStart } from '../domain/localtime.js';
import { enqueueMail } from '../mail/queue.js';
import { invitationMail } from '../mail/templates.js';

const MAX_PER_REQUEST = 6;
const MAX_PER_DONATION = 3;
const DONOR_REQUEST_LIMIT = 3;
const DONOR_DAILY_LIMIT = 8;

async function clanBody(
  client: Queryable,
  clanId: number,
  myRole: string
): Promise<Record<string, unknown>> {
  const clan = await clanById(client, clanId);
  if (clan === null) notFound();
  return {
    id: clan.id,
    name: clan.name,
    motto: clan.motto,
    trophies: await clanTrophies(client, clanId),
    rank: await rankOf(client, clanId),
    myRole,
    members: await membersOf(client, clanId)
  };
}

async function requireMembership(client: Queryable, accountId: number): Promise<Membership> {
  const membership = await membershipOf(client, accountId);
  if (membership === null) fail('not_in_clan');
  return membership;
}

async function targetMember(
  client: Queryable,
  clanId: number,
  accountId: number
): Promise<Membership> {
  const membership = await membershipOf(client, accountId);
  if (membership === null || membership.clanId !== clanId) notFound();
  return membership;
}

async function memberReply(
  client: Queryable,
  clanId: number,
  accountId: number
): Promise<Reply> {
  const members = await membersOf(client, clanId);
  const member = members.find((entry) => entry.accountId === accountId);
  if (!member) notFound();
  return { status: 200, body: member };
}

type RequestRow = {
  id: number;
  clan_id: number;
  requester_account_id: number;
  unit: string;
  count: number;
  given: number;
  state: string;
  created_at: Date;
};

async function requestView(
  client: Queryable,
  row: RequestRow
): Promise<Record<string, unknown>> {
  const account = await findAccountById(client, Number(row.requester_account_id));
  return {
    id: Number(row.id),
    requester: {
      accountId: Number(row.requester_account_id),
      displayName: account?.displayName ?? ''
    },
    unit: row.unit,
    count: row.count,
    given: row.given,
    state: row.state,
    createdAt: row.created_at.toISOString()
  };
}

export const clanRoutes: Route[] = [
  verifiedRoute('POST', '/api/clans', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, ['name', 'motto'], ['name', 'motto'], errors);
    const rawName = ctx.body.name;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (rawName !== undefined && (typeof rawName !== 'string' || name.length < 3 || name.length > 24)) {
      errors.add('name', FIELD_MESSAGES.clanName);
    }
    const rawMotto = ctx.body.motto;
    const motto = typeof rawMotto === 'string' ? rawMotto : '';
    if (rawMotto !== undefined && (typeof rawMotto !== 'string' || motto.length > 80)) {
      errors.add('motto', FIELD_MESSAGES.motto);
    }
    errors.throwIfAny();
    if ((await membershipOf(client, ctx.account.id)) !== null) fail('already_in_clan');
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO clans (name, name_lower, motto, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name_lower) DO NOTHING
       RETURNING id`,
      [name, name.toLowerCase(), motto, ctx.now.toISOString()]
    );
    const row = rows[0];
    if (!row) fail('clan_name_taken');
    const clanId = Number(row.id);
    await client.query(
      `INSERT INTO clan_members (clan_id, account_id, role, joined_at)
       VALUES ($1, $2, 'skipper', $3)`,
      [clanId, ctx.account.id, ctx.now.toISOString()]
    );
    return { status: 201, body: { clan: await clanBody(client, clanId, 'skipper') } };
  }),

  sessionRoute('GET', '/api/clan', async (ctx, client) => {
    const membership = await membershipOf(client, ctx.account.id);
    if (membership === null) return { status: 200, body: { clan: null } };
    return {
      status: 200,
      body: { clan: await clanBody(client, membership.clanId, membership.role) }
    };
  }),

  verifiedRoute('POST', '/api/clan/invitations', async (ctx, client) => {
    const membership = await requireMembership(client, ctx.account.id);
    if (!isWarden(membership.role)) fail('forbidden');
    const errors = new FieldErrors();
    checkFields(ctx.body, ['email'], ['email'], errors);
    const email = readEmail(ctx.body, errors);
    errors.throwIfAny();
    const emailLower = normaliseEmail(email);
    await takeLock(client, 'clan', membership.clanId);
    const { rows: existing } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM clan_invitations
          WHERE clan_id = $1 AND email_lower = $2 AND state = 'pending'
         UNION ALL
         SELECT 1 FROM clan_members cm
           JOIN accounts a ON a.id = cm.account_id
          WHERE cm.clan_id = $1 AND a.email_lower = $2
       ) AS exists`,
      [membership.clanId, emailLower]
    );
    if (existing[0]?.exists !== true) {
      await client.query(
        `INSERT INTO clan_invitations (clan_id, email, email_lower, invited_by, created_at, state)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [membership.clanId, email, emailLower, ctx.account.id, ctx.now.toISOString()]
      );
    }
    const clan = await clanById(client, membership.clanId);
    const { rows: accounts } = await client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM accounts WHERE email_lower = $1) AS exists',
      [emailLower]
    );
    await enqueueMail(
      client,
      invitationMail(
        email,
        ctx.account.displayName,
        clan?.name ?? '',
        accounts[0]?.exists === true
      ),
      ctx.now
    );
    return { status: 202, body: { status: 'invited' } };
  }),

  verifiedRoute('POST', '/api/invitations/:id/accept', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    const invitationId = Number(ctx.params.id);
    const emailLower = normaliseEmail(ctx.account.email);
    const found = await loadPendingInvitation(client, invitationId, emailLower);
    if (found === null) notFound();
    await takeLock(client, 'clan', found.clanId);
    const stillOpen = await loadPendingInvitation(client, invitationId, emailLower);
    if (stillOpen === null) notFound();
    if ((await membershipOf(client, ctx.account.id)) !== null) fail('already_in_clan');
    if ((await memberCount(client, found.clanId)) >= MAX_CLAN_MEMBERS) fail('clan_full');
    await client.query(
      `INSERT INTO clan_members (clan_id, account_id, role, joined_at)
       VALUES ($1, $2, 'deckhand', $3)`,
      [found.clanId, ctx.account.id, ctx.now.toISOString()]
    );
    await client.query("UPDATE clan_invitations SET state = 'accepted' WHERE id = $1", [
      invitationId
    ]);
    return { status: 200, body: { clan: await clanBody(client, found.clanId, 'deckhand') } };
  }),

  sessionRoute('POST', '/api/invitations/:id/decline', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    const invitationId = Number(ctx.params.id);
    const emailLower = normaliseEmail(ctx.account.email);
    const found = await loadPendingInvitation(client, invitationId, emailLower);
    if (found === null) notFound();
    await client.query("UPDATE clan_invitations SET state = 'declined' WHERE id = $1", [
      invitationId
    ]);
    return { status: 204 };
  }),

  sessionRoute('POST', '/api/clan/members/:accountId/promote', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    const caller = await requireMembership(client, ctx.account.id);
    await takeLock(client, 'clan', caller.clanId);
    const fresh = await requireMembership(client, ctx.account.id);
    const target = await targetMember(client, fresh.clanId, Number(ctx.params.accountId));
    checkPromotion(fresh, target, await mateCount(client, fresh.clanId));
    if (target.role === 'mate') {
      await client.query(
        "UPDATE clan_members SET role = 'skipper', mate_since = NULL WHERE account_id = $1",
        [target.accountId]
      );
      await client.query(
        "UPDATE clan_members SET role = 'mate', mate_since = $2 WHERE account_id = $1",
        [fresh.accountId, ctx.now.toISOString()]
      );
    } else {
      await client.query(
        "UPDATE clan_members SET role = 'mate', mate_since = $2 WHERE account_id = $1",
        [target.accountId, ctx.now.toISOString()]
      );
    }
    return memberReply(client, fresh.clanId, target.accountId);
  }),

  sessionRoute('POST', '/api/clan/members/:accountId/demote', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    const caller = await requireMembership(client, ctx.account.id);
    await takeLock(client, 'clan', caller.clanId);
    const fresh = await requireMembership(client, ctx.account.id);
    const target = await targetMember(client, fresh.clanId, Number(ctx.params.accountId));
    checkDemotion(fresh, target);
    await client.query(
      "UPDATE clan_members SET role = 'deckhand', mate_since = NULL WHERE account_id = $1",
      [target.accountId]
    );
    return memberReply(client, fresh.clanId, target.accountId);
  }),

  sessionRoute('DELETE', '/api/clan/members/:accountId', async (ctx, client) => {
    const caller = await requireMembership(client, ctx.account.id);
    await takeLock(client, 'clan', caller.clanId);
    const fresh = await requireMembership(client, ctx.account.id);
    const target = await targetMember(client, fresh.clanId, Number(ctx.params.accountId));
    checkRemoval(fresh, target);
    await removeMembership(client, fresh.clanId, target.accountId);
    return { status: 204 };
  }),

  sessionRoute('POST', '/api/clan/leave', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    const caller = await requireMembership(client, ctx.account.id);
    await takeLock(client, 'clan', caller.clanId);
    const fresh = await requireMembership(client, ctx.account.id);
    await removeMembership(client, fresh.clanId, fresh.accountId);
    const remaining = await memberCount(client, fresh.clanId);
    if (remaining === 0) {
      await dissolveClan(client, fresh.clanId);
      return { status: 200, body: { clan: null, newSkipper: null, disbanded: true } };
    }
    const newSkipper = fresh.role === 'skipper' ? await succeedSkipper(client, fresh.clanId) : null;
    return { status: 200, body: { clan: null, newSkipper, disbanded: false } };
  }),

  sessionRoute('GET', '/api/clan/messages', async (ctx, client) => {
    const caller = await requireMembership(client, ctx.account.id);
    const errors = new FieldErrors();
    const afterRaw = ctx.query.get('after');
    const after = afterRaw === null ? null : parseBodyId(afterRaw);
    if (afterRaw !== null && after === null) errors.add('after', FIELD_MESSAGES.cursor);
    errors.throwIfAny();
    const { rows } = await client.query<{
      id: number;
      account_id: number;
      display_name: string;
      body: string | null;
      removed: boolean;
      created_at: Date;
    }>(
      `SELECT m.id, m.author_account_id AS account_id, a.display_name, m.body, m.removed, m.created_at
         FROM clan_messages m JOIN accounts a ON a.id = m.author_account_id
        WHERE m.clan_id = $1 AND ($2::bigint IS NULL OR m.id > $2)
        ORDER BY m.id
        LIMIT 50`,
      [caller.clanId, after]
    );
    return {
      status: 200,
      body: {
        messages: rows.map((row) => ({
          id: Number(row.id),
          author: { accountId: Number(row.account_id), displayName: row.display_name },
          body: row.removed ? null : row.body,
          removed: row.removed,
          createdAt: row.created_at.toISOString()
        }))
      }
    };
  }),

  verifiedRoute('POST', '/api/clan/messages', async (ctx, client) => {
    await enforceThrottle('chat', String(ctx.account.id), ctx.now);
    const caller = await requireMembership(client, ctx.account.id);
    const errors = new FieldErrors();
    checkFields(ctx.body, ['body'], ['body'], errors);
    const raw = ctx.body.body;
    const text = typeof raw === 'string' ? raw : '';
    if (raw !== undefined && (typeof raw !== 'string' || text.trim().length < 1 || text.trim().length > 500)) {
      errors.add('body', FIELD_MESSAGES.body);
    }
    errors.throwIfAny();
    const { rows } = await client.query<{ id: number; created_at: Date }>(
      `INSERT INTO clan_messages (clan_id, author_account_id, body, created_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [caller.clanId, ctx.account.id, text, ctx.now.toISOString()]
    );
    const row = rows[0];
    if (!row) notFound();
    return {
      status: 201,
      body: {
        id: Number(row.id),
        author: { accountId: ctx.account.id, displayName: ctx.account.displayName },
        body: text,
        removed: false,
        createdAt: row.created_at.toISOString()
      }
    };
  }),

  sessionRoute('DELETE', '/api/clan/messages/:id', async (ctx, client) => {
    const caller = await requireMembership(client, ctx.account.id);
    const { rows } = await client.query<{ id: number }>(
      'SELECT id FROM clan_messages WHERE id = $1 AND clan_id = $2',
      [Number(ctx.params.id), caller.clanId]
    );
    if (!rows[0]) notFound();
    if (!isWarden(caller.role)) fail('forbidden');
    await client.query(
      'UPDATE clan_messages SET removed = true, body = NULL WHERE id = $1',
      [Number(ctx.params.id)]
    );
    return { status: 204 };
  }),

  sessionRoute('GET', '/api/clan/requests', async (ctx, client) => {
    const caller = await requireMembership(client, ctx.account.id);
    const { rows: open } = await client.query<RequestRow>(
      `SELECT * FROM unit_requests WHERE clan_id = $1 AND state = 'open' ORDER BY id`,
      [caller.clanId]
    );
    const { rows: mine } = await client.query<RequestRow>(
      `SELECT * FROM unit_requests
        WHERE clan_id = $1 AND requester_account_id = $2
        ORDER BY id DESC LIMIT 1`,
      [caller.clanId, ctx.account.id]
    );
    const mineRow = mine[0];
    return {
      status: 200,
      body: {
        requests: await Promise.all(open.map((row) => requestView(client, row))),
        mine: mineRow ? await requestView(client, mineRow) : null
      }
    };
  }),

  verifiedRoute('POST', '/api/clan/requests', async (ctx, client) => {
    const caller = await requireMembership(client, ctx.account.id);
    const errors = new FieldErrors();
    checkFields(ctx.body, ['unit', 'count'], ['unit', 'count'], errors);
    const rawUnit = ctx.body.unit;
    const unit: UnitKey = typeof rawUnit === 'string' && isUnitKey(rawUnit) ? rawUnit : 'saltjack';
    if (!(typeof rawUnit === 'string' && isUnitKey(rawUnit)) && rawUnit !== undefined) {
      errors.add('unit', FIELD_MESSAGES.unit);
    }
    const rawCount = ctx.body.count;
    const count =
      typeof rawCount === 'number' &&
      Number.isInteger(rawCount) &&
      rawCount >= 1 &&
      rawCount <= MAX_PER_REQUEST
        ? rawCount
        : null;
    if (count === null && rawCount !== undefined) {
      errors.add('count', FIELD_MESSAGES.requestCount);
    }
    errors.throwIfAny();
    await takeLock(client, 'clan', caller.clanId);
    const { rows: existing } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM unit_requests
          WHERE clan_id = $1 AND requester_account_id = $2 AND state = 'open'
       ) AS exists`,
      [caller.clanId, ctx.account.id]
    );
    if (existing[0]?.exists === true) fail('request_open');
    const { rows } = await client.query<RequestRow>(
      `INSERT INTO unit_requests (clan_id, requester_account_id, unit, count, state, created_at)
       VALUES ($1, $2, $3, $4, 'open', $5)
       RETURNING *`,
      [caller.clanId, ctx.account.id, unit, count ?? 1, ctx.now.toISOString()]
    );
    const row = rows[0];
    if (!row) notFound();
    return { status: 201, body: await requestView(client, row) };
  }),

  sessionRoute('POST', '/api/clan/requests/:id/cancel', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    const caller = await requireMembership(client, ctx.account.id);
    await takeLock(client, 'request', Number(ctx.params.id));
    const { rows } = await client.query<RequestRow>(
      'SELECT * FROM unit_requests WHERE id = $1 AND clan_id = $2',
      [Number(ctx.params.id), caller.clanId]
    );
    const row = rows[0];
    if (!row) notFound();
    if (Number(row.requester_account_id) !== ctx.account.id) fail('forbidden');
    if (row.state !== 'open') fail('request_closed');
    await client.query("UPDATE unit_requests SET state = 'closed' WHERE id = $1", [row.id]);
    const { rows: updated } = await client.query<RequestRow>(
      'SELECT * FROM unit_requests WHERE id = $1',
      [row.id]
    );
    const updatedRow = updated[0];
    if (!updatedRow) notFound();
    return { status: 200, body: await requestView(client, updatedRow) };
  }),

  verifiedRoute('POST', '/api/clan/requests/:id/donations', async (ctx, client) => {
    const caller = await requireMembership(client, ctx.account.id);
    const errors = new FieldErrors();
    checkFields(ctx.body, ['count'], ['count'], errors);
    const rawCount = ctx.body.count;
    const count =
      typeof rawCount === 'number' &&
      Number.isInteger(rawCount) &&
      rawCount >= 1 &&
      rawCount <= MAX_PER_DONATION
        ? rawCount
        : null;
    if (count === null && rawCount !== undefined) {
      errors.add('count', FIELD_MESSAGES.donationCount);
    }
    errors.throwIfAny();
    const requestId = Number(ctx.params.id);
    const { rows: found } = await client.query<RequestRow>(
      'SELECT * FROM unit_requests WHERE id = $1 AND clan_id = $2',
      [requestId, caller.clanId]
    );
    const foundRow = found[0];
    if (!foundRow) notFound();
    if (Number(foundRow.requester_account_id) === ctx.account.id) fail('own_request');

    const donorVillageId = await villageIdOf(client, ctx.account.id);
    const recipientVillageId = await villageIdOf(
      client,
      Number(foundRow.requester_account_id)
    );
    if (donorVillageId === null || recipientVillageId === null) notFound();

    await takeLock(client, 'request', requestId);
    await takeIslandLocks(client, [donorVillageId, recipientVillageId]);
    await applyLapsedRaids(client, ctx.now);

    const { rows: fresh } = await client.query<RequestRow>(
      'SELECT * FROM unit_requests WHERE id = $1',
      [requestId]
    );
    const request = fresh[0];
    if (!request) notFound();
    const amount = count ?? 1;
    if (request.state !== 'open') fail('request_closed');
    if (amount > request.count - request.given) fail('exceeds_request');

    const { rows: toRequest } = await client.query<{ given: number }>(
      `SELECT COALESCE(SUM(count), 0)::int AS given FROM donations
        WHERE request_id = $1 AND donor_account_id = $2`,
      [requestId, ctx.account.id]
    );
    if (Number(toRequest[0]?.given ?? 0) + amount > DONOR_REQUEST_LIMIT) fail('donor_limit');

    const dayStart = localDayStart(ctx.account.timeZone, ctx.now);
    const dayEnd = nextLocalDayStart(ctx.account.timeZone, ctx.now);
    const { rows: today } = await client.query<{ given: number }>(
      `SELECT COALESCE(SUM(count), 0)::int AS given FROM donations
        WHERE donor_account_id = $1 AND created_at >= $2 AND created_at < $3`,
      [ctx.account.id, dayStart.toISOString(), dayEnd.toISOString()]
    );
    if (Number(today[0]?.given ?? 0) + amount > DONOR_DAILY_LIMIT) {
      fail('donation_cap_reached', { nextDonationAt: dayEnd.toISOString() });
    }

    const donorIsland = await loadIsland(client, donorVillageId, ctx.now);
    const recipientIsland = await loadIsland(client, recipientVillageId, ctx.now);
    if (donorIsland === null || recipientIsland === null) notFound();
    const unit = request.unit as UnitKey;
    if (unitsOf(donorIsland.balances)[unit] < amount) fail('units_unavailable');
    if (housingUsed(recipientIsland) + amount > housingCapacity(recipientIsland)) {
      fail('recipient_housing_full');
    }
    if (await attackerHasActiveRaid(client, donorVillageId)) fail('raid_in_progress');

    const pairId = await movePair(client, {
      kind: 'donation',
      asset: unit,
      amount,
      fromVillageId: donorVillageId,
      toVillageId: recipientVillageId,
      at: ctx.now
    });
    await client.query(
      `INSERT INTO donations
         (request_id, clan_id, donor_account_id, recipient_account_id, unit, count, pair_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        requestId,
        caller.clanId,
        ctx.account.id,
        Number(request.requester_account_id),
        unit,
        amount,
        pairId,
        ctx.now.toISOString()
      ]
    );
    const given = request.given + amount;
    await client.query('UPDATE unit_requests SET given = $2, state = $3 WHERE id = $1', [
      requestId,
      given,
      given >= request.count ? 'filled' : 'open'
    ]);
    const { rows: after } = await client.query<RequestRow>(
      'SELECT * FROM unit_requests WHERE id = $1',
      [requestId]
    );
    const afterRow = after[0];
    if (!afterRow) notFound();
    return {
      status: 201,
      body: {
        request: await requestView(client, afterRow),
        donation: { unit, count: amount, pairId }
      }
    };
  }),

  publicRoute('GET', '/api/league/clans', async (_ctx, client) => ({
    status: 200,
    body: { clans: await clanStandings(client, 50) }
  }))
];
