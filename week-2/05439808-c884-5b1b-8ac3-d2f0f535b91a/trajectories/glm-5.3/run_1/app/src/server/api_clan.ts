// Clans: founding, invitations, warden powers, succession, chat and the league table.
import { errors } from './errors.ts';
import { pathId, route, type Ctx } from './http.ts';
import { withTransaction } from './runtime.ts';
import { checkThrottle } from './throttle.ts';
import { enqueueMail } from './mail.ts';
import { getApp } from './runtime.ts';
import {
  exactFields, optionalCount, optionalString, requireObject, requiredString, throwIfErrors, unitOf, validateEmail,
} from './validate.ts';
import type { ClanRole } from '../domain/types.ts';

const CLAN_MAX_MEMBERS = 10;
const CLAN_MAX_MATES = 4;

interface MemberRow {
  accountId: number;
  displayName: string;
  villageId: number | null;
  role: ClanRole;
  trophies: number;
  donated: number;
  received: number;
  joinedAt: number;
  mateSince: number | null;
}

interface ClanInfo {
  id: number;
  name: string;
  motto: string;
  members: MemberRow[];
  myRole: ClanRole | null;
  trophies: number;
  rank: number;
}

async function lockClan(client: import('pg').PoolClient, clanId: number): Promise<void> {
  await client.query('SELECT id FROM clans WHERE id = $1 FOR UPDATE', [clanId]);
}

async function clanMembers(client: import('pg').PoolClient, clanId: number): Promise<MemberRow[]> {
  const result = await client.query(
    `SELECT m.account_id, a.display_name, v.id AS village_id, m.role, v.trophies, m.joined_at, m.mate_since,
     (SELECT COALESCE(SUM(d.count), 0) FROM donations d WHERE d.clan_id = m.clan_id AND d.donor_id = m.account_id AND d.created_at >= m.joined_at) AS donated,
     (SELECT COALESCE(SUM(d.count), 0) FROM donations d WHERE d.clan_id = m.clan_id AND d.recipient_id = m.account_id AND d.created_at >= m.joined_at) AS received
     FROM clan_members m
     JOIN accounts a ON a.id = m.account_id
     LEFT JOIN villages v ON v.account_id = a.id
     WHERE m.clan_id = $1
     ORDER BY m.joined_at, m.account_id`,
    [clanId]
  );
  return result.rows.map((r) => ({
    accountId: Number(r.account_id),
    displayName: r.display_name,
    villageId: r.village_id === null ? null : Number(r.village_id),
    role: r.role as ClanRole,
    trophies: r.trophies === null ? 0 : Number(r.trophies),
    donated: Number(r.donated),
    received: Number(r.received),
    joinedAt: Number(r.joined_at),
    mateSince: r.mate_since === null ? null : Number(r.mate_since),
  }));
}

async function clanRankOf(client: import('pg').PoolClient, clanId: number): Promise<number> {
  const rows = await leagueRows(client);
  const hit = rows.find((r) => r.id === clanId);
  return hit ? hit.rank : 0;
}

async function leagueRows(client: import('pg').PoolClient): Promise<{ rank: number; id: number; name: string; trophies: number; memberCount: number }[]> {
  const result = await client.query(
    `SELECT c.id, c.name, COALESCE(SUM(v.trophies), 0) AS trophies, COUNT(m.account_id) AS member_count
     FROM clans c
     LEFT JOIN clan_members m ON m.clan_id = c.id
     LEFT JOIN villages v ON v.account_id = m.account_id
     WHERE c.dissolved_at IS NULL
     GROUP BY c.id, c.name
     ORDER BY COALESCE(SUM(v.trophies), 0) DESC, lower(c.name) ASC`
  );
  return result.rows.map((r, i) => ({
    rank: i + 1,
    id: Number(r.id),
    name: r.name,
    trophies: Number(r.trophies),
    memberCount: Number(r.member_count),
  }));
}

function memberJson(m: MemberRow): Record<string, unknown> {
  return {
    accountId: m.accountId,
    displayName: m.displayName,
    villageId: m.villageId,
    role: m.role,
    trophies: m.trophies,
    donated: m.donated,
    received: m.received,
    joinedAt: new Date(m.joinedAt).toISOString(),
    mateSince: m.mateSince === null ? null : new Date(m.mateSince).toISOString(),
  };
}

