// Clans: founding, invitations, warden powers, skipper succession, chat, standings, and unit
// donation requests. Role and membership are read fresh on every request.
import { isUnitKey, UNITS, type ClanRole, type RequestState, type UnitKey } from '../shared/catalog';
import { iso, now } from './clock';
import { tx, type Db } from './db';
import { fail } from './errors';
import { parseId, publicRoute, sessionRoute, type Account, type Ctx, type SignedInCtx } from './http';
import { army, housing, lockIslands, move } from './island';
import { MAIL, queueMail } from './mail';
import { CHAT_LIMIT } from './throttle';
import { Fields, intIn, isEmail, isString, MESSAGES, rejectField } from './validate';
import { villageIdOf } from './village';
import { localDay } from './zones';

const CLAN_MAX = 10;
const MATE_MAX = 4;
const DONOR_PER_REQUEST = 3;
const DONOR_DAILY_CAP = 8;

interface Membership {
  account_id: number;
  clan_id: number;
  role: ClanRole;
  joined_at: number;
  mate_since: number | null;
}

const isWarden = (role: ClanRole): boolean => role === 'skipper' || role === 'mate';

async function membershipOf(db: Db, accountId: number, lock = false): Promise<Membership | null> {
  const { rows } = await db.query<Membership>(`SELECT * FROM clan_members WHERE account_id = $1${lock ? ' FOR UPDATE' : ''}`, [accountId]);
  return rows[0] ?? null;
}

/** The caller's membership, fresh; every clan action after leaving or removal answers not_in_clan. */
async function requireMembership(db: Db, accountId: number): Promise<Membership> {
  return (await membershipOf(db, accountId)) ?? fail('not_in_clan');
}

/** Takes the clan lock, then rereads the caller's membership against the state earlier changes left. */
async function lockClanOf(db: Db, accountId: number): Promise<Membership> {
  const first = await requireMembership(db, accountId);
  await db.query('SELECT id FROM clans WHERE id = $1 FOR UPDATE', [first.clan_id]);
  const fresh = await requireMembership(db, accountId);
  if (fresh.clan_id !== first.clan_id) fail('not_in_clan');
  return fresh;
}

export async function clanGate(ctx: Ctx): Promise<void> {
  const account = ctx.session?.account as Account;
  await tx(async (db) => void (await requireMembership(db, account.id)));
}

function requireVerified(account: Account): void {
  if (!account.verified) fail('email_not_verified');
}

/** Live clans ranked by the summed trophies of current members, then name. */
async function standings(db: Db): Promise<{ id: number; name: string; trophies: number; memberCount: number; rank: number }[]> {
  const { rows } = await db.query<{ id: number; name: string; trophies: number; member_count: number; rank: number }>(
    `SELECT c.id, c.name, COALESCE(SUM(a.trophies), 0)::bigint AS trophies, count(m.account_id)::bigint AS member_count,
            row_number() OVER (ORDER BY COALESCE(SUM(a.trophies), 0) DESC, c.name ASC) AS rank
       FROM clans c
       LEFT JOIN clan_members m ON m.clan_id = c.id
       LEFT JOIN accounts a ON a.id = m.account_id
      WHERE c.dissolved_at IS NULL
      GROUP BY c.id ORDER BY rank`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, trophies: r.trophies, memberCount: r.member_count, rank: r.rank }));
}

async function memberViews(db: Db, clanId: number): Promise<Record<string, unknown>[]> {
  const { rows } = await db.query<Membership & { display_name: string; trophies: number; village_id: number; donated: number; received: number }>(
    `SELECT m.*, a.display_name, a.trophies, v.id AS village_id,
            (SELECT COALESCE(SUM(d.count), 0) FROM donations d WHERE d.donor_account_id = m.account_id AND d.clan_id = m.clan_id AND d.created_at >= m.joined_at)::bigint AS donated,
            (SELECT COALESCE(SUM(d.count), 0) FROM donations d WHERE d.recipient_account_id = m.account_id AND d.clan_id = m.clan_id AND d.created_at >= m.joined_at)::bigint AS received
       FROM clan_members m JOIN accounts a ON a.id = m.account_id JOIN villages v ON v.account_id = m.account_id
      WHERE m.clan_id = $1 ORDER BY m.joined_at, m.account_id`,
    [clanId],
  );
  return rows.map(memberView);
}

