import { q, q1, isoDate, tenths, fromTenths, type UserRow, type TaskRow, taskFromRow, playerFromRow } from './db.js';
import { weekdayOf } from './time.js';
import { experienceToLevel } from '../shared/rules.js';
import type { Notice, Party, Player, Quest, StrikeEvent, Task, ChatMessage } from '../shared/types.js';

// Serialization of rows into public API shapes lives here so every route and
// live event emits identical data.

async function noticesFor(userId: string): Promise<Notice[]> {
  const r = await q<{ id: string; kind: string; level: number; gold_lost_cents: number | null }>(
    `SELECT id, kind, level, gold_lost_cents FROM notices WHERE user_id=$1 ORDER BY created_at`,
    [userId]
  );
  return r.rows.map((n) => ({
    id: n.id,
    kind: n.kind as 'level_up' | 'faint',
    level: n.level,
    goldLost: n.gold_lost_cents === null ? null : n.gold_lost_cents / 100,
  }));
}

export async function partyIdOf(userId: string): Promise<string | null> {
  const r = await q1<{ party_id: string }>(`SELECT party_id FROM party_members WHERE user_id=$1`, [userId]);
  return r?.party_id ?? null;
}

export async function toPlayer(user: UserRow): Promise<Player> {
  const partyId = await partyIdOf(user.id);
  const notices = await noticesFor(user.id);
  return playerFromRow(user, partyId, notices);
}

export async function serializeTaskFor(task: TaskRow, owner: UserRow): Promise<Task> {
  const checklist =
    task.type === 'todo'
      ? (
          await q<{ id: string; text: string; checked: boolean }>(
            `SELECT id, text, checked FROM checklist_items WHERE task_id=$1 ORDER BY position`,
            [task.id]
          )
        ).rows.map((x) => ({ id: x.id, text: x.text, checked: x.checked }))
      : null;
  const dueToday =
    task.type === 'daily'
      ? (task.weekdays ?? []).includes(weekdayOf(isoDate(owner.open_date), owner.time_zone))
      : null;
  return taskFromRow(task, checklist, dueToday);
}

export async function allTasksBody(
  userId: string
): Promise<{ habits: Task[]; dailies: Task[]; todos: Task[]; rewards: Task[] }> {
  const u = await q1<UserRow>(`SELECT * FROM users WHERE id=$1`, [userId]);
  const rows = await q<TaskRow>(`SELECT * FROM tasks WHERE owner_id=$1 ORDER BY type, position`, [userId]);
  const out: Record<string, Task[]> = { habit: [], daily: [], todo: [], reward: [] };
  for (const row of rows.rows) out[row.type].push(await serializeTaskFor(row, u!));
  return { habits: out.habit, dailies: out.daily, todos: out.todo, rewards: out.reward };
}

interface QuestEventRow {
  id: string;
  seq: number;
  kind: string;
  username: string;
  amount: string;
  missed: number | null;
  boss_health_after: string;
  created_at: Date;
}

export function strikeEventFromRow(row: QuestEventRow): StrikeEvent {
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind as 'strike' | 'strikeback',
    username: row.username,
    amount: Number(row.amount),
    missed: row.missed,
    bossHealthAfter: Number(row.boss_health_after),
    createdAt: row.created_at.toISOString(),
  };
}

export async function toQuest(questId: string, viewerUsername: string | null): Promise<Quest | null> {
  const r = await q1<{
    id: string;
    party_id: string;
    name: string;
    boss: string;
    max_health: string;
    boss_health: string;
    power: string;
    state: string;
    invited_at: Date;
    expires_at: Date;
    started_at: Date | null;
    ended_at: Date | null;
    defeated_by: string | null;
  }>(`SELECT * FROM quests WHERE id=$1`, [questId]);
  if (!r) return null;

  const accepts = await q<{ username: string }>(
    `SELECT username FROM quest_accepts WHERE quest_id=$1 ORDER BY accepted_at`,
    [questId]
  );
  const participants = await q<{ username: string }>(
    `SELECT username FROM quest_participants WHERE quest_id=$1`,
    [questId]
  );
  const damage = await q<{ username: string; damage: string }>(
    `SELECT username, COALESCE(SUM(CASE WHEN kind='strike' THEN amount ELSE 0 END),0)::text AS damage
     FROM quest_events WHERE quest_id=$1 AND kind='strike' GROUP BY username`,
    [questId]
  );
  const damageMap = new Map(damage.rows.map((d) => [d.username, Number(d.damage)]));
  const members = (participants.rows.length > 0 ? participants.rows : accepts.rows).map((p) => ({
    username: p.username,
    damage: damageMap.get(p.username) ?? 0,
  }));
  members.sort((a, b) => a.username.localeCompare(b.username));

  const events = await q<QuestEventRow>(
    `SELECT * FROM quest_events WHERE quest_id=$1 ORDER BY seq`,
    [questId]
  );

  return {
    id: r.id,
    partyId: r.party_id,
    name: r.name,
    boss: r.boss,
    maxHealth: Number(r.max_health),
    bossHealth: Number(r.boss_health),
    power: Number(r.power),
    state: r.state as Quest['state'],
    invitedAt: r.invited_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    acceptedBy: accepts.rows.map((a) => a.username),
    startedAt: r.started_at ? r.started_at.toISOString() : null,
    endedAt: r.ended_at ? r.ended_at.toISOString() : null,
    defeatedBy: r.defeated_by,
    members,
    events: events.rows.map(strikeEventFromRow),
  };
}

export async function toParty(partyId: string): Promise<Party | null> {
  const p = await q1<{ id: string; name: string; leader_id: string }>(
    `SELECT * FROM parties WHERE id=$1`,
    [partyId]
  );
  if (!p) return null;
  const leader = await q1<{ username: string }>(`SELECT username FROM users WHERE id=$1`, [p.leader_id]);
  const members = await q<{ username: string; level: number; health: string; resting: boolean }>(
    `SELECT u.username, u.level, u.health, u.resting FROM party_members m JOIN users u ON u.id=m.user_id WHERE m.party_id=$1 ORDER BY m.joined_at`,
    [partyId]
  );
  const invites = await q<{ username: string }>(
    `SELECT u.username FROM party_invites i JOIN users u ON u.id=i.user_id WHERE i.party_id=$1 ORDER BY i.created_at`,
    [partyId]
  );
  const quest = await q1<{ id: string }>(
    `SELECT id FROM quests WHERE party_id=$1 AND state IN ('invited','active','defeated') ORDER BY invited_at DESC`,
    [partyId]
  );
  const banner = await q1<{ id: string; content_type: string }>(
    `SELECT id, content_type FROM banner_uploads WHERE party_id=$1 ORDER BY created_at DESC`,
    [partyId]
  );
  const ext = banner?.content_type === 'image/jpeg' ? 'jpg' : 'png';
  return {
    id: p.id,
    name: p.name,
    leader: leader?.username ?? '',
    members: members.rows.map((m) => ({
      username: m.username,
      level: m.level,
      health: Number(m.health),
      resting: m.resting,
    })),
    pendingInvites: invites.rows.map((i) => i.username),
    bannerUrl: banner ? `/api/parties/${partyId}/banner?v=${banner.id}` : null,
    questId: quest?.id ?? null,
  };
}

export async function chatMessageFromRow(row: {
  id: string;
  username: string;
  text: string;
  created_at: Date;
}): Promise<ChatMessage> {
  return { id: row.id, username: row.username, text: row.text, createdAt: row.created_at.toISOString() };
}