function clanJson(info: ClanInfo): Record<string, unknown> {
  return {
    id: info.id,
    name: info.name,
    motto: info.motto,
    trophies: info.trophies,
    rank: info.rank,
    myRole: info.myRole,
    members: info.members.map(memberJson),
  };
}

async function loadClanInfo(ctx: Ctx, client: import('pg').PoolClient, clanId: number): Promise<ClanInfo> {
  const clan = await client.query<{ id: string; name: string; motto: string }>(
    'SELECT id, name, motto FROM clans WHERE id = $1 AND dissolved_at IS NULL',
    [clanId]
  );
  const row = clan.rows[0];
  const members = await clanMembers(client, clanId);
  return {
    id: Number(row.id),
    name: row.name,
    motto: row.motto,
    members,
    myRole: members.find((m) => m.accountId === ctx.account!.id)?.role ?? null,
    trophies: members.reduce((acc, m) => acc + m.trophies, 0),
    rank: await clanRankOf(client, clanId),
  };
}

route('GET', '/api/league/clans', 'public', async () => {
  const clans = await withTransaction((client) => leagueRows(client));
  return { status: 200, body: { clans: clans.slice(0, 50) } };
});

route('GET', '/api/clan', 'session', async (ctx) => {
  const clanId = ctx.account!.clanId;
  if (clanId === null) return { status: 200, body: { clan: null } };
  const info = await withTransaction((client) => loadClanInfo(ctx, client, clanId));
  return { status: 200, body: { clan: clanJson(info) } };
});

route('POST', '/api/clans', 'session-verified', async (ctx) => {
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['name', 'motto']);
  const name = requiredString(body, fieldErrors, 'name');
  const motto = optionalString(body, 'motto') ?? '';
  if (!fieldErrors.name && (name.length < 3 || name.length > 24)) fieldErrors.name = 'Use 3 to 24 characters.';
  if (!fieldErrors.motto && motto.length > 80) fieldErrors.motto = 'Use at most 80 characters.';
  throwIfErrors(fieldErrors);

  if (ctx.account!.clanId !== null) throw errors.conflict('already_in_clan', 'Leave your current clan first.');
  const clanId = await withTransaction(async (client) => {
    await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [ctx.account!.id]);
    const taken = await client.query('SELECT id FROM clans WHERE lower(name) = $1 AND dissolved_at IS NULL', [name.toLowerCase()]);
    if (taken.rows.length > 0) throw errors.conflict('clan_name_taken', 'That clan name is taken.');
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO clans (name, motto, created_at) VALUES ($1, $2, $3) RETURNING id',
      [name, motto, ctx.now]
    );
    const id = Number(inserted.rows[0].id);
    await client.query(`INSERT INTO clan_members (clan_id, account_id, role, joined_at) VALUES ($1, $2, 'skipper', $3)`, [
      id, ctx.account!.id, ctx.now,
    ]);
    return id;
  });
  const info = await withTransaction((client) => loadClanInfo(ctx, client, clanId));
  return { status: 201, body: { clan: clanJson(info) } };
});

