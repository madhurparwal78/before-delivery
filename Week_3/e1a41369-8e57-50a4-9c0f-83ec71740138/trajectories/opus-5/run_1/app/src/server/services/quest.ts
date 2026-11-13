import type { Client } from '../db.js';
import type { Quest, QuestState, StrikeEvent } from '../../shared/types.js';
import { config } from '../config.js';
import { awardExperience, writeLedger } from './player.js';
import { memberIds } from './party.js';
import { canMove } from '../domain/quests.js';

export interface QuestRow {
  id: string;
  party_id: string;
  name: string;
  boss: string;
  max_health_tenths: number;
  boss_health_tenths: number;
  power_tenths: number;
  reward_gold_cents: number;
  reward_experience: number;
  state: QuestState;
  invited_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  defeated_by: string | null;
}

const QUEST_COLUMNS =
  'id, party_id, name, boss, max_health_tenths, boss_health_tenths, power_tenths, reward_gold_cents,' +
  ' reward_experience, state, invited_at, started_at, ended_at, defeated_by';

export async function loadQuest(client: Client, questId: string): Promise<QuestRow | null> {
  const found = await client.query<QuestRow>(`select ${QUEST_COLUMNS} from quests where id = $1`, [questId]);
  return found.rows[0] ?? null;
}

export async function lockQuest(client: Client, questId: string): Promise<QuestRow | null> {
  const found = await client.query<QuestRow>(`select ${QUEST_COLUMNS} from quests where id = $1 for update`, [
    questId,
  ]);
  return found.rows[0] ?? null;
}

export async function addParticipants(client: Client, questId: string, userIds: readonly string[]): Promise<void> {
  for (const userId of userIds) {
    await client.query(
      'insert into quest_participants (quest_id, user_id) values ($1, $2) on conflict do nothing',
      [questId, userId],
    );
  }
}

export function expiresAtOf(row: QuestRow): Date {
  return new Date(row.invited_at.getTime() + config.questInviteSeconds * 1000);
}

