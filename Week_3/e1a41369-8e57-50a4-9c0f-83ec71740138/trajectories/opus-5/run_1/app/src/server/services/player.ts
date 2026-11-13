import type { Client } from '../db.js';
import type { LedgerKind, Notice, Player } from '../../shared/types.js';
import { MAX_HEALTH_TENTHS, experienceToLevel, faint, gainExperience } from '../domain/levels.js';
import { addDays, dayStartInstant, dayStartText } from '../time.js';

export interface UserRow {
  id: string;
  username: string;
  time_zone: string;
  day_start_hour: number;
  level: number;
  experience: number;
  health_tenths: number;
  resting: boolean;
  open_date: string;
}

const USER_COLUMNS =
  'id, username, time_zone, day_start_hour, level, experience, health_tenths, resting, open_date::text as open_date';

export async function loadUser(client: Client, userId: string): Promise<UserRow | null> {
  const found = await client.query<UserRow>(`select ${USER_COLUMNS} from users where id = $1`, [userId]);
  return found.rows[0] ?? null;
}

export async function loadUserByUsername(client: Client, username: string): Promise<UserRow | null> {
  const found = await client.query<UserRow>(`select ${USER_COLUMNS} from users where username = $1`, [username]);
  return found.rows[0] ?? null;
}

export async function loadAllUsers(client: Client): Promise<UserRow[]> {
  const found = await client.query<UserRow>(`select ${USER_COLUMNS} from users order by username`);
  return found.rows;
}

export async function goldCents(client: Client, userId: string): Promise<number> {
  const found = await client.query<{ total: string }>(
    'select coalesce(sum(amount_cents), 0)::text as total from gold_ledger where user_id = $1',
    [userId],
  );
  return Number(found.rows[0]?.total ?? '0');
}

export async function writeLedger(
  client: Client,
  userId: string,
  kind: LedgerKind,
  amountCents: number,
  taskId: string | null,
): Promise<void> {
  await client.query('insert into gold_ledger (user_id, kind, amount_cents, task_id) values ($1, $2, $3, $4)', [
    userId,
    kind,
    amountCents,
    taskId,
  ]);
}

export async function partyIdOf(client: Client, userId: string): Promise<string | null> {
  const found = await client.query<{ party_id: string }>('select party_id from party_members where user_id = $1', [
    userId,
  ]);
  return found.rows[0]?.party_id ?? null;
}

export async function loadNotices(client: Client, userId: string): Promise<Notice[]> {
  const found = await client.query<{ id: string; kind: string; level: number; gold_lost_cents: number }>(
    'select id, kind, level, gold_lost_cents from notices where user_id = $1 and acked = false order by seq',
    [userId],
  );
  return found.rows.map((row) => ({
    id: row.id,
    kind: row.kind as Notice['kind'],
    level: row.level,
    goldLost: row.gold_lost_cents / 100,
  }));
}

export function nextCloseInstant(user: UserRow): number {
  return dayStartInstant(addDays(user.open_date, 1), user.day_start_hour, user.time_zone);
}

export async function playerJson(client: Client, user: UserRow): Promise<Player> {
  const cents = await goldCents(client, user.id);
  const partyId = await partyIdOf(client, user.id);
  const notices = await loadNotices(client, user.id);
  const closeAt = nextCloseInstant(user);
  return {
    id: user.id,
    username: user.username,
    level: user.level,
    experience: user.experience,
    experienceToLevel: experienceToLevel(user.level),
    health: user.health_tenths / 10,
    maxHealth: MAX_HEALTH_TENTHS / 10,
    gold: cents / 100,
    timeZone: user.time_zone,
    dayStartHour: user.day_start_hour,
    resting: user.resting,
    today: user.open_date,
    nextCloseAt: new Date(closeAt).toISOString(),
    nextDayStart: dayStartText(closeAt, user.time_zone),
    partyId,
    notices,
  };
}

/** Adds experience, levelling up with carry-over and refilling health on every level gained. */
export async function awardExperience(client: Client, userId: string, experience: number): Promise<number> {
  const user = await loadUser(client, userId);
  if (!user) return 0;
  const { next, levelsGained } = gainExperience(
    { level: user.level, experience: user.experience, healthTenths: user.health_tenths },
    experience,
  );
  await client.query('update users set level = $2, experience = $3, health_tenths = $4 where id = $1', [
    userId,
    next.level,
    next.experience,
    next.healthTenths,
  ]);
  for (let gained = 0; gained < levelsGained; gained += 1) {
    await client.query('insert into notices (user_id, kind, level) values ($1, $2, $3)', [
      userId,
      'level_up',
      user.level + gained + 1,
    ]);
  }
  return levelsGained;
}

export async function loseHealth(client: Client, userId: string, tenths: number): Promise<void> {
  await client.query('update users set health_tenths = health_tenths - $2 where id = $1', [userId, tenths]);
}

/** A Player at or below zero health faints: a level, the experience in it and a tenth of the gold. */
export async function faintIfDown(client: Client, userId: string): Promise<boolean> {
  const user = await loadUser(client, userId);
  if (!user || user.health_tenths > 0) return false;
  const cents = await goldCents(client, userId);
  const outcome = faint({ level: user.level, experience: user.experience, healthTenths: user.health_tenths }, cents);
  await setLevelState(client, userId, outcome.level, outcome.experience, outcome.healthTenths);
  if (outcome.goldLostCents > 0) await writeLedger(client, userId, 'faint', -outcome.goldLostCents, null);
  await client.query('insert into notices (user_id, kind, level, gold_lost_cents) values ($1, $2, $3, $4)', [
    userId,
    'faint',
    outcome.level,
    outcome.goldLostCents,
  ]);
  return true;
}

export async function setLevelState(
  client: Client,
  userId: string,
  level: number,
  experience: number,
  healthTenths: number,
): Promise<void> {
  await client.query('update users set level = $2, experience = $3, health_tenths = $4 where id = $1', [
    userId,
    level,
    experience,
    healthTenths,
  ]);
}
