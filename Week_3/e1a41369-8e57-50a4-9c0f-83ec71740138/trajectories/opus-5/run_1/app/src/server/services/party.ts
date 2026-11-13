import type { Client } from '../db.js';
import type { Invite, Party, PartyMember } from '../../shared/types.js';

export interface PartyRow {
  id: string;
  name: string;
  leader_id: string;
}

export async function loadParty(client: Client, partyId: string): Promise<PartyRow | null> {
  const found = await client.query<PartyRow>('select id, name, leader_id from parties where id = $1', [partyId]);
  return found.rows[0] ?? null;
}

export async function memberIds(client: Client, partyId: string): Promise<string[]> {
  const found = await client.query<{ user_id: string }>(
    'select user_id from party_members where party_id = $1 order by joined_at, user_id',
    [partyId],
  );
  return found.rows.map((row) => row.user_id);
}

export async function isMember(client: Client, partyId: string, userId: string): Promise<boolean> {
  const found = await client.query(
    'select 1 from party_members where party_id = $1 and user_id = $2',
    [partyId, userId],
  );
  return found.rowCount === 1;
}

export async function memberCount(client: Client, partyId: string): Promise<number> {
  const found = await client.query<{ total: string }>(
    'select count(*)::text as total from party_members where party_id = $1',
    [partyId],
  );
  return Number(found.rows[0]?.total ?? '0');
}

export async function pendingInviteCount(client: Client, partyId: string): Promise<number> {
  const found = await client.query<{ total: string }>(
    'select count(*)::text as total from party_invites where party_id = $1',
    [partyId],
  );
  return Number(found.rows[0]?.total ?? '0');
}

export async function currentBannerId(client: Client, partyId: string): Promise<string | null> {
  const found = await client.query<{ id: string }>(
    'select id from banners where party_id = $1 order by created_at desc, id desc limit 1',
    [partyId],
  );
  return found.rows[0]?.id ?? null;
}

export async function currentBanner(
  client: Client,
  partyId: string,
): Promise<{ id: string; object_key: string; content_type: string } | null> {
  const found = await client.query<{ id: string; object_key: string; content_type: string }>(
    'select id, object_key, content_type from banners where party_id = $1 order by created_at desc, id desc limit 1',
    [partyId],
  );
  return found.rows[0] ?? null;
}

export function bannerUrlFor(partyId: string, uploadId: string | null): string | null {
  return uploadId ? `/api/parties/${partyId}/banner?v=${uploadId}` : null;
}

/** The party's current quest: the newest one that is still on the screen. */
export async function currentQuestId(client: Client, partyId: string): Promise<string | null> {
  const found = await client.query<{ id: string }>(
    `select id from quests where party_id = $1 and state in ('invited', 'active', 'defeated')
     order by invited_at desc, id desc limit 1`,
    [partyId],
  );
  return found.rows[0]?.id ?? null;
}

export async function liveQuestId(client: Client, partyId: string): Promise<string | null> {
  const found = await client.query<{ id: string }>(
    `select id from quests where party_id = $1 and state in ('invited', 'active') order by invited_at desc limit 1`,
    [partyId],
  );
  return found.rows[0]?.id ?? null;
}

export async function activeQuest(
  client: Client,
  partyId: string,
): Promise<{ id: string; boss: string; power_tenths: number; boss_health_tenths: number } | null> {
  const found = await client.query<{ id: string; boss: string; power_tenths: number; boss_health_tenths: number }>(
    `select id, boss, power_tenths, boss_health_tenths from quests
     where party_id = $1 and state = 'active' order by invited_at desc limit 1`,
    [partyId],
  );
  return found.rows[0] ?? null;
}

export async function partyJson(client: Client, partyId: string): Promise<Party | null> {
  const party = await loadParty(client, partyId);
  if (!party) return null;
  const members = await client.query<{ username: string; level: number; health_tenths: number; resting: boolean }>(
    `select u.username, u.level, u.health_tenths, u.resting from party_members m
     join users u on u.id = m.user_id
     join parties p on p.id = m.party_id
     where m.party_id = $1 order by (m.user_id = p.leader_id) desc, m.joined_at, u.username`,
    [partyId],
  );
  const invites = await client.query<{ username: string }>(
    `select u.username from party_invites i join users u on u.id = i.user_id
     where i.party_id = $1 order by i.created_at, u.username`,
    [partyId],
  );
  const leader = await client.query<{ username: string }>('select username from users where id = $1', [
    party.leader_id,
  ]);
  const bannerId = await currentBannerId(client, partyId);
  const questId = await currentQuestId(client, partyId);
  const memberList: PartyMember[] = members.rows.map((row) => ({
    username: row.username,
    level: row.level,
    health: row.health_tenths / 10,
    resting: row.resting,
  }));
  return {
    id: party.id,
    name: party.name,
    leader: leader.rows[0]?.username ?? '',
    members: memberList,
    pendingInvites: invites.rows.map((row) => row.username),
    bannerUrl: bannerUrlFor(party.id, bannerId),
    questId,
  };
}

export async function loadInvites(client: Client, userId: string): Promise<Invite[]> {
  const found = await client.query<{ id: string; party_id: string; party_name: string; from_username: string }>(
    `select i.id, i.party_id, p.name as party_name, u.username as from_username
     from party_invites i join parties p on p.id = i.party_id join users u on u.id = p.leader_id
     where i.user_id = $1 order by i.created_at`,
    [userId],
  );
  return found.rows.map((row) => ({
    id: row.id,
    partyId: row.party_id,
    partyName: row.party_name,
    from: row.from_username,
  }));
}