export async function loadStrikeEvents(client: Client, questId: string): Promise<StrikeEvent[]> {
  const found = await client.query<{
    id: string;
    seq: number;
    kind: string;
    username: string;
    amount_tenths: number;
    missed: number | null;
    boss_health_after_tenths: number;
    created_at: Date;
  }>(
    `select e.id, e.seq, e.kind, u.username, e.amount_tenths, e.missed, e.boss_health_after_tenths, e.created_at
     from strike_events e join users u on u.id = e.user_id
     where e.quest_id = $1 order by e.seq`,
    [questId],
  );
  return found.rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    kind: row.kind as StrikeEvent['kind'],
    username: row.username,
    amount: row.amount_tenths / 10,
    missed: row.missed,
    bossHealthAfter: row.boss_health_after_tenths / 10,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function questJson(client: Client, questId: string): Promise<Quest | null> {
  const row = await loadQuest(client, questId);
  if (!row) return null;
  const accepted = await client.query<{ username: string }>(
    `select u.username from quest_responses r join users u on u.id = r.user_id
     where r.quest_id = $1 and r.accepted = true order by u.username`,
    [questId],
  );
  const events = await loadStrikeEvents(client, questId);
  const participants = await client.query<{ username: string }>(
    `select u.username from quest_participants p join users u on u.id = p.user_id
     where p.quest_id = $1 order by u.username`,
    [questId],
  );
  const damageByMember = new Map<string, number>();
  for (const name of participants.rows) damageByMember.set(name.username, 0);
  for (const event of events) {
    if (event.kind !== 'strike') continue;
    damageByMember.set(event.username, (damageByMember.get(event.username) ?? 0) + event.amount);
  }
  const members = [...damageByMember.entries()]
    .map(([username, damage]) => ({ username, damage: Math.round(damage * 10) / 10 }))
    .sort((left, right) => (left.username < right.username ? -1 : 1));
  return {
    id: row.id,
    partyId: row.party_id,
    name: row.name,
    boss: row.boss,
    maxHealth: row.max_health_tenths / 10,
    bossHealth: row.boss_health_tenths / 10,
    power: row.power_tenths / 10,
    state: row.state,
    invitedAt: row.invited_at.toISOString(),
    expiresAt: expiresAtOf(row).toISOString(),
    acceptedBy: accepted.rows.map((entry) => entry.username),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    defeatedBy: row.defeated_by ? await usernameOf(client, row.defeated_by) : null,
    members,
    events,
  };
}

async function usernameOf(client: Client, userId: string): Promise<string> {
  const found = await client.query<{ username: string }>('select username from users where id = $1', [userId]);
  return found.rows[0]?.username ?? '';
}

export interface StrikeOutcome {
  event: StrikeEvent;
  defeated: boolean;
}

async function nextSeq(client: Client, questId: string): Promise<number> {
  const found = await client.query<{ next: string }>(
    'select coalesce(max(seq), 0) + 1 as next from strike_events where quest_id = $1',
    [questId],
  );
  return Number(found.rows[0]?.next ?? '1');
}

async function recordEvent(
  client: Client,
  questId: string,
  kind: 'strike' | 'strikeback',
  userId: string,
  amountTenths: number,
  missed: number | null,
  bossHealthAfterTenths: number,
): Promise<StrikeEvent> {
  const seq = await nextSeq(client, questId);
  const inserted = await client.query<{ id: string; created_at: Date }>(
    `insert into strike_events (quest_id, seq, kind, user_id, amount_tenths, missed, boss_health_after_tenths)
     values ($1, $2, $3, $4, $5, $6, $7) returning id, created_at`,
    [questId, seq, kind, userId, amountTenths, missed, bossHealthAfterTenths],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('strike event not recorded');
  return {
    id: row.id,
    seq,
    kind,
    username: await usernameOf(client, userId),
    amount: amountTenths / 10,
    missed,
    bossHealthAfter: bossHealthAfterTenths / 10,
    createdAt: row.created_at.toISOString(),
  };
}

/** Applies a Player's strike to the boss. The blow that reaches 0.0 defeats the quest. */
export async function applyStrike(
  client: Client,
  questId: string,
  userId: string,
  damageTenths: number,
): Promise<StrikeOutcome | null> {
  const quest = await lockQuest(client, questId);
  if (!quest || !canMove(quest.state, 'defeated')) return null;
  const dealt = Math.min(damageTenths, quest.boss_health_tenths);
  const after = quest.boss_health_tenths - dealt;
  await client.query('update quests set boss_health_tenths = $2 where id = $1', [questId, after]);
  const event = await recordEvent(client, questId, 'strike', userId, dealt, null, after);
  if (after > 0) return { event, defeated: false };
  await client.query(
    `update quests set state = 'defeated', ended_at = now(), defeated_by = $2 where id = $1`,
    [questId, userId],
  );
  await payQuestReward(client, quest);
  return { event, defeated: true };
}

export async function recordStrikeBack(
  client: Client,
  questId: string,
  misserId: string,
  amountTenths: number,
  missed: number,
): Promise<StrikeEvent | null> {
  const quest = await lockQuest(client, questId);
  if (!quest || !canMove(quest.state, 'defeated')) return null;
  return recordEvent(client, questId, 'strikeback', misserId, amountTenths, missed, quest.boss_health_tenths);
}

export async function removeStrikeEvent(client: Client, strikeEventId: string, questId: string): Promise<void> {
  const found = await client.query<{ amount_tenths: number }>(
    'delete from strike_events where id = $1 returning amount_tenths',
    [strikeEventId],
  );
  const amount = found.rows[0]?.amount_tenths;
  if (amount === undefined) return;
  await client.query(
    'update quests set boss_health_tenths = least(max_health_tenths, boss_health_tenths + $2) where id = $1',
    [questId, amount],
  );
}

/** On defeat every current member is paid the quest reward exactly once. */
async function payQuestReward(client: Client, quest: QuestRow): Promise<void> {
  const members = await memberIds(client, quest.party_id);
  for (const memberId of members) {
    await writeLedger(client, memberId, 'quest', quest.reward_gold_cents, null);
    await awardExperience(client, memberId, quest.reward_experience);
  }
}