function memberView(m: Membership & { display_name: string; trophies: number; village_id: number; donated: number; received: number }): Record<string, unknown> {
  return {
    accountId: m.account_id, displayName: m.display_name, villageId: m.village_id, role: m.role, trophies: m.trophies,
    donated: m.donated, received: m.received, joinedAt: iso(m.joined_at), mateSince: m.mate_since === null ? null : iso(m.mate_since),
  };
}

async function memberViewOf(db: Db, accountId: number): Promise<Record<string, unknown>> {
  const m = (await requireMembership(db, accountId)) as Membership;
  return ((await memberViews(db, m.clan_id)).find((v) => v.accountId === accountId)) as Record<string, unknown>;
}

export async function clanView(db: Db, accountId: number): Promise<Record<string, unknown> | null> {
  const m = await membershipOf(db, accountId);
  if (!m) return null;
  const { rows } = await db.query<{ name: string; motto: string }>('SELECT name, motto FROM clans WHERE id = $1', [m.clan_id]);
  const clan = rows[0] as { name: string; motto: string };
  const standing = (await standings(db)).find((s) => s.id === m.clan_id) as { trophies: number; rank: number };
  return {
    id: m.clan_id, name: clan.name, motto: clan.motto, trophies: standing.trophies, rank: standing.rank, myRole: m.role,
    members: await memberViews(db, m.clan_id),
  };
}

/** Cancels every pending invitation a member sent once they stop being a warden of the clan. */
async function cancelInvitationsBy(db: Db, clanId: number, inviter: number): Promise<void> {
  await db.query("UPDATE invitations SET state = 'cancelled' WHERE clan_id = $1 AND inviter_account_id = $2 AND state = 'pending'", [clanId, inviter]);
}

async function closeOpenRequest(db: Db, clanId: number, accountId: number): Promise<void> {
  await db.query("UPDATE donation_requests SET state = 'closed' WHERE clan_id = $1 AND requester_account_id = $2 AND state = 'open'", [clanId, accountId]);
}

/** Who leads when the skipper leaves: the earliest mate, else the earliest member; ties to the lower id. */
function successor(members: readonly Membership[]): Membership | null {
  const byMate = members.filter((m) => m.role === 'mate').sort((a, b) => (a.mate_since as number) - (b.mate_since as number) || a.account_id - b.account_id);
  if (byMate[0]) return byMate[0];
  return [...members].sort((a, b) => a.joined_at - b.joined_at || a.account_id - b.account_id)[0] ?? null;
}

type RoleAction = 'promote' | 'demote' | 'remove';

/** The warden rules table: `forbidden` first from both roles, then `invalid_role_change`. */
function judgeRoleChange(action: RoleAction, caller: ClanRole, target: ClanRole, mates: number): 'ok' | 'forbidden' | 'invalid_role_change' {
  if (action === 'remove') {
    if (target === 'deckhand') return isWarden(caller) ? 'ok' : 'forbidden';
    if (target === 'mate') return caller === 'skipper' ? 'ok' : 'forbidden';
    return caller === 'skipper' ? 'invalid_role_change' : 'forbidden';
  }
  if (caller !== 'skipper') return 'forbidden';
  if (action === 'promote') {
    if (target === 'skipper') return 'invalid_role_change';
    if (target === 'deckhand' && mates >= MATE_MAX) return 'invalid_role_change';
    return 'ok';
  }
  return target === 'mate' ? 'ok' : 'invalid_role_change';
}

async function clanMembers(db: Db, clanId: number): Promise<Membership[]> {
  return (await db.query<Membership>('SELECT * FROM clan_members WHERE clan_id = $1', [clanId])).rows;
}