route('POST', '/api/clan/invitations', 'session-verified', async (ctx) => {
  const app = getApp();
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['email']);
  const email = requiredString(body, fieldErrors, 'email');
  const emailError = fieldErrors.email ? undefined : validateEmail(email);
  if (emailError) fieldErrors.email = emailError;
  throwIfErrors(fieldErrors);

  const clanId = ctx.account!.clanId!;
  await withTransaction(async (client) => {
    await lockClan(client, clanId);
    const me = await client.query<{ role: string }>('SELECT role FROM clan_members WHERE clan_id = $1 AND account_id = $2', [clanId, ctx.account!.id]);
    if (me.rows.length === 0) throw errors.conflict('not_in_clan', 'You’re no longer in this clan.');
    if (me.rows[0].role === 'deckhand') throw errors.forbidden();

    const emailLc = email.toLowerCase();
    const member = await client.query('SELECT 1 FROM clan_members m JOIN accounts a ON a.id = m.account_id WHERE m.clan_id = $1 AND a.email_lc = $2', [clanId, emailLc]);
    const pending = await client.query(
      `SELECT 1 FROM invitations i JOIN clans c ON c.id = i.clan_id WHERE i.clan_id = $1 AND i.email_lc = $2 AND i.status = 'pending' AND c.dissolved_at IS NULL`,
      [clanId, emailLc]
    );
    const hasAccount = await client.query('SELECT 1 FROM accounts WHERE email_lc = $1', [emailLc]);
    if (member.rows.length === 0 && pending.rows.length === 0) {
      await client.query('INSERT INTO invitations (clan_id, email_lc, invited_by, created_at, status) VALUES ($1, $2, $3, $4, $5)', [
        clanId, emailLc, ctx.account!.id, ctx.now, 'pending',
      ]);
    }
    await enqueueMail(client, {
      to: email,
      subject: `${ctx.account!.displayName} invited you to ${(await client.query('SELECT name FROM clans WHERE id = $1', [clanId])).rows[0].name} on Saltreach`,
      body: `${ctx.account!.displayName} invited you to join their clan.\n\nAccept it from the Clan panel in Saltreach.\n\n${hasAccount.rows.length === 0 ? `No account uses this address yet — create one first: ${app.env.appPublicUrl}/signup` : `Sign in and open the Clan panel: ${app.env.appPublicUrl}`}`,
    }, ctx.now);
  });
  return { status: 202, body: { status: 'invited' } };
});

route('POST', '/api/invitations/:id/accept', 'session-verified', async (ctx) => {
  const invitationId = pathId(ctx, 'id');
  const body = requireObject(ctx.body);
  throwIfErrors(exactFields(body, []));

  const emailLc = ctx.account!.email.toLowerCase();
  const clanId = await withTransaction(async (client) => {
    const invitation = await client.query<{ id: string; clan_id: string; email_lc: string; status: string }>(
      `SELECT i.id, i.clan_id, i.email_lc, i.status FROM invitations i JOIN clans c ON c.id = i.clan_id
       WHERE i.id = $1 AND i.email_lc = $2 AND i.status = 'pending' AND c.dissolved_at IS NULL`,
      [invitationId, emailLc]
    );
    const inv = invitation.rows[0];
    if (!inv) throw errors.notFound();
    const clanId = Number(inv.clan_id);
    await lockClan(client, clanId);
    if (ctx.account!.clanId !== null) throw errors.conflict('already_in_clan', 'Leave your current clan first.');
    const count = await client.query<{ count: string }>('SELECT COUNT(*)::int AS count FROM clan_members WHERE clan_id = $1', [clanId]);
    if (Number(count.rows[0].count) >= CLAN_MAX_MEMBERS) throw errors.conflict('clan_full', 'That clan is full.');
    await client.query(`INSERT INTO clan_members (clan_id, account_id, role, joined_at) VALUES ($1, $2, 'deckhand', $3)`, [
      clanId, ctx.account!.id, ctx.now,
    ]);
    await client.query('UPDATE invitations SET status = $2 WHERE id = $1', [invitationId, 'accepted']);
    return clanId;
  });
  const info = await withTransaction((client) => loadClanInfo(ctx, client, clanId));
  return { status: 200, body: { clan: clanJson(info) } };
});

