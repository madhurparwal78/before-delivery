import type { Difficulty, TaskType, Weekday } from '../../shared/types.js';
import { config } from '../config.js';
import { transaction, type Client } from '../db.js';
import { Router, type Ctx } from '../http/core.js';
import { VALIDATION_MESSAGES, fail, failValidation } from '../http/errors.js';
import { isDifficulty } from '../domain/rewards.js';
import { questFixture } from '../domain/quests.js';
import { hashPassword, USERNAME_PATTERN } from '../services/auth.js';
import { runDueCloses } from '../services/close.js';
import { addDays, dayStartInstant, isLocalDate, isValidTimeZone, localDateOf, WEEKDAYS } from '../time.js';

interface SetupUser {
  username: string;
  password: string;
  timeZone?: string;
  dayStartHour?: number;
  level?: number;
  experience?: number;
  health?: number;
  gold?: number;
  resting?: boolean;
  currentDate?: string;
}

interface SetupParty {
  name: string;
  leader: string;
  members?: string[];
}

interface SetupQuest {
  party: string;
  quest: string;
  bossHealth?: number;
  state: 'invited' | 'active';
  acceptedBy?: string[];
}

interface SetupTask {
  owner: string;
  type: TaskType;
  title: string;
  difficulty?: Difficulty;
  value?: number;
  streak?: number;
  done?: boolean;
  weekdays?: Weekday[];
  checklist?: { text: string; checked?: boolean }[];
  price?: number;
  position?: number;
}

function requireToken(ctx: Ctx): void {
  const token = ctx.req.headers['x-grading-token'];
  if (!config.gradingToken || token !== config.gradingToken) throw fail('not_found');
}

function asArray<Item>(value: unknown): Item[] {
  return Array.isArray(value) ? (value as Item[]) : [];
}