async function changeRole(ctx: SignedInCtx, action: RoleAction): Promise<Record<string, unknown> | null> {
  return tx(async (db) => {
    const caller = await lockClanOf(db, ctx.account.id);
    const members = await clanMembers(db, caller.clan_id);
    const target = members.find((m) => m.account_id === ctx.params.accountId) ?? fail('not_found');
    new Fields(ctx.body, []).done();
    const verdict = judgeRoleChange(action, caller.role, target.role, members.filter((m) => m.role === 'mate').length);
    if (verdict !== 'ok') fail(verdict);
    const at = now();
    if (action === 'remove') {
      await db.query('DELETE FROM clan_members WHERE account_id = $1', [target.account_id]);
      await closeOpenRequest(db, caller.clan_id, target.account_id);
      await cancelInvitationsBy(db, caller.clan_id, target.account_id);
      return null;
    }
    if (action === 'promote' && target.role === 'deckhand') {
      await db.query("UPDATE clan_members SET role = 'mate', mate_since = $2 WHERE account_id = $1", [target.account_id, at]);
    } else if (action === 'promote') {
      await db.query("UPDATE clan_members SET role = 'skipper', mate_since = NULL WHERE account_id = $1", [target.account_id]);
      await db.query("UPDATE clan_members SET role = 'mate', mate_since = $2 WHERE account_id = $1", [caller.account_id, at]);
    } else {
      await db.query("UPDATE clan_members SET role = 'deckhand', mate_since = NULL WHERE account_id = $1", [target.account_id]);
      await cancelInvitationsBy(db, caller.clan_id, target.account_id);
    }
    return memberViewOf(db, target.account_id);
  });
}

publicRoute('GET', '/api/league/clans', async () => {
  const clans = await tx(async (db) => (await standings(db)).slice(0, 50));
  return { status: 200, body: { clans: clans.map((c) => ({ rank: c.rank, id: c.id, name: c.name, trophies: c.trophies, memberCount: c.memberCount })) } };
});

sessionRoute('POST', '/api/clans', async (ctx) => {
  requireVerified(ctx.account);
  const f = new Fields(ctx.body, ['name', 'motto']);
  const name = f.take('name', (v): v is string => isString(v) && v.trim().length >= 3 && v.trim().length <= 24, MESSAGES.clanName);
  const motto = f.take('motto', (v): v is string => isString(v) && v.length <= 80, MESSAGES.motto);
  f.done();
  const clanName = (name as string).trim();
  try {
    const clan = await tx(async (db) => {
      await db.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [ctx.account.id]);
      if (await membershipOf(db, ctx.account.id)) fail('already_in_clan');
      const taken = await db.query('SELECT 1 FROM clans WHERE name_lower = lower($1) AND dissolved_at IS NULL', [clanName]);
      if ((taken.rowCount ?? 0) > 0) fail('clan_name_taken');
      const at = now();
      const { rows } = await db.query<{ id: number }>(
        'INSERT INTO clans (name, name_lower, motto, created_at) VALUES ($1, lower($1), $2, $3) RETURNING id',
        [clanName, motto, at],
      );
      await db.query("INSERT INTO clan_members (account_id, clan_id, role, joined_at) VALUES ($1, $2, 'skipper', $3)", [ctx.account.id, (rows[0] as { id: number }).id, at]);
      return clanView(db, ctx.account.id);
    });
    return { status: 201, body: { clan } };
  } catch (error) {
    if ((error as { code?: unknown }).code === '23505') fail('clan_name_taken');
    throw error;
  }
});

sessionRoute('GET', '/api/clan', async (ctx) => ({ status: 200, body: { clan: await tx((db) => clanView(db, ctx.account.id)) } }));

sessionRoute('POST', '/api/clan/invitations', async (ctx) => {
  await tx(async (db) => {
    const caller = await lockClanOf(db, ctx.account.id);
    if (!isWarden(caller.role)) fail('forbidden');
    requireVerified(ctx.account);
    const f = new Fields(ctx.body, ['email']);
    const email = f.take('email', isEmail, MESSAGES.email) as string;
    f.done();
    const clan = (await db.query<{ name: string }>('SELECT name FROM clans WHERE id = $1', [caller.clan_id])).rows[0] as { name: string };
    const account = (await db.query<{ id: number }>('SELECT id FROM accounts WHERE email_lower = lower($1)', [email])).rows[0];
    const member = account ? (await membershipOf(db, account.id))?.clan_id === caller.clan_id : false;
    const pending = await db.query("SELECT 1 FROM invitations WHERE clan_id = $1 AND email_lower = lower($2) AND state = 'pending'", [caller.clan_id, email]);
    if (!member && (pending.rowCount ?? 0) === 0) {
      await db.query("INSERT INTO invitations (clan_id, email_lower, inviter_account_id, state, created_at) VALUES ($1, lower($2), $3, 'pending', $4)", [caller.clan_id, email, ctx.account.id, now()]);
    }
    await queueMail(db, email, MAIL.invitationSubject(ctx.account.displayName, clan.name), MAIL.invitation(ctx.account.displayName, clan.name, account !== undefined));
  });
  return { status: 202, body: { status: 'invited' } };
});

