import bcrypt from 'bcryptjs';
import { q, q1, pool, isoDate, tenths, fromTenths, type UserRow } from './db.js';
import { fixtureByName } from '../shared/rules.js';
import { localDateOf, dayStartInstant } from './time.js';
import type { PoolClient } from 'pg';

const DEMO_PASSWORD = 'deedfall-demo';

/**
 * Seed data, applied on every start. Each piece checks for existence first
 * so runs are idempotent.
 */
export async function seed(): Promise<void> {
  const marker = await q1<{ value: string }>(`SELECT value FROM app_meta WHERE key='seeded_v1'`);
  if (marker) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const users: Record<string, UserRow> = {};
    const mkUser = async (
      username: string,
      zone: string,
      hour: number,
      level: number,
      experience: number,
      health: number,
      goldCents: number
    ) => {
      const today = localDateOf(new Date(), zone, hour);
      const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
      const r = await client.query<UserRow>(
        `INSERT INTO users (username, password_hash, level, experience, health, gold_cents, time_zone, day_start_hour, open_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (username) DO NOTHING RETURNING *`,
        [username, hash, level, experience, fromTenths(health).toFixed(1), goldCents, zone, hour, today]
      );
      if (r.rows[0]) {
        users[username] = r.rows[0];
        await client.query(
          `INSERT INTO ledger (user_id, kind, amount_cents, task_id) VALUES ($1,'task',$2,NULL)`,
          [r.rows[0].id, goldCents]
        );
      } else {
        users[username] = (await client.query<UserRow>(`SELECT * FROM users WHERE username=$1`, [username])).rows[0];
      }
    };

    await mkUser('mira', 'Europe/Lisbon', 0, 3, 20, 425, 1840);
    await mkUser('tomas', 'America/Toronto', 6, 2, 10, 500, 725);
    await mkUser('ines', 'Asia/Manila', 4, 1, 5, 380, 200);

    // Party
    const partyExists = await client.query(`SELECT id FROM parties WHERE name='Lantern Crew'`);
    let partyId: string;
    if (partyExists.rows.length === 0) {
      const p = await client.query<{ id: string }>(
        `INSERT INTO parties (name, leader_id) VALUES ('Lantern Crew', $1) RETURNING id`,
        [users.mira.id]
      );
      partyId = p.rows[0].id;
      for (const u of [users.mira, users.tomas, users.ines]) {
        await client.query(`INSERT INTO party_members (party_id, user_id) VALUES ($1,$2)`, [partyId, u.id]);
      }
    } else {
      partyId = partyExists.rows[0].id;
    }

    // Active quest with strike events
    const fx = fixtureByName('Wake the Drowsewyrm')!;
    const questExists = await client.query(`SELECT id FROM quests WHERE name='Wake the Drowsewyrm' AND state='active'`);
    if (questExists.rows.length === 0) {
      const invitedAt = new Date(Date.now() - 3600_000);
      const questIns = await client.query<{ id: string; event_seq: number }>(
        `INSERT INTO quests (party_id, name, boss, max_health, boss_health, power, reward_gold_cents, reward_experience, state, invited_at, expires_at, started_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$9) RETURNING id, event_seq`,
        [
          partyId,
          'Wake the Drowsewyrm',
          fx.boss,
          fx.maxHealth.toFixed(1),
          '212.6',
          fx.power.toFixed(1),
          Math.round(fx.rewardGold * 100),
          fx.rewardExperience,
          invitedAt,
          new Date(invitedAt.getTime() + 600_000),
        ]
      );
      const questId = questIns.rows[0].id;
      for (const u of [users.mira, users.tomas, users.ines]) {
        await client.query(`INSERT INTO quest_accepts (quest_id, username) VALUES ($1,$2)`, [questId, u.username]);
        await client.query(`INSERT INTO quest_participants (quest_id, username) VALUES ($1,$2)`, [questId, u.username]);
      }
      const strikes: [string, number][] = [
        ['mira', 100.0],
        ['tomas', 60.0],
        ['ines', 27.4],
      ];
      let hp = 400.0;
      let seq = 0;
      for (const [username, amount] of strikes) {
        seq += 1;
        hp = Math.max(0, hp - amount);
        await client.query(
          `INSERT INTO quest_events (quest_id, seq, kind, username, amount, missed, boss_health_after)
           VALUES ($1,$2,'strike',$3,$4,NULL,$5)`,
          [questId, seq, username, amount.toFixed(1), hp.toFixed(1)]
        );
      }
      await client.query(`UPDATE quests SET event_seq=$2 WHERE id=$1`, [questId, seq]);
    }

    // Chat
    const chatExists = await client.query(`SELECT 1 FROM chat_messages WHERE party_id=$1 LIMIT 1`, [partyId]);
    if (chatExists.rows.length === 0) {
      const base = Date.now() - 1800_000;
      const msgs: [string, string, number][] = [
        ['mira', 'Drowsewyrm is wobbling. One more push tonight.', base],
        ['tomas', 'Walking the dog counts, right?', base + 60_000],
      ];
      for (const [username, text, at] of msgs) {
        await client.query(
          `INSERT INTO chat_messages (party_id, username, text, created_at) VALUES ($1,$2,$3,$4)`,
          [partyId, username, text, new Date(at).toISOString()]
        );
      }
    }

    // Tasks
    type T = [string, TaskSpec];
    interface TaskSpec {
      type: 'habit' | 'daily' | 'todo' | 'reward';
      title: string;
      difficulty: string;
      value?: number;
      streak?: number;
      weekdays?: string[];
      checklist?: [string, boolean][];
      price?: number;
    }
    const specs: T[] = [
      ['mira', { type: 'habit', title: 'Drink a glass of water', difficulty: 'easy', value: 3 }],
      ['mira', { type: 'habit', title: 'Doomscroll after midnight', difficulty: 'medium', value: -4 }],
      ['mira', { type: 'daily', title: 'Stretch for ten minutes', difficulty: 'easy', value: 0, streak: 4, weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }],
      ['mira', { type: 'daily', title: 'Read one chapter', difficulty: 'medium', value: 6, streak: 12, weekdays: [...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']] }],
      ['mira', { type: 'todo', title: 'Book the dentist', difficulty: 'hard', value: 0, checklist: [['Find the number', true], ['Call before noon', false]] }],
      ['mira', { type: 'reward', title: 'Fancy coffee', difficulty: 'easy', price: 500 }],
      ['mira', { type: 'reward', title: 'Episode of a show', difficulty: 'easy', price: 1200 }],
      ['tomas', { type: 'habit', title: 'Take the stairs', difficulty: 'easy', value: 0 }],
      ['tomas', { type: 'daily', title: 'Walk the dog', difficulty: 'easy', value: 0, streak: 0, weekdays: [...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']] }],
      ['tomas', { type: 'todo', title: 'Return library books', difficulty: 'trivial', value: 0 }],
      ['tomas', { type: 'reward', title: 'New paperback', difficulty: 'easy', price: 1500 }],
      ['ines', { type: 'daily', title: 'Practice guitar', difficulty: 'medium', value: 0, streak: 2, weekdays: ['Mon', 'Wed', 'Fri'] }],
      ['ines', { type: 'reward', title: 'Bubble tea', difficulty: 'easy', price: 650 }],
    ];

    for (const [username, spec] of specs) {
      const existing = await client.query(`SELECT 1 FROM tasks WHERE owner_id=$1 AND title=$2 LIMIT 1`, [
        users[username].id,
        spec.title,
      ]);
      if (existing.rows.length > 0) continue;
      const pos = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tasks WHERE owner_id=$1 AND type=$2`,
        [users[username].id, spec.type]
      );
      const r = await client.query<{ id: string }>(
        `INSERT INTO tasks (owner_id, type, title, difficulty, value, streak, weekdays, price_cents, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          users[username].id,
          spec.type,
          spec.title,
          spec.difficulty,
          spec.value ?? 0,
          spec.streak ?? 0,
          spec.weekdays ?? null,
          spec.price ?? null,
          pos.rows[0].n + 1,
        ]
      );
      if (spec.checklist) {
        let i = 0;
        for (const [text, checked] of spec.checklist) {
          i += 1;
          await client.query(
            `INSERT INTO checklist_items (task_id, position, text, checked) VALUES ($1,$2,$3,$4)`,
            [r.rows[0].id, i, text, checked]
          );
        }
      }
    }

    await client.query(`INSERT INTO app_meta (key, value) VALUES ('seeded_v1','1') ON CONFLICT (key) DO NOTHING`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