route('POST', '/api/invitations/:id/decline', 'session', async (ctx) => {
  const invitationId = pathId(ctx, 'id');
  await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE invitations SET status = 'declined' WHERE id = $1 AND email_lc = $2 AND status = 'pending'`,
      [invitationId, ctx.account!.email.toLowerCase()]
    );
    if (result.rowCount === 0) throw errors.notFound();
  });
  return undefined; // 204
});

async function cancelInvitationsOf(client: import('pg').PoolClient, clanId: number, accountId: number | null): Promise<void> {
  if (accountId === null) {
    await client.query(`UPDATE invitations SET status = 'cancelled' WHERE clan_id = $1 AND status = 'pending'`, [clanId]);
  } else {
    await client.query(`UPDATE invitations SET status = 'cancelled' WHERE clan_id = $1 AND invited_by = $2 AND status = 'pending'`, [clanId, accountId]);
  }
}

route('POST', '/api/clan/members/:id/promote', 'session-clan', async (ctx) => {
  const targetId = pathId(ctx, 'id');
  const body = requireObject(ctx.body);
  throwIfErrors(exactFields(body, []));
  const member = await roleChange(ctx, targetId, (me, target, mateCount) => {
    if (me !== 'skipper') return 'forbidden';
    if (target === 'skipper') return 'invalid_role_change';
    if (target === 'deckhand' && mateCount >= CLAN_MAX_MATES) return 'invalid_role_change';
    return null;
  }, async (client, clanId, target) => {
    if (target.role === 'mate') {
      await client.query(`UPDATE clan_members SET role = 'skipper', mate_since = NULL WHERE clan_id = $1 AND account_id = $2`, [clanId, target.accountId]);
      await client.query(`UPDATE clan_members SET role = 'mate', mate_since = $2 WHERE clan_id = $1 AND account_id = $3`, [clanId, ctx.now, ctx.account!.id]);
    } else {
      await client.query(`UPDATE clan_members SET role = 'mate', mate_since = $2 WHERE clan_id = $1 AND account_id = $3`, [clanId, ctx.now, target.accountId]);
    }
  });
  return { status: 200, body: memberJson(member) };
});

route('POST', '/api/clan/members/:id/demote', 'session-clan', async (ctx) => {
  const targetId = pathId(ctx, 'id');
  const body = requireObject(ctx.body);
  throwIfErrors(exactFields(body, []));
  const member = await roleChange(ctx, targetId, (me, target) => {
    if (me !== 'skipper') return 'forbidden';
    if (target !== 'mate') return 'invalid_role_change';
    return null;
  }, async (client, clanId, target) => {
    await client.query(`UPDATE clan_members SET role = 'deckhand', mate_since = NULL WHERE clan_id = $1 AND account_id = $2`, [clanId, target.accountId]);
  });
  return { status: 200, body: memberJson(member) };
});

route('DELETE', '/api/clan/members/:id', 'session-clan', async (ctx) => {
  const targetId = pathId(ctx, 'id');
  await withTransaction(async (client) => {
    const clanId = ctx.account!.clanId!;
    await lockClan(client, clanId);
    const caller = await client.query<{ role: ClanRole }>('SELECT role FROM clan_members WHERE clan_id = $1 AND account_id = $2', [clanId, ctx.account!.id]);
    if (caller.rows.length === 0) throw errors.conflict('not_in_clan', 'You’re no longer in this clan.');
    const me = caller.rows[0].role;
    const target = await client.query<{ account_id: string; role: ClanRole }>('SELECT account_id, role FROM clan_members WHERE clan_id = $1 AND account_id = $2', [clanId, targetId]);
    if (target.rows.length === 0) throw errors.notFound();
    const targetRole = target.rows[0].role as ClanRole;
    if (me === 'deckhand') throw errors.forbidden();
    if (me === 'mate' && targetRole !== 'deckhand') throw errors.forbidden();
    if (targetRole === 'skipper') throw errors.conflict('invalid_role_change', 'That role change isn’t allowed.');
    await client.query('DELETE FROM clan_members WHERE clan_id = $1 AND account_id = $2', [clanId, targetId]);
    await client.query(`UPDATE requests SET state = 'closed', closed_at = $3 WHERE requester_id = $1 AND clan_id = $2 AND state = 'open'`, [targetId, clanId, ctx.now]);
    await cancelInvitationsOf(client, clanId, targetId);
  });
  return undefined;
});

async function roleChange(
  ctx: Ctx,
  targetId: number,
  check: (me: ClanRole, target: ClanRole, mateCount: number) => string | null,
  apply: (client: import('pg').PoolClient, clanId: number, target: MemberRow) => Promise<void>
): Promise<MemberRow> {
  return withTransaction(async (client) => {
    const clanId = ctx.account!.clanId!;
    await lockClan(client, clanId);
    const caller = await client.query<{ role: ClanRole }>('SELECT role FROM clan_members WHERE clan_id = $1 AND account_id = $2', [clanId, ctx.account!.id]);
    if (caller.rows.length === 0) throw errors.conflict('not_in_clan', 'You’re no longer in this clan.');
    const me = caller.rows[0].role;
    const members = await clanMembers(client, clanId);
    const target = members.find((m) => m.accountId === targetId);
    if (!target) throw errors.notFound();
    const mateCount = members.filter((m) => m.role === 'mate').length;
    const refusal = check(me, target.role, mateCount);
    if (refusal === 'forbidden') throw errors.forbidden();
    if (refusal === 'invalid_role_change') throw errors.conflict('invalid_role_change', 'That role change isn’t allowed.');
    await apply(client, clanId, target);
    const after = (await clanMembers(client, clanId)).find((m) => m.accountId === targetId);
    if (!after) throw errors.notFound();
    return after;
  });
}

route('POST', '/api/clan/leave', 'session-clan', async (ctx) => {
  const clanId = ctx.account!.clanId!;
  const outcome = await withTransaction(async (client) => {
    await lockClan(client, clanId);
    const me = ctx.account!.id;
    const members = await clanMembers(client, clanId);
    const mine = members.find((m) => m.accountId === me);
    if (!mine) throw errors.conflict('not_in_clan', 'You’re no longer in this clan.');
    await client.query('DELETE FROM clan_members WHERE clan_id = $1 AND account_id = $2', [clanId, me]);
    await client.query(`UPDATE requests SET state = 'closed', closed_at = $3 WHERE requester_id = $1 AND clan_id = $2 AND state = 'open'`, [me, clanId, ctx.now]);
    await cancelInvitationsOf(client, clanId, me);

    const remaining = members.filter((m) => m.accountId !== me);
    let newSkipper: MemberRow | null = null;
    let disbanded = false;
    if (remaining.length === 0) {
      await client.query('UPDATE clans SET dissolved_at = $2 WHERE id = $1', [clanId, ctx.now]);
      await cancelInvitationsOf(client, clanId, null);
      disbanded = true;
    } else if (mine.role === 'skipper') {
      const mates = remaining.filter((m) => m.role === 'mate' && m.mateSince !== null).sort((a, b) => a.mateSince! - b.mateSince! || a.accountId - b.accountId);
      const successor = mates[0] ?? remaining.slice().sort((a, b) => a.joinedAt - b.joinedAt || a.accountId - b.accountId)[0];
      await client.query(`UPDATE clan_members SET role = 'skipper', mate_since = NULL WHERE clan_id = $1 AND account_id = $2`, [clanId, successor.accountId]);
      newSkipper = successor;
    }
    return { newSkipper, disbanded };
  });
  return {
    status: 200,
    body: {
      clan: null,
      newSkipper: outcome.newSkipper ? { accountId: outcome.newSkipper.accountId, displayName: outcome.newSkipper.displayName } : null,
      disbanded: outcome.disbanded,
    },
  };
});

route('GET', '/api/clan/messages', 'session-clan', async (ctx) => {
  const clanId = ctx.account!.clanId!;
  const fieldErrors: Record<string, string> = {};
  const afterRaw = ctx.query.get('after');
  let after: number | null = null;
  if (afterRaw !== null) {
    const parsed = Number(afterRaw);
    if (!/^[1-9][0-9]{0,15}$/.test(afterRaw) || !Number.isSafeInteger(parsed)) fieldErrors.after = 'Use an ID from this list.';
    else after = parsed;
  }
  throwIfErrors(fieldErrors);

  const rows = await withTransaction(async (client) => {
    if (after !== null) {
      const hit = await client.query('SELECT id FROM messages WHERE id = $1 AND clan_id = $2', [after, clanId]);
      if (hit.rows.length === 0) return 'missing';
    }
    const params: unknown[] = [clanId];
    let sql = `SELECT m.*, a.display_name FROM messages m JOIN accounts a ON a.id = m.author_id WHERE m.clan_id = $1`;
    if (after !== null) {
      params.push(after);
      sql += ` AND m.id > $${params.length}`;
    }
    sql += ` ORDER BY m.id ASC LIMIT 50`;
    const result = await client.query(sql, params);
    return result.rows.map((r) => ({
      id: Number(r.id),
      author: { accountId: Number(r.author_id), displayName: r.display_name },
      body: r.removed ? null : r.body,
      removed: r.removed,
      createdAt: new Date(Number(r.created_at)).toISOString(),
    }));
  });
  if (rows === 'missing') throw errors.notFound();
  return { status: 200, body: { messages: rows } };
});

route('POST', '/api/clan/messages', 'session-clan-verified', async (ctx) => {
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['body']);
  const text = requiredString(body, fieldErrors, 'body');
  if (!fieldErrors.body && (text.trim().length < 1 || text.length > 500)) fieldErrors.body = 'Write 1 to 500 characters.';
  throwIfErrors(fieldErrors);

  await checkThrottle(`chat:${ctx.account!.id}`, 5, 10000, ctx.now);
  const message = await withTransaction(async (client) => {
    const clanId = ctx.account!.clanId!;
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO messages (clan_id, author_id, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [clanId, ctx.account!.id, text, ctx.now]
    );
    return {
      id: Number(inserted.rows[0].id),
      author: { accountId: ctx.account!.id, displayName: ctx.account!.displayName },
      body: text,
      removed: false,
      createdAt: new Date(ctx.now).toISOString(),
    };
  });
  return { status: 201, body: message };
});

route('DELETE', '/api/clan/messages/:id', 'session-clan', async (ctx) => {
  const messageId = pathId(ctx, 'id');
  await withTransaction(async (client) => {
    const clanId = ctx.account!.clanId!;
    await lockClan(client, clanId);
    const caller = await client.query<{ role: ClanRole }>('SELECT role FROM clan_members WHERE clan_id = $1 AND account_id = $2', [clanId, ctx.account!.id]);
    if (caller.rows.length === 0) throw errors.conflict('not_in_clan', 'You’re no longer in this clan.');
    if (caller.rows[0].role === 'deckhand') throw errors.forbidden();
    const result = await client.query('UPDATE messages SET removed = TRUE, body = NULL WHERE id = $1 AND clan_id = $2', [messageId, clanId]);
    if (result.rowCount === 0) throw errors.notFound();
  });
  return undefined;
});

// --- unit requests and donations ---

route('GET', '/api/clan/requests', 'session-clan', async (ctx) => {
  const clanId = ctx.account!.clanId!;
  const data = await withTransaction(async (client) => {
    const open = await client.query(
      `SELECT r.*, a.display_name FROM requests r JOIN accounts a ON a.id = r.requester_id
       WHERE r.clan_id = $1 AND r.state = 'open' ORDER BY r.id`,
      [clanId]
    );
    const mine = await client.query(
      `SELECT r.*, a.display_name FROM requests r JOIN accounts a ON a.id = r.requester_id
       WHERE r.clan_id = $1 AND r.requester_id = $2 ORDER BY r.id DESC LIMIT 1`,
      [clanId, ctx.account!.id]
    );
    return { open: open.rows, mine: mine.rows[0] ?? null };
  });
  const mapRequest = (r: Record<string, unknown> | null): Record<string, unknown> | null =>
    r === null
      ? null
      : {
          id: Number(r.id),
          requester: { accountId: Number(r.requester_id), displayName: r.display_name },
          unit: r.unit,
          count: Number(r.count),
          given: r.given === null ? 0 : Number(r.given),
          state: r.state,
          createdAt: new Date(Number(r.created_at)).toISOString(),
        };
  return {
    status: 200,
    body: { requests: data.open.map(mapRequest).filter((r) => r !== null), mine: mapRequest(data.mine) },
  };
});

route('POST', '/api/clan/requests', 'session-clan-verified', async (ctx) => {
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['unit', 'count']);
  const unit = unitOf(body, fieldErrors);
  const count = optionalCount(body, fieldErrors, 'count', 'Choose 1 to 6.');
  if (!fieldErrors.count && (count < 1 || count > 6)) fieldErrors.count = 'Choose 1 to 6.';
  throwIfErrors(fieldErrors);

  const clanId = ctx.account!.clanId!;
  const request = await withTransaction(async (client) => {
    await lockClan(client, clanId);
    const open = await client.query(`SELECT 1 FROM requests WHERE clan_id = $1 AND requester_id = $2 AND state = 'open'`, [clanId, ctx.account!.id]);
    if (open.rows.length > 0) throw errors.conflict('request_open', 'You already have an open request.');
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO requests (clan_id, requester_id, unit, count, given, created_at, state) VALUES ($1, $2, $3, $4, 0, $5, $6) RETURNING id',
      [clanId, ctx.account!.id, unit, count, ctx.now, 'open']
    );
    return { id: Number(inserted.rows[0].id) };
  });
  return {
    status: 201,
    body: {
      id: request.id,
      requester: { accountId: ctx.account!.id, displayName: ctx.account!.displayName },
      unit,
      count,
      given: 0,
      state: 'open',
      createdAt: new Date(ctx.now).toISOString(),
    },
  };
});

route('POST', '/api/clan/requests/:id/cancel', 'session-clan', async (ctx) => {
  const requestId = pathId(ctx, 'id');
  const body = requireObject(ctx.body);
  throwIfErrors(exactFields(body, []));

  const request = await withTransaction(async (client) => {
    await lockRequest(client, requestId);
    const row = await client.query<{ requester_id: string; clan_id: string; state: string; unit: string; count: number; given: number; created_at: string }>(
      'SELECT * FROM requests WHERE id = $1',
      [requestId]
    );
    const r = row.rows[0];
    if (!r || Number(r.clan_id) !== ctx.account!.clanId!) throw errors.notFound();
    if (Number(r.requester_id) !== ctx.account!.id) throw errors.forbidden();
    if (r.state !== 'open') throw errors.conflict('request_closed', 'That request is already filled or closed.');
    await client.query('UPDATE requests SET state = $2, closed_at = $3 WHERE id = $1', [requestId, 'closed', ctx.now]);
    return r;
  });
  return {
    status: 200,
    body: {
      id: requestId,
      requester: { accountId: ctx.account!.id, displayName: ctx.account!.displayName },
      unit: request.unit,
      count: Number(request.count),
      given: Number(request.given),
      state: 'closed',
      createdAt: new Date(Number(request.created_at)).toISOString(),
    },
  };
});

async function lockRequest(client: import('pg').PoolClient, requestId: number): Promise<void> {
  await client.query('SELECT id FROM requests WHERE id = $1 FOR UPDATE', [requestId]);
}

route('POST', '/api/clan/requests/:id/donations', 'session-clan-verified', async (ctx) => {
  const requestId = pathId(ctx, 'id');
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['count']);
  const count = optionalCount(body, fieldErrors, 'count', 'Choose 1 to 3.');
  if (!fieldErrors.count && (count < 1 || count > 3)) fieldErrors.count = 'Choose 1 to 3.';
  throwIfErrors(fieldErrors);

  const { dayStart, nextDayStart } = await import('../domain/localtime.ts');
  const outcome = await withTransaction(async (client) => {
    await lockRequest(client, requestId);
    const row = await client.query(`SELECT r.*, a.display_name AS requester_name FROM requests r JOIN accounts a ON a.id = r.requester_id WHERE r.id = $1`, [requestId]);
    const request = row.rows[0];
    if (!request || Number(request.clan_id) !== ctx.account!.clanId!) throw errors.notFound();

    const donorId = ctx.account!.id;
    const requesterId = Number(request.requester_id);
    const unit = request.unit as 'saltjack' | 'peat_slinger';
    if (requesterId === donorId) throw errors.conflict('own_request', 'You can’t donate to your own request.');
    if (request.state !== 'open') throw errors.conflict('request_closed', 'That request is already filled or closed.');
    if (count > Number(request.count) - Number(request.given)) throw errors.conflict('exceeds_request', 'That request needs fewer units now.');
    const donorTotal = await client.query<{ total: string }>(
      'SELECT COALESCE(SUM(count), 0)::int AS total FROM donations WHERE request_id = $1 AND donor_id = $2',
      [requestId, donorId]
    );
    if (Number(donorTotal.rows[0].total) + count > 3) throw errors.conflict('donor_limit', 'You’ve already given 3 units to this request.');

    const donorVillageId = ctx.account!.villageId;
    if (donorVillageId === null) throw errors.notFound();
    const zone = ctx.account!.timeZone;
    const dayLo = dayStart(ctx.now, zone);
    const dayHi = nextDayStart(ctx.now, zone);
    const donorDay = await client.query<{ total: string }>(
      'SELECT COALESCE(SUM(count), 0)::int AS total FROM donations WHERE donor_id = $1 AND created_at >= $2 AND created_at < $3',
      [donorId, dayLo, dayHi]
    );
    if (Number(donorDay.rows[0].total) + count > 8) {
      throw errors.conflict('donation_cap_reached', 'You’ve given 8 units today. Donate again later.', {
        nextDonationAt: new Date(dayHi).toISOString(),
      });
    }

    // Lock both islands, in id order, together with the request lock.
    const { lockVillages, loadIsland } = await import('./island.ts');
    const requesterInfo = await client.query<{ village_id: string | null }>(
      'SELECT v.id AS village_id FROM accounts a LEFT JOIN villages v ON v.account_id = a.id WHERE a.id = $1',
      [requesterId]
    );
    const requesterVillageId = requesterInfo.rows[0].village_id === null ? null : Number(requesterInfo.rows[0].village_id);
    if (requesterVillageId === null) throw errors.conflict('recipient_housing_full', 'Their camps are full.');
    await lockVillages(client, [donorVillageId, requesterVillageId]);
    const donorState = await loadIsland(client, donorVillageId, ctx.now);
    const requesterState = await loadIsland(client, requesterVillageId, ctx.now);
    if (donorState.balances[unit] < count) throw errors.conflict('units_unavailable', 'You don’t have those units.');
    if (requesterState.housing.used + count > requesterState.housing.capacity) {
      throw errors.conflict('recipient_housing_full', 'Their camps are full.');
    }
    const donorRaid = await client.query(
      `SELECT 1 FROM raids WHERE attacker_village_id = $1 AND state IN ('locked', 'deploying') LIMIT 1`,
      [donorVillageId]
    );
    if (donorRaid.rows.length > 0) throw errors.conflict('raid_in_progress', 'Finish your current raid first.');

    const pair = await client.query<{ nextval: string }>('SELECT nextval($1) AS nextval', ['ledger_pair_seq']);
    const pairId = Number(pair.rows[0].nextval);
    await client.query(
      `INSERT INTO ledger (pair_id, village_id, kind, asset, amount, counterparty_kind, counterparty_village_id, raid_id, created_at)
       VALUES ($1, $2, 'donation', $3, $4, 'village', $5, NULL, $6), ($1, $5, 'donation', $3, $7, 'village', $2, NULL, $6)`,
      [pairId, donorVillageId, unit, -count, requesterVillageId, ctx.now, count]
    );
    await client.query(
      'INSERT INTO donations (clan_id, request_id, donor_id, recipient_id, unit, count, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [request.clan_id, requestId, donorId, requesterId, unit, count, ctx.now]
    );
    const newGiven = Number(request.given) + count;
    await client.query('UPDATE requests SET given = $2, state = $3, closed_at = $4 WHERE id = $1', [
      requestId, newGiven, newGiven >= Number(request.count) ? 'filled' : 'open', newGiven >= Number(request.count) ? ctx.now : null,
    ]);
    return { unit, count, pairId, given: newGiven, state: newGiven >= Number(request.count) ? 'filled' : 'open', request };
  });

  return {
    status: 201,
    body: {
      request: {
        id: requestId,
        requester: { accountId: Number(outcome.request.requester_id), displayName: outcome.request.requester_name },
        unit: outcome.unit,
        count: Number(outcome.request.count),
        given: outcome.given,
        state: outcome.state,
        createdAt: new Date(Number(outcome.request.created_at)).toISOString(),
      },
      donation: { unit: outcome.unit, count: outcome.count, pairId: outcome.pairId },
    },
  };
});