export async function invitationsFor(db: Db, account: Account): Promise<Record<string, unknown>[]> {
  if (!account.verified) return [];
  const { rows } = await db.query<{ id: number; clan_id: number; clan_name: string; inviter_name: string }>(
    `SELECT i.id, c.id AS clan_id, c.name AS clan_name, a.display_name AS inviter_name
       FROM invitations i JOIN clans c ON c.id = i.clan_id JOIN accounts a ON a.id = i.inviter_account_id
      WHERE i.email_lower = lower($1) AND i.state = 'pending' AND c.dissolved_at IS NULL ORDER BY i.id`,
    [account.email],
  );
  return rows.map((r) => ({ id: r.id, clan: { id: r.clan_id, name: r.clan_name }, invitedBy: { displayName: r.inviter_name } }));
}

sessionRoute('GET', '/api/me/invitations', async (ctx) => {
  const account = ctx.account;
  return { status: 200, body: { invitations: await tx(async (db) => invitationsFor(db, { ...account, verified: await isVerified(db, account.id) })) } };
});

async function isVerified(db: Db, accountId: number): Promise<boolean> {
  return ((await db.query<{ verified: boolean }>('SELECT verified FROM accounts WHERE id = $1', [accountId])).rows[0] as { verified: boolean }).verified;
}

async function myInvitation(db: Db, account: Account, id: number): Promise<{ id: number; clan_id: number; state: string }> {
  const { rows } = await db.query<{ id: number; clan_id: number; state: string }>(
    'SELECT id, clan_id, state FROM invitations WHERE id = $1 AND email_lower = lower($2)',
    [id, account.email],
  );
  const invitation = rows[0];
  if (!invitation || invitation.state !== 'pending') return fail('not_found');
  return invitation;
}

sessionRoute('POST', '/api/invitations/:id/accept', async (ctx) => {
  const clan = await tx(async (db) => {
    const first = await myInvitation(db, ctx.account, ctx.params.id as number);
    requireVerified(ctx.account);
    new Fields(ctx.body, []).done();
    await db.query('SELECT id FROM clans WHERE id = $1 FOR UPDATE', [first.clan_id]);
    await myInvitation(db, ctx.account, first.id);
    if (await membershipOf(db, ctx.account.id)) fail('already_in_clan');
    const count = (await clanMembers(db, first.clan_id)).length;
    if (count >= CLAN_MAX) fail('clan_full');
    await db.query("INSERT INTO clan_members (account_id, clan_id, role, joined_at) VALUES ($1, $2, 'deckhand', $3)", [ctx.account.id, first.clan_id, now()]);
    await db.query("UPDATE invitations SET state = 'accepted' WHERE id = $1", [first.id]);
    return clanView(db, ctx.account.id);
  });
  return { status: 200, body: { clan } };
});

sessionRoute('POST', '/api/invitations/:id/decline', async (ctx) => {
  await tx(async (db) => {
    const invitation = await myInvitation(db, ctx.account, ctx.params.id as number);
    new Fields(ctx.body, []).done();
    await db.query("UPDATE invitations SET state = 'declined' WHERE id = $1", [invitation.id]);
  });
  return { status: 204 };
});

