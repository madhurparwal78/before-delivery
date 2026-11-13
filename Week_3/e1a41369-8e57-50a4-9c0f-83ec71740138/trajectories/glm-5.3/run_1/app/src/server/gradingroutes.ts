import express from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import {
  config, q, q1, pool, live, toPlayer, toParty, toQuest, partyIdOf, emitTasksLive,
  isZoneValid, localDateOf, type UserRow,
} from './kernel.js';
import { fixtureByName, WEEKDAYS, type Weekday, type Difficulty } from '../shared/rules.js';
import { ApiError } from './errors.js';
import { runClose } from './close.js';

interface SetupBody {
  users?: {
    username: string;
    password?: string;
    timeZone?: string;
    dayStartHour?: number;
    level?: number;
    experience?: number;
    health?: number;
    gold?: number;
    resting?: boolean;
    currentDate?: string;
  }[];
  parties?: { name: string; leader: string; members?: string[] }[];
  quests?: { party: string; quest: string; bossHealth?: number; state?: 'invited' | 'active'; acceptedBy?: string[] }[];
  tasks?: {
    owner: string;
    type: 'habit' | 'daily' | 'todo' | 'reward';
    title: string;
    difficulty?: string;
    value?: number;
    streak?: number;
    done?: boolean;
    weekdays?: string[];
    checklist?: { text: string; checked?: boolean }[];
    price?: number;
    position?: number;
  }[];
}

/**
 * The grading setup: creates everything in one transaction or nothing at all.
 */
