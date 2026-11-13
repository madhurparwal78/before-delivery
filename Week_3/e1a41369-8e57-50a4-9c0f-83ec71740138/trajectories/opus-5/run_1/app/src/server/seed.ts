import type { Difficulty, TaskType, Weekday } from '../shared/types.js';
import { transaction, type Client } from './db.js';
import { questFixture } from './domain/quests.js';
import { hashPassword } from './services/auth.js';
import { localDateOf, WEEKDAYS } from './time.js';

const PASSWORD = 'deedfall-demo';

interface SeedUser {
  username: string;
  timeZone: string;
  dayStartHour: number;
  level: number;
  experience: number;
  healthTenths: number;
  goldCents: number;
}

const USERS: SeedUser[] = [
  { username: 'mira', timeZone: 'Europe/Lisbon', dayStartHour: 0, level: 3, experience: 20, healthTenths: 425, goldCents: 1840 },
  { username: 'tomas', timeZone: 'America/Toronto', dayStartHour: 6, level: 2, experience: 10, healthTenths: 500, goldCents: 725 },
  { username: 'ines', timeZone: 'Asia/Manila', dayStartHour: 4, level: 1, experience: 5, healthTenths: 380, goldCents: 200 },
];

interface SeedTask {
  owner: string;
  type: TaskType;
  title: string;
  difficulty: Difficulty | null;
  value: number | null;
  streak: number | null;
  weekdays: Weekday[] | null;
  checklist: { text: string; checked: boolean }[];
  priceCents: number | null;
}

const EVERY_DAY: Weekday[] = [...WEEKDAYS];
const WEEK: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const TASKS: SeedTask[] = [
  { owner: 'mira', type: 'habit', title: 'Drink a glass of water', difficulty: 'easy', value: 3, streak: null, weekdays: null, checklist: [], priceCents: null },
  { owner: 'mira', type: 'habit', title: 'Doomscroll after midnight', difficulty: 'medium', value: -4, streak: null, weekdays: null, checklist: [], priceCents: null },
  { owner: 'mira', type: 'daily', title: 'Stretch for ten minutes', difficulty: 'easy', value: 0, streak: 4, weekdays: WEEK, checklist: [], priceCents: null },
  { owner: 'mira', type: 'daily', title: 'Read one chapter', difficulty: 'medium', value: 6, streak: 12, weekdays: EVERY_DAY, checklist: [], priceCents: null },
  {
    owner: 'mira',
    type: 'todo',
    title: 'Book the dentist',
    difficulty: 'hard',
    value: 0,
    streak: null,
    weekdays: null,
    checklist: [
      { text: 'Find the number', checked: true },
      { text: 'Call before noon', checked: false },
    ],
    priceCents: null,
  },
  { owner: 'mira', type: 'reward', title: 'Fancy coffee', difficulty: null, value: null, streak: null, weekdays: null, checklist: [], priceCents: 500 },
  { owner: 'mira', type: 'reward', title: 'Episode of a show', difficulty: null, value: null, streak: null, weekdays: null, checklist: [], priceCents: 1200 },
  { owner: 'tomas', type: 'habit', title: 'Take the stairs', difficulty: 'easy', value: 0, streak: null, weekdays: null, checklist: [], priceCents: null },
  { owner: 'tomas', type: 'daily', title: 'Walk the dog', difficulty: 'easy', value: 0, streak: 0, weekdays: EVERY_DAY, checklist: [], priceCents: null },
  { owner: 'tomas', type: 'todo', title: 'Return library books', difficulty: 'trivial', value: 0, streak: null, weekdays: null, checklist: [], priceCents: null },
  { owner: 'tomas', type: 'reward', title: 'New paperback', difficulty: null, value: null, streak: null, weekdays: null, checklist: [], priceCents: 1500 },
  { owner: 'ines', type: 'daily', title: 'Practice guitar', difficulty: 'medium', value: 0, streak: 2, weekdays: ['Mon', 'Wed', 'Fri'], checklist: [], priceCents: null },
  { owner: 'ines', type: 'reward', title: 'Bubble tea', difficulty: null, value: null, streak: null, weekdays: null, checklist: [], priceCents: 650 },
];

const STRIKES: { username: string; amountTenths: number }[] = [
  { username: 'mira', amountTenths: 1000 },
  { username: 'tomas', amountTenths: 600 },
  { username: 'ines', amountTenths: 274 },
];

const CHAT: { username: string; text: string }[] = [
  { username: 'mira', text: 'Drowsewyrm is wobbling. One more push tonight.' },
  { username: 'tomas', text: 'Walking the dog counts, right?' },
];