sessionRoute('POST', '/api/clan/members/:accountId/promote', async (ctx) => ({ status: 200, body: await changeRole(ctx, 'promote') }));
sessionRoute('POST', '/api/clan/members/:accountId/demote', async (ctx) => ({ status: 200, body: await changeRole(ctx, 'demote') }));
sessionRoute('DELETE', '/api/clan/members/:accountId', async (ctx) => {
  await changeRole(ctx, 'remove');
  return { status: 204 };
});

sessionRoute('POST', '/api/clan/leave', async (ctx) => {
  const body = await tx(async (db) => {
    const me = await lockClanOf(db, ctx.account.id);
    new Fields(ctx.body, []).done();
    const at = now();
    await db.query('DELETE FROM clan_members WHERE account_id = $1', [me.account_id]);
    await closeOpenRequest(db, me.clan_id, me.account_id);
    await cancelInvitationsBy(db, me.clan_id, me.account_id);
    const rest = await clanMembers(db, me.clan_id);
    if (rest.length === 0) {
      await db.query('UPDATE clans SET dissolved_at = $2 WHERE id = $1', [me.clan_id, at]);
      await db.query("UPDATE invitations SET state = 'cancelled' WHERE clan_id = $1 AND state = 'pending'", [me.clan_id]);
      await db.query("UPDATE donation_requests SET state = 'closed' WHERE clan_id = $1 AND state = 'open'", [me.clan_id]);
      return { clan: null, newSkipper: null, disbanded: true };
    }
    if (me.role !== 'skipper') return { clan: null, newSkipper: null, disbanded: false };
    const next = successor(rest) as Membership;
    await db.query("UPDATE clan_members SET role = 'skipper', mate_since = NULL WHERE account_id = $1", [next.account_id]);
    const name = (await db.query<{ display_name: string }>('SELECT display_name FROM accounts WHERE id = $1', [next.account_id])).rows[0] as { display_name: string };
    return { clan: null, newSkipper: { accountId: next.account_id, displayName: name.display_name }, disbanded: false };
  });
  return { status: 200, body };
});

interface MessageRow {
  id: number;
  author_account_id: number;
  display_name: string;
  body: string | null;
  removed: boolean;
  created_at: number;
}

const messageView = (m: MessageRow): Record<string, unknown> => ({
  id: m.id,
  author: { accountId: m.author_account_id, displayName: m.display_name },
  body: m.removed ? null : m.body,
  removed: m.removed,
  createdAt: iso(m.created_at),
});

export async function clanMessages(db: Db, clanId: number, after: number | null): Promise<Record<string, unknown>[]> {
  const { rows } = await db.query<MessageRow>(
    `SELECT * FROM (
       SELECT m.id, m.author_account_id, a.display_name, m.body, m.removed, m.created_at
         FROM clan_messages m JOIN accounts a ON a.id = m.author_account_id
        WHERE m.clan_id = $1 AND ($2::bigint IS NULL OR m.id > $2)
        ORDER BY m.id DESC LIMIT 50) recent
      ORDER BY id ASC`,
    [clanId, after],
  );
  return rows.map(messageView);
}

sessionRoute('GET', '/api/clan/messages', async (ctx) => {
  const raw = ctx.query.get('after');
  const after = raw === null ? null : parseId(raw);
  if (raw !== null && after === null) rejectField('after', MESSAGES.listId);
  const messages = await tx(async (db) => {
    const me = await requireMembership(db, ctx.account.id);
    if (after !== null) {
      const known = await db.query('SELECT 1 FROM clan_messages WHERE id = $1 AND clan_id = $2', [after, me.clan_id]);
      if ((known.rowCount ?? 0) === 0) fail('not_found');
    }
    return clanMessages(db, me.clan_id, after);
  });
  return { status: 200, body: { messages } };
});

sessionRoute('POST', '/api/clan/messages', async (ctx) => {
  requireVerified(ctx.account);
  const f = new Fields(ctx.body, ['body']);
  const text = f.take('body', (v): v is string => isString(v) && v.trim().length >= 1 && v.trim().length <= 500, MESSAGES.body);
  f.done();
  const message = await tx(async (db) => {
    const me = await requireMembership(db, ctx.account.id);
    const { rows } = await db.query<{ id: number }>(
      'INSERT INTO clan_messages (clan_id, author_account_id, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [me.clan_id, ctx.account.id, text, now()],
    );
    const row = (await db.query<MessageRow>(
      'SELECT m.id, m.author_account_id, a.display_name, m.body, m.removed, m.created_at FROM clan_messages m JOIN accounts a ON a.id = m.author_account_id WHERE m.id = $1',
      [(rows[0] as { id: number }).id],
    )).rows[0] as MessageRow;
    return messageView(row);
  });
  return { status: 201, body: message };
}, { throttle: (ctx) => ({ key: `chat:${(ctx.session?.account as Account).id}`, ...CHAT_LIMIT }) });

