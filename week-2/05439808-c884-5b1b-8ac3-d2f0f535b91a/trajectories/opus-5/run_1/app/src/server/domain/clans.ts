import type { Queryable } from '../db.js';
import { fail } from '../http/errors.js';
import type { ClanRole } from '../../shared/types.js';

export const MAX_CLAN_MEMBERS = 10;
export const MAX_MATES = 4;

export type Membership = {
  clanId: number;
  accountId: number;
  role: ClanRole;
  joinedAt: Date;
  mateSince: Date | null;
};

export type Clan = { id: number; name: string; motto: string };

export type MemberView = {
  accountId: number;
  displayName: string;
  villageId: number | null;
  role: ClanRole;
  trophies: number;
  donated: number;
  received: number;
  joinedAt: string;
  mateSince: string | null;
};

export function isWarden(role: ClanRole): boolean {
  return role === 'skipper' || role === 'mate';
}

export async function membershipOf(
  client: Queryable,
  accountId: number
): Promise<Membership | null> {
  const { rows } = await client.query<{
    clan_id: number;
    account_id: number;
    role: string;
    joined_at: Date;
    mate_since: Date | null;
  }>(
    'SELECT clan_id, account_id, role, joined_at, mate_since FROM clan_members WHERE account_id = $1',
    [accountId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    clanId: Number(row.clan_id),
    accountId: Number(row.account_id),
    role: row.role as ClanRole,
    joinedAt: row.joined_at,
    mateSince: row.mate_since
  };
}

export async function clanById(client: Queryable, clanId: number): Promise<Clan | null> {
  const { rows } = await client.query<{ id: number; name: string; motto: string }>(
    'SELECT id, name, motto FROM clans WHERE id = $1',
    [clanId]
  );
  const row = rows[0];
  return row ? { id: Number(row.id), name: row.name, motto: row.motto } : null;
}

export async function membersOf(client: Queryable, clanId: number): Promise<MemberView[]> {
  const { rows } = await client.query<{
    account_id: number;
    display_name: string;
    village_id: number | null;
    role: string;
    trophies: number;
    joined_at: Date;
    mate_since: Date | null;
    donated: number;
    received: number;
  }>(
    `SELECT cm.account_id, a.display_name, v.id AS village_id, cm.role, a.trophies,
            cm.joined_at, cm.mate_since,
            COALESCE((
              SELECT SUM(d.count) FROM donations d
               WHERE d.donor_account_id = cm.account_id AND d.clan_id = cm.clan_id
                 AND d.created_at >= cm.joined_at
            ), 0)::int AS donated,
            COALESCE((
              SELECT SUM(d.count) FROM donations d
               WHERE d.recipient_account_id = cm.account_id AND d.clan_id = cm.clan_id
                 AND d.created_at >= cm.joined_at
            ), 0)::int AS received
       FROM clan_members cm
       JOIN accounts a ON a.id = cm.account_id
       LEFT JOIN villages v ON v.account_id = cm.account_id
      WHERE cm.clan_id = $1
      ORDER BY cm.joined_at, cm.account_id`,
    [clanId]
  );
  return rows.map((row) => ({
    accountId: Number(row.account_id),
    displayName: row.display_name,
    villageId: row.village_id === null ? null : Number(row.village_id),
    role: row.role as ClanRole,
    trophies: row.trophies,
    donated: Number(row.donated),
    received: Number(row.received),
    joinedAt: row.joined_at.toISOString(),
    mateSince: row.mate_since === null ? null : row.mate_since.toISOString()
  }));
}

export async function clanStandings(
  client: Queryable,
  limit: number
): Promise<{ rank: number; id: number; name: string; trophies: number; memberCount: number }[]> {
  const { rows } = await client.query<{
    id: number;
    name: string;
    trophies: number;
    members: number;
  }>(
    `SELECT c.id, c.name,
            COALESCE(SUM(a.trophies), 0)::int AS trophies,
            COUNT(cm.account_id)::int AS members
       FROM clans c
       LEFT JOIN clan_members cm ON cm.clan_id = c.id
       LEFT JOIN accounts a ON a.id = cm.account_id
      GROUP BY c.id, c.name
      ORDER BY trophies DESC, c.name ASC
      LIMIT $1`,
    [limit]
  );
  return rows.map((row, index) => ({
    rank: index + 1,
    id: Number(row.id),
    name: row.name,
    trophies: Number(row.trophies),
    memberCount: Number(row.members)
  }));
}

export async function rankOf(client: Queryable, clanId: number): Promise<number> {
  const { rows } = await client.query<{ rank: number }>(
    `WITH totals AS (
       SELECT c.id, c.name, COALESCE(SUM(a.trophies), 0)::int AS trophies
         FROM clans c
         LEFT JOIN clan_members cm ON cm.clan_id = c.id
         LEFT JOIN accounts a ON a.id = cm.account_id
        GROUP BY c.id, c.name
     )
     , ranked AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY trophies DESC, name ASC)::int AS rank FROM totals
     )
     SELECT rank FROM ranked WHERE id = $1`,
    [clanId]
  );
  return Number(rows[0]?.rank ?? 1);
}

export async function clanTrophies(client: Queryable, clanId: number): Promise<number> {
  const { rows } = await client.query<{ trophies: number }>(
    `SELECT COALESCE(SUM(a.trophies), 0)::int AS trophies
       FROM clan_members cm JOIN accounts a ON a.id = cm.account_id
      WHERE cm.clan_id = $1`,
    [clanId]
  );
  return Number(rows[0]?.trophies ?? 0);
}

export function checkRemoval(caller: Membership, target: Membership): void {
  if (target.role === 'skipper') {
    if (caller.role === 'skipper') fail('invalid_role_change');
    fail('forbidden');
  }
  if (target.role === 'mate' && caller.role !== 'skipper') fail('forbidden');
  if (!isWarden(caller.role)) fail('forbidden');
  if (caller.accountId === target.accountId) fail('invalid_role_change');
}

export function checkPromotion(caller: Membership, target: Membership, mates: number): void {
  if (caller.role !== 'skipper') fail('forbidden');
  if (target.role === 'skipper') fail('invalid_role_change');
  if (caller.accountId === target.accountId) fail('invalid_role_change');
  if (target.role === 'deckhand' && mates >= MAX_MATES) fail('invalid_role_change');
}

export function checkDemotion(caller: Membership, target: Membership): void {
  if (caller.role !== 'skipper') fail('forbidden');
  if (target.role !== 'mate') fail('invalid_role_change');
  if (caller.accountId === target.accountId) fail('invalid_role_change');
}

export async function mateCount(client: Queryable, clanId: number): Promise<number> {
  const { rows } = await client.query<{ mates: number }>(
    "SELECT COUNT(*)::int AS mates FROM clan_members WHERE clan_id = $1 AND role = 'mate'",
    [clanId]
  );
  return Number(rows[0]?.mates ?? 0);
}

export async function memberCount(client: Queryable, clanId: number): Promise<number> {
  const { rows } = await client.query<{ members: number }>(
    'SELECT COUNT(*)::int AS members FROM clan_members WHERE clan_id = $1',
    [clanId]
  );
  return Number(rows[0]?.members ?? 0);
}

async function closeOpenRequestOf(
  client: Queryable,
  clanId: number,
  accountId: number
): Promise<void> {
  await client.query(
    `UPDATE unit_requests SET state = 'closed'
      WHERE clan_id = $1 AND requester_account_id = $2 AND state = 'open'`,
    [clanId, accountId]
  );
}

export async function removeMembership(
  client: Queryable,
  clanId: number,
  accountId: number
): Promise<void> {
  await closeOpenRequestOf(client, clanId, accountId);
  await client.query('DELETE FROM clan_members WHERE clan_id = $1 AND account_id = $2', [
    clanId,
    accountId
  ]);
}

export async function dissolveClan(client: Queryable, clanId: number): Promise<void> {
  await client.query('DELETE FROM donations WHERE clan_id = $1', [clanId]);
  await client.query('DELETE FROM unit_requests WHERE clan_id = $1', [clanId]);
  await client.query('DELETE FROM clan_messages WHERE clan_id = $1', [clanId]);
  await client.query('DELETE FROM clan_invitations WHERE clan_id = $1', [clanId]);
  await client.query('DELETE FROM clans WHERE id = $1', [clanId]);
}

export async function succeedSkipper(
  client: Queryable,
  clanId: number
): Promise<{ accountId: number; displayName: string } | null> {
  const { rows } = await client.query<{ account_id: number; display_name: string; role: string }>(
    `SELECT cm.account_id, a.display_name, cm.role
       FROM clan_members cm JOIN accounts a ON a.id = cm.account_id
      WHERE cm.clan_id = $1
      ORDER BY (cm.role <> 'mate'), cm.mate_since NULLS LAST, cm.joined_at, cm.account_id
      LIMIT 1`,
    [clanId]
  );
  const row = rows[0];
  if (!row) return null;
  await client.query(
    "UPDATE clan_members SET role = 'skipper', mate_since = NULL WHERE clan_id = $1 AND account_id = $2",
    [clanId, Number(row.account_id)]
  );
  return { accountId: Number(row.account_id), displayName: row.display_name };
}

export async function pendingInvitationsFor(
  client: Queryable,
  emailLower: string
): Promise<{ id: number; clanId: number; clanName: string; inviterName: string }[]> {
  const { rows } = await client.query<{
    id: number;
    clan_id: number;
    clan_name: string;
    inviter_name: string;
  }>(
    `SELECT i.id, i.clan_id, c.name AS clan_name, a.display_name AS inviter_name
       FROM clan_invitations i
       JOIN clans c ON c.id = i.clan_id
       JOIN accounts a ON a.id = i.invited_by
       JOIN clan_members cm ON cm.clan_id = i.clan_id AND cm.account_id = i.invited_by
      WHERE i.email_lower = $1 AND i.state = 'pending' AND cm.role IN ('skipper', 'mate')
      ORDER BY i.id`,
    [emailLower]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    clanId: Number(row.clan_id),
    clanName: row.clan_name,
    inviterName: row.inviter_name
  }));
}

export async function loadPendingInvitation(
  client: Queryable,
  invitationId: number,
  emailLower: string
): Promise<{ id: number; clanId: number } | null> {
  const { rows } = await client.query<{ id: number; clan_id: number }>(
    `SELECT i.id, i.clan_id
       FROM clan_invitations i
       JOIN clan_members cm ON cm.clan_id = i.clan_id AND cm.account_id = i.invited_by
      WHERE i.id = $1 AND i.email_lower = $2 AND i.state = 'pending'
        AND cm.role IN ('skipper', 'mate')`,
    [invitationId, emailLower]
  );
  const row = rows[0];
  return row ? { id: Number(row.id), clanId: Number(row.clan_id) } : null;
}
