import {
  MAX_HEALTH,
  WEEKDAYS,
  type ChatMessage,
  type ImportRecord,
  type Invite,
  type Notice,
  type Party,
  type Player,
  type Quest,
  type StrikeEvent,
  type Task,
  type TaskLists,
} from "../shared/api.js";
import { one, rows, type Db } from "./db.js";
import { closeInstant, dayStartText, weekdayOf } from "./domain/dayclock.js";
import { balanceCents } from "./domain/ledger.js";
import { experienceToLevel } from "./domain/progress.js";
import { FINISHED_STATES, expiresAt, fixtureOf, latestQuestOf } from "./domain/quests.js";
import { bandOf } from "./domain/rewards.js";
import type { ChecklistRow, EventRow, PartyRow, QuestRow, TaskRow, UserRow } from "./records.js";

const iso = (date: Date): string => date.toISOString();

export async function playerView(db: Db, user: UserRow): Promise<Player> {
  const notices = await rows<{ id: string; kind: Notice["kind"]; level: number; gold_lost_cents: number }>(
    db,
    "SELECT id, kind, level, gold_lost_cents FROM notices WHERE user_id = $1 AND NOT acknowledged ORDER BY seq",
    [user.id],
  );
  const nextClose = closeInstant(user.time_zone, user.open_date, user.day_start_hour);
  return {
    id: user.id,
    username: user.username,
    level: user.level,
    experience: user.experience,
    experienceToLevel: experienceToLevel(user.level),
    health: user.health_tenths / 10,
    maxHealth: MAX_HEALTH,
    gold: (await balanceCents(db, user.id)) / 100,
    timeZone: user.time_zone,
    dayStartHour: user.day_start_hour,
    resting: user.resting,
    today: user.open_date,
    nextCloseAt: iso(nextClose),
    nextDayStart: dayStartText(nextClose, user.time_zone),
    partyId: user.party_id,
    notices: notices.map((notice) => ({ id: notice.id, kind: notice.kind, level: notice.level, goldLost: notice.gold_lost_cents / 100 })),
  };
}

function taskView(task: TaskRow, items: ChecklistRow[], openDate: string): Task {
  const hasValue = task.value !== null;
  return {
    id: task.id,
    type: task.type,
    title: task.title,
    difficulty: task.difficulty,
    value: task.value,
    band: hasValue ? bandOf(task.value!).name : null,
    streak: task.streak,
    done: task.done,
    dueToday: task.type === "daily" ? task.weekdays!.includes(weekdayOf(openDate)) : null,
    weekdays: task.weekdays ? WEEKDAYS.filter((day) => task.weekdays!.includes(day)) : null,
    checklist: task.type === "todo" ? items.map((item) => ({ id: item.id, text: item.text, checked: item.checked })) : null,
    price: task.price_cents === null ? null : task.price_cents / 100,
    position: task.position,
    updatedAt: iso(task.updated_at),
  };
}

export async function taskById(db: Db, user: UserRow, taskId: string): Promise<Task> {
  const task = (await one<TaskRow>(db, "SELECT * FROM tasks WHERE id = $1", [taskId]))!;
  const items = await rows<ChecklistRow>(db, "SELECT * FROM checklist_items WHERE task_id = $1 ORDER BY position", [taskId]);
  return taskView(task, items, user.open_date);
}

export async function taskLists(db: Db, user: UserRow): Promise<TaskLists> {
  const tasks = await rows<TaskRow>(db, "SELECT * FROM tasks WHERE user_id = $1 ORDER BY position", [user.id]);
  const items = await rows<ChecklistRow>(
    db,
    "SELECT c.* FROM checklist_items c JOIN tasks t ON t.id = c.task_id WHERE t.user_id = $1 ORDER BY c.position",
    [user.id],
  );
  const views = tasks.map((task) =>
    taskView(task, items.filter((item) => item.task_id === task.id), user.open_date),
  );
  return {
    habits: views.filter((task) => task.type === "habit"),
    dailies: views.filter((task) => task.type === "daily"),
    todos: views.filter((task) => task.type === "todo"),
    rewards: views.filter((task) => task.type === "reward"),
  };
}

export async function eventView(db: Db, event: EventRow): Promise<StrikeEvent> {
  const user = (await one<{ username: string }>(db, "SELECT username FROM users WHERE id = $1", [event.user_id]))!;
  return eventWithName(event, user.username);
}

function eventWithName(event: EventRow, username: string): StrikeEvent {
  return {
    id: event.id,
    seq: event.seq,
    kind: event.kind,
    username,
    amount: event.amount_tenths / 10,
    missed: event.missed,
    bossHealthAfter: event.boss_health_after_tenths / 10,
    createdAt: iso(event.created_at),
  };
}