export function registerGradingRoutes(app: express.Express): void {
  const guard = (req: Request, res: express.Response): boolean => {
    const token = req.header('X-Grading-Token');
    if (!config.gradingToken || token !== config.gradingToken) {
      res.status(404).json({ error: 'not_found' });
      return false;
    }
    return true;
  };

  app.post('/api/grading/setup', async (req, res, next) => {
    if (!guard(req, res)) return;
    try {
      const body = (req.body ?? {}) as SetupBody;
      const errors: Record<string, string> = {};
      const usernames = new Set<string>();
      for (const [i, u] of (body.users ?? []).entries()) {
        if (!u.username || !/^[a-z0-9_]{3,20}$/.test(u.username)) {
          errors[`users[${i}].username`] = 'Use 3 to 20 lowercase letters, digits or _.';
        } else if (usernames.has(u.username)) {
          errors[`users[${i}].username`] = 'taken';
        }
        usernames.add(u.username);
        if (u.timeZone !== undefined && !isZoneValid(u.timeZone)) {
          errors[`users[${i}].timeZone`] = 'Unknown time zone.';
        }
        if (u.dayStartHour !== undefined && (!Number.isInteger(u.dayStartHour) || u.dayStartHour < 0 || u.dayStartHour > 23)) {
          errors[`users[${i}].dayStartHour`] = 'Day start hour must be a whole number from 0 to 23.';
        }
        if (u.currentDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(u.currentDate)) {
          errors[`users[${i}].currentDate`] = 'Bad date.';
        }
        const existing = await q1(`SELECT id FROM users WHERE username=$1`, [u.username]);
        if (existing) errors[`users[${i}].username`] = 'username_taken';
      }
      if (Object.keys(errors).length > 0) {
        res.status(422).json({ errors });
        return;
      }

      const client = await pool.connect();
      const userMap = new Map<string, string>();
      const partyMap = new Map<string, string>();
      const questMap = new Map<string, string>();
      const taskMap = new Map<string, Map<string, string>>();
      try {
        await client.query('BEGIN');
        for (const u of body.users ?? []) {
          const zone = u.timeZone ?? 'UTC';
          const hour = u.dayStartHour ?? 0;
          const today = u.currentDate ?? localDateOf(new Date(), zone, hour);
          const hash = await bcrypt.hash(u.password ?? 'grading-password', 10);
          const r = await client.query<{ id: string }>(
            `INSERT INTO users (username, password_hash, level, experience, health, gold_cents, time_zone, day_start_hour, resting, open_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [
              u.username,
              hash,
              u.level ?? 1,
              u.experience ?? 0,
              (u.health ?? 50).toFixed(1),
              Math.round((u.gold ?? 0) * 100),
              zone,
              hour,
              u.resting ?? false,
              today,
            ]
          );
          userMap.set(u.username, r.rows[0].id);
          const cents = Math.round((u.gold ?? 0) * 100);
          if (cents !== 0) {
            await client.query(
              `INSERT INTO ledger (user_id, kind, amount_cents, task_id) VALUES ($1,'task',$2,NULL)`,
              [r.rows[0].id, cents]
            );
          }
        }
        for (const p of body.parties ?? []) {
          const leaderId = userMap.get(p.leader);
          if (!leaderId) continue;
          const r = await client.query<{ id: string }>(
            `INSERT INTO parties (name, leader_id) VALUES ($1,$2) RETURNING id`,
            [p.name, leaderId]
          );
          partyMap.set(p.name, r.rows[0].id);
          await client.query(`INSERT INTO party_members (party_id, user_id) VALUES ($1,$2)`, [
            r.rows[0].id,
            leaderId,
          ]);
          for (const m of p.members ?? []) {
            const mid = userMap.get(m);
            if (mid) {
              await client.query(`INSERT INTO party_members (party_id, user_id) VALUES ($1,$2)`, [
                r.rows[0].id,
                mid,
              ]);
            }
          }
        }
        for (const qs of body.quests ?? []) {
          const partyId = partyMap.get(qs.party);
          if (!partyId) continue;
          const fx = fixtureByName(qs.quest);
          if (!fx) continue;
          const state = qs.state ?? 'invited';
          const now = new Date();
          const r = await client.query<{ id: string }>(
            `INSERT INTO quests (party_id, name, boss, max_health, boss_health, power, reward_gold_cents, reward_experience, state, invited_at, expires_at, started_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [
              partyId,
              fx.name,
              fx.boss,
              fx.maxHealth.toFixed(1),
              (qs.bossHealth ?? fx.maxHealth).toFixed(1),
              fx.power.toFixed(1),
              Math.round(fx.rewardGold * 100),
              fx.rewardExperience,
              state,
              now.toISOString(),
              new Date(now.getTime() + config.questInviteSeconds * 1000).toISOString(),
              state === 'active' ? now.toISOString() : null,
            ]
          );
          questMap.set(qs.party, r.rows[0].id);
          const leader = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id=$1`, [
            (await client.query<{ leader_id: string }>(`SELECT leader_id FROM parties WHERE id=$1`, [partyId]))
              .rows[0].leader_id,
          ])).rows[0].username;
          const accepted = new Set<string>([leader, ...(qs.acceptedBy ?? [])]);
          for (const a of accepted) {
            await client.query(`INSERT INTO quest_accepts (quest_id, username) VALUES ($1,$2)`, [r.rows[0].id, a]);
          }
          if (state === 'active') {
            const members = await client.query<{ username: string }>(
              `SELECT u.username FROM party_members m JOIN users u ON u.id=m.user_id WHERE m.party_id=$1`,
              [partyId]
            );
            for (const m of members.rows) {
              await client.query(
                `INSERT INTO quest_participants (quest_id, username) VALUES ($1,$2) ON CONFLICT (quest_id, username) DO NOTHING`,
                [r.rows[0].id, m.username]
              );
            }
          }
        }
        for (const t of body.tasks ?? []) {
          const ownerId = userMap.get(t.owner);
          if (!ownerId) continue;
          if (!taskMap.has(t.owner)) taskMap.set(t.owner, new Map());
          const pos =
            t.position ??
            (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE owner_id=$1 AND type=$2`, [
              ownerId,
              t.type,
            ])).rows[0].n + 1;
          const r = await client.query<{ id: string }>(
            `INSERT INTO tasks (owner_id, type, title, difficulty, value, streak, done, weekdays, price_cents, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [
              ownerId,
              t.type,
              t.title,
              t.difficulty ?? 'easy',
              t.value ?? 0,
              t.streak ?? 0,
              t.done ?? false,
              t.weekdays ?? null,
              t.price !== undefined ? Math.round(t.price * 100) : null,
              pos,
            ]
          );
          taskMap.get(t.owner)!.set(t.title, r.rows[0].id);
          for (const [i, item] of (t.checklist ?? []).entries()) {
            await client.query(
              `INSERT INTO checklist_items (task_id, position, text, checked) VALUES ($1,$2,$3,$4)`,
              [r.rows[0].id, i + 1, item.text, item.checked ?? false]
            );
          }
        }
        await client.query('COMMIT');

        const users: Record<string, { id: string; today: string; nextCloseAt: string }> = {};
        for (const [username, id] of userMap) {
          const u = await q1<UserRow>(`SELECT * FROM users WHERE id=$1`, [id]);
          const player = await toPlayer(u!);
          users[username] = { id, today: player.today, nextCloseAt: player.nextCloseAt };
        }
        const parties: Record<string, string> = {};
        for (const [name, id] of partyMap) parties[name] = id;
        const quests: Record<string, string> = {};
        for (const [partyName, id] of questMap) quests[partyName] = id;
        const tasks: Record<string, Record<string, string>> = {};
        for (const [username, map] of taskMap) {
          tasks[username] = Object.fromEntries(map);
        }
        res.status(201).json({ users, parties, quests, tasks });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/grading/rollover', async (req, res, next) => {
    if (!guard(req, res)) return;
    try {
      const atStr = String((req.body as Record<string, unknown>).at ?? '');
      const at = new Date(atStr);
      if (Number.isNaN(at.getTime())) {
        res.status(422).json({ errors: { at: 'Bad instant.' } });
        return;
      }
      const { runDueCloses } = await import('./close.js');
      const closes = await runDueCloses(at);
      res.json({ closes });
    } catch (err) {
      next(err);
    }
  });
}