sessionRoute('DELETE', '/api/clan/messages/:id', async (ctx) => {
  await tx(async (db) => {
    const me = await requireMembership(db, ctx.account.id);
    const found = await db.query('SELECT 1 FROM clan_messages WHERE id = $1 AND clan_id = $2', [ctx.params.id, me.clan_id]);
    if ((found.rowCount ?? 0) === 0) fail('not_found');
    if (!isWarden(me.role)) fail('forbidden');
    await db.query('UPDATE clan_messages SET removed = true, body = NULL WHERE id = $1', [ctx.params.id]);
  });
  return { status: 204 };
});

interface RequestRow {
  id: number;
  clan_id: number;
  requester_account_id: number;
  display_name: string;
  unit: UnitKey;
  count: number;
  state: RequestState;
  created_at: number;
  given: number;
}

const REQUEST_SELECT = `SELECT r.*, a.display_name,
    (SELECT COALESCE(SUM(d.count), 0) FROM donations d WHERE d.request_id = r.id)::bigint AS given
  FROM donation_requests r JOIN accounts a ON a.id = r.requester_account_id`;

const requestView = (r: RequestRow): Record<string, unknown> => ({
  id: r.id, requester: { accountId: r.requester_account_id, displayName: r.display_name }, unit: r.unit, count: r.count,
  given: r.given, state: r.state, createdAt: iso(r.created_at),
});

async function requestById(db: Db, id: number): Promise<RequestRow> {
  return (await db.query<RequestRow>(`${REQUEST_SELECT} WHERE r.id = $1`, [id])).rows[0] as RequestRow;
}

export async function clanRequests(db: Db, clanId: number, accountId: number): Promise<{ requests: Record<string, unknown>[]; mine: Record<string, unknown> | null }> {
  const open = (await db.query<RequestRow>(`${REQUEST_SELECT} WHERE r.clan_id = $1 AND r.state = 'open' ORDER BY r.id`, [clanId])).rows;
  const mine = (await db.query<RequestRow>(`${REQUEST_SELECT} WHERE r.clan_id = $1 AND r.requester_account_id = $2 ORDER BY r.id DESC LIMIT 1`, [clanId, accountId])).rows[0];
  return { requests: open.map(requestView), mine: mine ? requestView(mine) : null };
}

