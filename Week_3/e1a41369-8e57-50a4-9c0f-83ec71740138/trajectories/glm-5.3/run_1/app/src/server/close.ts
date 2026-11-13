import { q, q1, pool, tenths, fromTenths, isoDate, type UserRow, type TaskRow } from './db.js';
import {
  missedDailyHealthTenths,
  strikeBackTenths,
  applyExperience,
  faintPenalty,
} from '../shared/rules.js';
import { closeInstantFor, localDateOf, weekdayOf } from './time.js';
import { applyGains } from './actions.js';
import { live } from './live.js';
import { ApiError } from './errors.js';
import type { StrikeEvent } from '../shared/types.js';
import type { PoolClient } from 'pg';

export interface CloseResult {
  username: string;
  date: string;
  missed: number;
  healthLost: number;
  strikeBack: number;
}

/**
 * The day close, in its published order. This is the single place the close
 * steps are decided, used by both the scheduler and the grading rollover.
 */
export async function runClose(client: PoolClient, userId: string, dateISO: string, at: Date): Promise<CloseResult | null> {
  const user = (await client.query<UserRow>(`SELECT * FROM users WHERE id=$1`, [userId])).rows[0];
  if (!user) throw new ApiError('not_found');
  const today = isoDate(user.open_date);
  if (today !== dateISO) return null; // already closed

  const weekday = weekdayOf(dateISO, user.time_zone);
  const dailies = await client.query<TaskRow>(
    `SELECT * FROM tasks WHERE owner_id=$1 AND type='daily' ORDER BY position`,
    [userId]
  );

  const due = dailies.rows.filter((d) => (d.weekdays ?? []).includes(weekday));
  const missedTasks = due.filter((d) => !d.done);
  const missed = missedTasks.length;

  let healthLostTenths = 0;
  const results: CloseResult = {
    username: user.username,
    date: dateISO,
    missed,
    healthLost: 0,
    strikeBack: 0,
  };

  // Step 1: due dailies not done lose health; v falls by 2; streak resets.
  if (!user.resting) {
    for (const t of missedTasks) {
      const loss = missedDailyHealthTenths(t.difficulty, t.value);
      healthLostTenths += loss;
      await client.query(
        `UPDATE tasks SET value = GREATEST(-20, LEAST(20, value - 2)), streak = 0, updated_at=now() WHERE id=$1`,
        [t.id]
      );
    }
  }

  // Step 2: done dailies gain 1 streak.
  for (const t of due.filter((d) => d.done)) {
    await client.query(`UPDATE tasks SET streak = streak + 1, updated_at=now() WHERE id=$1`, [t.id]);
  }

  // Step 3: strike-back once when an active quest exists and N >= 1.
  let strikeBackAmount = 0;
  let strikeBackEvent: import('../shared/types.js').StrikeEvent | null = null;
  const partyId = await partyIdOfQuery(client, userId);
  let questId: string | null = null;
  if (!user.resting && missed >= 1 && partyId) {
    const quest = await client.query<{ id: string; power: string; boss: string }>(
      `SELECT id, power, boss FROM quests WHERE party_id=$1 AND state='active'`,
      [partyId]
    );
    if (quest.rows[0]) {
      const amount = strikeBackTenths(Number(quest.rows[0].power), missed);
      strikeBackAmount = amount;
      questId = quest.rows[0].id;
      const members = await client.query<{ id: string; username: string; resting: boolean }>(
        `SELECT u.id, u.username, u.resting FROM party_members m JOIN users u ON u.id=m.user_id WHERE m.party_id=$1`,
        [partyId]
      );
      const targets = members.rows.filter((m) => !m.resting);
      const amountH = fromTenths(amount);
      for (const m of targets) {
        await client.query(`UPDATE users SET health = GREATEST(-999, health - $2) WHERE id=$1`, [m.id, amountH]);
      }
      // Record one strike-back event attributed to the player who missed.
      const seqRow = await client.query<{ seq: number }>(
        `UPDATE quests SET event_seq = event_seq + 1 WHERE id=$1 RETURNING event_seq AS seq`,
        [questId]
      );
      const seq = seqRow.rows[0].seq;
      const bossHealth = (
        await client.query<{ boss_health: string }>(`SELECT boss_health FROM quests WHERE id=$1`, [questId])
      ).rows[0].boss_health;
      const ev = await client.query<{ id: string }>(
        `INSERT INTO quest_events (quest_id, seq, kind, username, amount, missed, boss_health_after)
         VALUES ($1,$2,'strikeback',$3,$4,$5,$6) RETURNING id`,
        [questId, seq, user.username, amountH, missed, bossHealth]
      );
      strikeBackEvent = {
        id: ev.rows[0].id,
        seq,
        kind: 'strikeback',
        username: user.username,
        amount: amountH,
        missed,
        bossHealthAfter: Number(bossHealth),
        createdAt: at.toISOString(),
      };
    }
  }

  // Step 4: faint checks for every member who lost health, in username order.
  const faintTargets = await client.query<{ id: string; username: string }>(
    partyId
      ? `SELECT u.id, u.username FROM party_members m JOIN users u ON u.id=m.user_id WHERE m.party_id=$1 ORDER BY u.username`
      : `SELECT id, username FROM users WHERE id=$1 ORDER BY username`,
    partyId ? [partyId] : [userId]
  );
  for (const m of faintTargets.rows) {
    const row = (await client.query<UserRow>(`SELECT * FROM users WHERE id=$1`, [m.id])).rows[0];
    const lost =
      row.id === userId
        ? healthLostTenths
        : strikeBackAmount > 0
          ? strikeBackAmount
          : 0;
    if (row.resting) continue;
    if (lost <= 0) continue;
    if (tenths(row.health) - lost <= 0) {
      await applyGains(client, row, { healthTenthsDelta: -lost });
    }
  }

  // Step 5: clear done states and move the open date forward.
  await client.query(`UPDATE tasks SET done=false, done_at=NULL, updated_at=now() WHERE owner_id=$1 AND type='daily' AND done`, [userId]);
  const nextDate = new Date(
    new Date(`${dateISO}T00:00:00Z`).getTime() + 86400_000
  )
    .toISOString()
    .slice(0, 10);
  await client.query(`UPDATE users SET open_date=$2 WHERE id=$1`, [userId, nextDate]);

  // Health loss for the closing player themselves.
  if (healthLostTenths > 0 && !user.resting) {
    const fresh = (await client.query<UserRow>(`SELECT * FROM users WHERE id=$1`, [userId])).rows[0];
    if (tenths(fresh.health) - healthLostTenths <= 0) {
      await applyGains(client, fresh, { healthTenthsDelta: -healthLostTenths });
    } else {
      await client.query(`UPDATE users SET health = health - $2 WHERE id=$1`, [userId, fromTenths(healthLostTenths)]);
    }
  }

  await client.query(
    `INSERT INTO closed_days (user_id, local_date, missed, health_lost, strike_back) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, local_date) DO NOTHING`,
    [userId, dateISO, missed, fromTenths(healthLostTenths).toFixed(1), fromTenths(strikeBackAmount).toFixed(1)]
  );

  results.healthLost = fromTenths(healthLostTenths);
  results.strikeBack = fromTenths(strikeBackAmount);
  return results;
}

async function partyIdOfQuery(client: PoolClient, userId: string): Promise<string | null> {
  const r = await client.query<{ party_id: string }>(`SELECT party_id FROM party_members WHERE user_id=$1`, [userId]);
  return r.rows[0]?.party_id ?? null;
}

/** Every close due at or before `at`, in close order, then by username. */
export async function runDueCloses(at: Date): Promise<CloseResult[]> {
  const users = await q<UserRow>(`SELECT * FROM users ORDER BY username`);
  const due: { userId: string; dateISO: string; closeAt: Date }[] = [];
  for (const u of users.rows) {
    const today = isoDate(u.open_date);
    const closeAt = closeInstantFor(today, u.time_zone, u.day_start_hour);
    if (closeAt.getTime() <= at.getTime()) {
      due.push({ userId: u.id, dateISO: today, closeAt });
    }
  }
  due.sort((a, b) => a.closeAt.getTime() - b.closeAt.getTime() || a.userId.localeCompare(b.userId));
  const results: CloseResult[] = [];
  for (const d of due) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await runClose(client, d.userId, d.dateISO, at);
      if (r) results.push(r);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return results;
}