export function registerGradingRoutes(router: Router): void {
  router.add('POST', '/api/grading/setup', async (ctx) => {
    requireToken(ctx);
    const body = ctx.json();
    const users = asArray<SetupUser>(body.users);
    const parties = asArray<SetupParty>(body.parties);
    const quests = asArray<SetupQuest>(body.quests);
    const tasks = asArray<SetupTask>(body.tasks);
    const errors: Record<string, string> = {};

    users.forEach((user, index) => {
      if (typeof user.username !== 'string' || !USERNAME_PATTERN.test(user.username)) {
        errors[`users[${index}].username`] = VALIDATION_MESSAGES.username;
      }
      if (typeof user.password !== 'string' || user.password.length < 8) {
        errors[`users[${index}].password`] = VALIDATION_MESSAGES.password;
      }
      if (user.timeZone !== undefined && !isValidTimeZone(user.timeZone)) {
        errors[`users[${index}].timeZone`] = VALIDATION_MESSAGES.timeZone;
      }
      if (
        user.dayStartHour !== undefined &&
        (!Number.isInteger(user.dayStartHour) || user.dayStartHour < 0 || user.dayStartHour > 23)
      ) {
        errors[`users[${index}].dayStartHour`] = VALIDATION_MESSAGES.dayStartHour;
      }
      if (user.currentDate !== undefined && !isLocalDate(user.currentDate)) {
        errors[`users[${index}].currentDate`] = 'Use a date as YYYY-MM-DD.';
      }
    });
    quests.forEach((quest, index) => {
      if (typeof quest.quest !== 'string' || !questFixture(quest.quest)) {
        errors[`quests[${index}].quest`] = VALIDATION_MESSAGES.quest;
      }
    });
    tasks.forEach((task, index) => {
      if (typeof task.title !== 'string' || task.title.length < 1 || task.title.length > 80) {
        errors[`tasks[${index}].title`] = VALIDATION_MESSAGES.title;
      }
      if (task.difficulty !== undefined && !isDifficulty(task.difficulty)) {
        errors[`tasks[${index}].difficulty`] = VALIDATION_MESSAGES.difficulty;
      }
    });
    if (Object.keys(errors).length > 0) throw failValidation(errors);

    const answer = await transaction(async (client) => {
      const userIds = new Map<string, string>();
      const result = {
        users: {} as Record<string, { id: string; today: string; nextCloseAt: string }>,
        parties: {} as Record<string, string>,
        quests: {} as Record<string, string>,
        tasks: {} as Record<string, Record<string, string>>,
      };

      for (const user of users) {
        const taken = await client.query('select 1 from users where username = $1', [user.username]);
        if (taken.rowCount === 1) throw fail('username_taken');
        const timeZone = user.timeZone ?? 'UTC';
        const dayStartHour = user.dayStartHour ?? 0;
        const openDate = user.currentDate ?? localDateOf(Date.now(), dayStartHour, timeZone);
        const created = await client.query<{ id: string }>(
          `insert into users (username, password_hash, time_zone, day_start_hour, level, experience, health_tenths,
             resting, open_date)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [
            user.username,
            await hashPassword(user.password),
            timeZone,
            dayStartHour,
            user.level ?? 1,
            user.experience ?? 0,
            Math.round((user.health ?? 50) * 10),
            user.resting ?? false,
            openDate,
          ],
        );
        const id = created.rows[0]?.id as string;
        userIds.set(user.username, id);
        if ((user.gold ?? 0) !== 0) {
          await client.query('insert into gold_ledger (user_id, kind, amount_cents) values ($1, $2, $3)', [
            id,
            'task',
            Math.round((user.gold ?? 0) * 100),
          ]);
        }
        result.users[user.username] = {
          id,
          today: openDate,
          nextCloseAt: '',
        };
      }

      const idOf = async (username: string): Promise<string> => {
        const known = userIds.get(username);
        if (known) return known;
        const found = await client.query<{ id: string }>('select id from users where username = $1', [username]);
        const id = found.rows[0]?.id;
        if (!id) throw failValidation({ username: VALIDATION_MESSAGES.inviteTarget });
        return id;
      };

      const partyIds = new Map<string, string>();
      for (const party of parties) {
        const leaderId = await idOf(party.leader);
        const created = await client.query<{ id: string }>(
          'insert into parties (name, leader_id) values ($1, $2) returning id',
          [party.name, leaderId],
        );
        const partyId = created.rows[0]?.id as string;
        partyIds.set(party.name, partyId);
        result.parties[party.name] = partyId;
        await client.query('insert into party_members (party_id, user_id) values ($1, $2)', [partyId, leaderId]);
        for (const member of party.members ?? []) {
          await client.query('insert into party_members (party_id, user_id) values ($1, $2)', [
            partyId,
            await idOf(member),
          ]);
        }
      }

      for (const quest of quests) {
        const fixture = questFixture(quest.quest);
        if (!fixture) throw failValidation({ quest: VALIDATION_MESSAGES.quest });
        const partyId = partyIds.get(quest.party);
        if (!partyId) throw failValidation({ party: VALIDATION_MESSAGES.name });
        const bossHealthTenths =
          quest.bossHealth === undefined ? fixture.maxHealthTenths : Math.round(quest.bossHealth * 10);
        const created = await client.query<{ id: string }>(
          `insert into quests (party_id, name, boss, max_health_tenths, boss_health_tenths, power_tenths,
             reward_gold_cents, reward_experience, state, started_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          [
            partyId,
            fixture.name,
            fixture.boss,
            fixture.maxHealthTenths,
            bossHealthTenths,
            fixture.powerTenths,
            fixture.rewardGoldCents,
            fixture.rewardExperience,
            quest.state,
            quest.state === 'active' ? new Date().toISOString() : null,
          ],
        );
        const questId = created.rows[0]?.id as string;
        result.quests[quest.party] = questId;
        const leader = await client.query<{ leader_id: string }>('select leader_id from parties where id = $1', [
          partyId,
        ]);
        const accepted = quest.acceptedBy ?? [];
        const acceptedIds = new Set<string>([leader.rows[0]?.leader_id as string]);
        for (const username of accepted) acceptedIds.add(await idOf(username));
        for (const userId of acceptedIds) {
          await client.query('insert into quest_responses (quest_id, user_id, accepted) values ($1, $2, true)', [
            questId,
            userId,
          ]);
        }
        const members = await client.query<{ user_id: string }>(
          'select user_id from party_members where party_id = $1',
          [partyId],
        );
        for (const member of members.rows) {
          await client.query('insert into quest_participants (quest_id, user_id) values ($1, $2)', [
            questId,
            member.user_id,
          ]);
        }
      }

      for (const task of tasks) {
        const ownerId = await idOf(task.owner);
        const type = task.type;
        const position =
          task.position ??
          Number(
            (
              await client.query<{ total: string }>(
                'select count(*)::text as total from tasks where user_id = $1 and type = $2',
                [ownerId, type],
              )
            ).rows[0]?.total ?? '0',
          ) + 1;
        const created = await client.query<{ id: string }>(
          `insert into tasks (user_id, type, title, difficulty, value, streak, done, weekdays, price_cents,
             position, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, date_trunc('milliseconds', now())) returning id`,
          [
            ownerId,
            type,
            task.title,
            type === 'reward' ? null : (task.difficulty ?? 'easy'),
            type === 'reward' ? null : (task.value ?? 0),
            type === 'daily' ? (task.streak ?? 0) : null,
            type === 'daily' || type === 'todo' ? (task.done ?? false) : null,
            type === 'daily' ? (task.weekdays ?? [...WEEKDAYS]) : null,
            type === 'reward' ? Math.round((task.price ?? 0) * 100) : null,
            position,
          ],
        );
        const taskId = created.rows[0]?.id as string;
        const items = task.checklist ?? [];
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index] as { text: string; checked?: boolean };
          await client.query(
            'insert into checklist_items (task_id, text, checked, position) values ($1, $2, $3, $4)',
            [taskId, item.text, item.checked ?? false, index + 1],
          );
        }
        const byOwner = result.tasks[task.owner] ?? {};
        byOwner[task.title] = taskId;
        result.tasks[task.owner] = byOwner;
      }

      await fillCloseTimes(client, result.users);
      return result;
    });

    ctx.send(201, answer);
  });

  router.add('POST', '/api/grading/rollover', async (ctx) => {
    requireToken(ctx);
    const body = ctx.json();
    const at = typeof body.at === 'string' ? Date.parse(body.at) : Number.NaN;
    if (!Number.isFinite(at)) throw failValidation({ at: 'Use an ISO 8601 instant.' });
    ctx.send(200, { closes: await runDueCloses(at) });
  });
}

async function fillCloseTimes(
  client: Client,
  users: Record<string, { id: string; today: string; nextCloseAt: string }>,
): Promise<void> {
  for (const entry of Object.values(users)) {
    const found = await client.query<{ time_zone: string; day_start_hour: number; open_date: string }>(
      'select time_zone, day_start_hour, open_date::text as open_date from users where id = $1',
      [entry.id],
    );
    const row = found.rows[0];
    if (!row) continue;
    entry.today = row.open_date;
    entry.nextCloseAt = new Date(
      dayStartInstant(addDays(row.open_date, 1), row.day_start_hour, row.time_zone),
    ).toISOString();
  }
}