export async function questView(db: Db, quest: QuestRow): Promise<Quest> {
  const fixture = fixtureOf(quest);
  const events = await rows<EventRow & { username: string }>(
    db,
    "SELECT e.*, u.username FROM quest_events e JOIN users u ON u.id = e.user_id WHERE e.quest_id = $1 ORDER BY e.seq",
    [quest.id],
  );
  const finished = (FINISHED_STATES as readonly string[]).includes(quest.state);
  const people = finished
    ? await rows<{ username: string }>(
        db,
        "SELECT u.username FROM quest_participants p JOIN users u ON u.id = p.user_id WHERE p.quest_id = $1 ORDER BY u.username",
        [quest.id],
      )
    : await rows<{ username: string }>(db, "SELECT username FROM users WHERE party_id = $1 ORDER BY username", [quest.party_id]);
  const accepted = await rows<{ username: string }>(
    db,
    `SELECT u.username FROM quest_responses r JOIN users u ON u.id = r.user_id
     WHERE r.quest_id = $1 AND r.accepted AND ($2 OR u.party_id = $3) ORDER BY r.responded_at, u.username`,
    [quest.id, finished, quest.party_id],
  );
  const defeater = quest.defeated_by
    ? await one<{ username: string }>(db, "SELECT username FROM users WHERE id = $1", [quest.defeated_by])
    : undefined;
  return {
    id: quest.id,
    partyId: quest.party_id,
    name: quest.name,
    boss: fixture.boss,
    maxHealth: fixture.maxHealthTenths / 10,
    bossHealth: quest.boss_health_tenths / 10,
    power: fixture.powerTenths / 10,
    state: quest.state,
    invitedAt: iso(quest.invited_at),
    expiresAt: iso(expiresAt(quest)),
    acceptedBy: accepted.map((person) => person.username),
    startedAt: quest.started_at ? iso(quest.started_at) : null,
    endedAt: quest.ended_at ? iso(quest.ended_at) : null,
    defeatedBy: defeater?.username ?? null,
    members: people.map((person) => ({
      username: person.username,
      damage:
        events.filter((event) => event.kind === "strike" && event.username === person.username).reduce((sum, event) => sum + event.amount_tenths, 0) / 10,
    })),
    events: events.map((event) => eventWithName(event, event.username)),
  };
}

export async function partyView(db: Db, party: PartyRow): Promise<Party> {
  const members = await rows<UserRow>(db, "SELECT * FROM users WHERE party_id = $1 ORDER BY joined_party_at, username", [party.id]);
  const leader = members.find((member) => member.id === party.leader_id)!;
  const pending = await rows<{ username: string }>(
    db,
    "SELECT u.username FROM party_invites i JOIN users u ON u.id = i.invitee_id WHERE i.party_id = $1 ORDER BY i.created_at",
    [party.id],
  );
  const banner = await one<{ upload_id: string }>(db, "SELECT upload_id FROM party_banners WHERE party_id = $1 ORDER BY created_at DESC LIMIT 1", [party.id]);
  const quest = await latestQuestOf(db, party.id);
  return {
    id: party.id,
    name: party.name,
    leader: leader.username,
    members: members.map((member) => ({
      username: member.username,
      level: member.level,
      health: member.health_tenths / 10,
      resting: member.resting,
    })),
    pendingInvites: pending.map((invite) => invite.username),
    bannerUrl: banner ? `/api/parties/${party.id}/banner?v=${banner.upload_id}` : null,
    questId: quest && quest.state !== "abandoned" ? quest.id : null,
  };
}

export async function invitesOf(db: Db, userId: string): Promise<Invite[]> {
  const invites = await rows<{ id: string; party_id: string; name: string; inviter: string }>(
    db,
    `SELECT i.id, i.party_id, p.name, u.username AS inviter FROM party_invites i
     JOIN parties p ON p.id = i.party_id JOIN users u ON u.id = i.inviter_id
     WHERE i.invitee_id = $1 AND NOT p.deleted ORDER BY i.created_at`,
    [userId],
  );
  return invites.map((invite) => ({ id: invite.id, partyId: invite.party_id, partyName: invite.name, from: invite.inviter }));
}

export async function messageView(db: Db, messageId: string): Promise<ChatMessage> {
  const message = (await one<{ id: string; username: string; text: string; created_at: Date }>(
    db,
    "SELECT m.id, u.username, m.text, m.created_at FROM chat_messages m JOIN users u ON u.id = m.user_id WHERE m.id = $1",
    [messageId],
  ))!;
  return { id: message.id, username: message.username, text: message.text, createdAt: iso(message.created_at) };
}

export function importView(record: {
  id: string;
  filename: string;
  size: number;
  status: "imported" | "rejected";
  created_at: Date;
  task_count: number;
  error_count: number;
  lines: ImportRecord["lines"];
  errors: ImportRecord["errors"];
}): ImportRecord {
  return {
    id: record.id,
    filename: record.filename,
    size: record.size,
    status: record.status,
    createdAt: iso(record.created_at),
    taskCount: record.task_count,
    errorCount: record.error_count,
    lines: record.lines,
    errors: record.errors,
  };
}