/** Applies the seed if it is missing, without duplicating anything. */
export async function applySeed(): Promise<void> {
  await transaction(async (client) => {
    const existing = await client.query('select 1 from users where username = $1', ['mira']);
    if (existing.rowCount === 1) return;

    const ids = new Map<string, string>();
    for (const user of USERS) {
      const openDate = localDateOf(Date.now(), user.dayStartHour, user.timeZone);
      const created = await client.query<{ id: string }>(
        `insert into users (username, password_hash, time_zone, day_start_hour, level, experience, health_tenths,
           open_date)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (username) do nothing returning id`,
        [
          user.username,
          await hashPassword(PASSWORD),
          user.timeZone,
          user.dayStartHour,
          user.level,
          user.experience,
          user.healthTenths,
          openDate,
        ],
      );
      const id = created.rows[0]?.id;
      if (!id) continue;
      ids.set(user.username, id);
      await client.query('insert into gold_ledger (user_id, kind, amount_cents) values ($1, $2, $3)', [
        id,
        'task',
        user.goldCents,
      ]);
    }
    if (ids.size === 0) return;

    await seedTasks(client, ids);
    await seedParty(client, ids);
  });
}

async function seedTasks(client: Client, ids: Map<string, string>): Promise<void> {
  const counters = new Map<string, number>();
  for (const task of TASKS) {
    const ownerId = ids.get(task.owner);
    if (!ownerId) continue;
    const key = `${task.owner}:${task.type}`;
    const position = (counters.get(key) ?? 0) + 1;
    counters.set(key, position);
    const created = await client.query<{ id: string }>(
      `insert into tasks (user_id, type, title, difficulty, value, streak, done, weekdays, price_cents, position,
         updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, date_trunc('milliseconds', now())) returning id`,
      [
        ownerId,
        task.type,
        task.title,
        task.difficulty,
        task.value,
        task.streak,
        task.type === 'daily' || task.type === 'todo' ? false : null,
        task.weekdays,
        task.priceCents,
        position,
      ],
    );
    const taskId = created.rows[0]?.id as string;
    for (let index = 0; index < task.checklist.length; index += 1) {
      const item = task.checklist[index] as { text: string; checked: boolean };
      await client.query('insert into checklist_items (task_id, text, checked, position) values ($1, $2, $3, $4)', [
        taskId,
        item.text,
        item.checked,
        index + 1,
      ]);
    }
  }
}

async function seedParty(client: Client, ids: Map<string, string>): Promise<void> {
  const leaderId = ids.get('mira');
  if (!leaderId) return;
  const party = await client.query<{ id: string }>(
    'insert into parties (name, leader_id) values ($1, $2) returning id',
    ['Lantern Crew', leaderId],
  );
  const partyId = party.rows[0]?.id as string;
  for (const username of ['mira', 'tomas', 'ines']) {
    const memberId = ids.get(username);
    if (memberId) {
      await client.query('insert into party_members (party_id, user_id) values ($1, $2)', [partyId, memberId]);
    }
  }

  const fixture = questFixture('Wake the Drowsewyrm');
  if (!fixture) return;
  const quest = await client.query<{ id: string }>(
    `insert into quests (party_id, name, boss, max_health_tenths, boss_health_tenths, power_tenths,
       reward_gold_cents, reward_experience, state, started_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', now()) returning id`,
    [
      partyId,
      fixture.name,
      fixture.boss,
      fixture.maxHealthTenths,
      2126,
      fixture.powerTenths,
      fixture.rewardGoldCents,
      fixture.rewardExperience,
    ],
  );
  const questId = quest.rows[0]?.id as string;

  let remaining = fixture.maxHealthTenths;
  let seq = 0;
  for (const strike of STRIKES) {
    const userId = ids.get(strike.username);
    if (!userId) continue;
    seq += 1;
    remaining -= strike.amountTenths;
    await client.query(
      `insert into strike_events (quest_id, seq, kind, user_id, amount_tenths, boss_health_after_tenths)
       values ($1, $2, 'strike', $3, $4, $5)`,
      [questId, seq, userId, strike.amountTenths, remaining],
    );
  }
  for (const username of ['mira', 'tomas', 'ines']) {
    const userId = ids.get(username);
    if (!userId) continue;
    await client.query('insert into quest_participants (quest_id, user_id) values ($1, $2)', [questId, userId]);
    await client.query('insert into quest_responses (quest_id, user_id, accepted) values ($1, $2, true)', [
      questId,
      userId,
    ]);
  }
  for (const message of CHAT) {
    const userId = ids.get(message.username);
    if (!userId) continue;
    await client.query('insert into chat_messages (party_id, user_id, text) values ($1, $2, $3)', [
      partyId,
      userId,
      message.text,
    ]);
  }
}