/** A request in the caller's clan, or not_found. */
async function clanRequest(db: Db, accountId: number, id: number, lock: boolean): Promise<{ me: Membership; request: RequestRow }> {
  const me = await requireMembership(db, accountId);
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM donation_requests WHERE id = $1 AND clan_id = $2${lock ? ' FOR UPDATE' : ''}`, [id, me.clan_id]);
  if (rows.length === 0) fail('not_found');
  return { me, request: await requestById(db, id) };
}

sessionRoute('GET', '/api/clan/requests', async (ctx) => {
  const body = await tx(async (db) => clanRequests(db, (await requireMembership(db, ctx.account.id)).clan_id, ctx.account.id));
  return { status: 200, body };
});

sessionRoute('POST', '/api/clan/requests', async (ctx) => {
  requireVerified(ctx.account);
  const f = new Fields(ctx.body, ['unit', 'count']);
  const unit = f.take('unit', isUnitKey, MESSAGES.unit);
  const count = f.take('count', intIn(1, 6), MESSAGES.requestCount);
  f.done();
  const body = await tx(async (db) => {
    const me = (await membershipOf(db, ctx.account.id, true)) ?? fail('not_in_clan');
    const open = await db.query("SELECT 1 FROM donation_requests WHERE clan_id = $1 AND requester_account_id = $2 AND state = 'open'", [me.clan_id, ctx.account.id]);
    if ((open.rowCount ?? 0) > 0) fail('request_open');
    const { rows } = await db.query<{ id: number }>(
      "INSERT INTO donation_requests (clan_id, requester_account_id, unit, count, state, created_at) VALUES ($1, $2, $3, $4, 'open', $5) RETURNING id",
      [me.clan_id, ctx.account.id, unit, count, now()],
    );
    return requestView(await requestById(db, (rows[0] as { id: number }).id));
  });
  return { status: 201, body };
});

sessionRoute('POST', '/api/clan/requests/:id/cancel', async (ctx) => {
  const body = await tx(async (db) => {
    const { request } = await clanRequest(db, ctx.account.id, ctx.params.id as number, true);
    if (request.requester_account_id !== ctx.account.id) fail('forbidden');
    new Fields(ctx.body, []).done();
    if (request.state !== 'open') fail('request_closed');
    await db.query("UPDATE donation_requests SET state = 'closed' WHERE id = $1", [request.id]);
    return requestView({ ...request, state: 'closed' });
  });
  return { status: 200, body };
});

sessionRoute('POST', '/api/clan/requests/:id/donations', async (ctx) => {
  const body = await tx(async (db) => {
    const { me, request } = await clanRequest(db, ctx.account.id, ctx.params.id as number, true);
    requireVerified(ctx.account);
    const f = new Fields(ctx.body, ['count']);
    const count = f.take('count', intIn(1, DONOR_PER_REQUEST), MESSAGES.donationCount) as number;
    f.done();
    if (request.requester_account_id === ctx.account.id) fail('own_request');
    if (request.state !== 'open') fail('request_closed');
    if (count > request.count - request.given) fail('exceeds_request');
    const mine = await db.query<{ n: number }>(
      'SELECT COALESCE(SUM(count), 0)::bigint AS n FROM donations WHERE request_id = $1 AND donor_account_id = $2',
      [request.id, ctx.account.id],
    );
    if ((mine.rows[0] as { n: number }).n + count > DONOR_PER_REQUEST) fail('donor_limit');
    const at = now();
    const zone = ((await db.query<{ time_zone: string }>('SELECT time_zone FROM accounts WHERE id = $1', [ctx.account.id])).rows[0] as { time_zone: string }).time_zone;
    const today = localDay(at, zone);
    const given = await db.query<{ n: number }>(
      'SELECT COALESCE(SUM(count), 0)::bigint AS n FROM donations WHERE donor_account_id = $1 AND created_at >= $2 AND created_at < $3',
      [ctx.account.id, today.start, today.end],
    );
    if ((given.rows[0] as { n: number }).n + count > DONOR_DAILY_CAP) fail('donation_cap_reached', { nextDonationAt: iso(today.end) });
    const donorVillage = (await villageIdOf(db, ctx.account.id)) as number;
    const recipientVillage = (await villageIdOf(db, request.requester_account_id)) as number;
    const [donor, recipient] = await lockIslands(db, donorVillage, recipientVillage, at);
    if (army(donor)[request.unit] < count) fail('units_unavailable');
    const space = housing(recipient);
    if (space.used + count * UNITS[request.unit].housing > space.capacity) fail('recipient_housing_full');
    const raiding = await db.query("SELECT 1 FROM raids WHERE attacker_village_id = $1 AND state IN ('locked', 'deploying')", [donorVillage]);
    if ((raiding.rowCount ?? 0) > 0) fail('raid_in_progress');
    const pairId = (await move(db, donor, { kind: 'donation', asset: request.unit, amount: -count, other: recipient, at })) as number;
    await db.query(
      'INSERT INTO donations (request_id, clan_id, donor_account_id, recipient_account_id, unit, count, pair_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [request.id, me.clan_id, ctx.account.id, request.requester_account_id, request.unit, count, pairId, at],
    );
    if (request.given + count === request.count) await db.query("UPDATE donation_requests SET state = 'filled' WHERE id = $1", [request.id]);
    return { request: requestView(await requestById(db, request.id)), donation: { unit: request.unit, count, pairId } };
  });
  return { status: 201, body };
});
