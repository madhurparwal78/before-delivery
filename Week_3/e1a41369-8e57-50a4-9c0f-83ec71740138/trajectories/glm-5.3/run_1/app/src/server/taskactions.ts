import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import {
  bandOf,
  damageTenthsFor,
  goldCentsFor,
  habitDownHealthTenths,
  experienceFor,
} from '../shared/rules.js';
import type { ActionResult, StrikeEvent } from '../shared/types.js';
import { pool, q1, tenths, fromTenths, type UserRow, type TaskRow } from './db.js';
import { applyGains } from './actions.js';
import { ApiError } from './errors.js';
import { serializeTaskFor, toPlayer } from './serialize.js';

async function loadChecklist(client: PoolClient, taskId: string): Promise<{ checked: boolean }[]> {
  const r = await client.query<{ checked: boolean }>(
    `SELECT checked FROM checklist_items WHERE task_id=$1 ORDER BY position`,
    [taskId]
  );
  return r.rows;
}

function clampValue(v: number): number {
  return Math.max(-20, Math.min(20, v));
}

export interface ActionOutcome {
  result: ActionResult;
  questEnded?: boolean;
  questRewardGold?: number;
  questRewardExperience?: number;
  bossDefeated?: boolean;
}

/**
 * Runs an action inside one transaction, serializing the result after the
 * commit so notices and fresh rows are visible in the response payload.
 */
export async function runActionInTransaction(
  req: Request,
  fn: (client: PoolClient, user: UserRow, task: TaskRow) => Promise<ActionOutcome | null>
): Promise<ActionOutcome | null> {
  const client = await pool.connect();
  let outcome: ActionOutcome | null = null;
  let notFound = false;
  try {
    await client.query('BEGIN');
    const taskRow = (
      await client.query<TaskRow>(`SELECT * FROM tasks WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [
        String(req.params.id),
        req.user!.id,
      ])
    ).rows[0];
    if (!taskRow) {
      notFound = true;
      await client.query('COMMIT');
    } else {
      const user = (
        await client.query<UserRow>(`SELECT * FROM users WHERE id=$1 FOR UPDATE`, [req.user!.id])
      ).rows[0];
      outcome = await fn(client, user, taskRow);
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  if (notFound) throw new ApiError('not_found');
  if (!outcome) return null;
  // Serialize after the commit so notices created by the action are visible.
  const freshUser = await q1<UserRow>(`SELECT * FROM users WHERE id=$1`, [req.user!.id]);
  const freshTask = await q1<TaskRow>(`SELECT * FROM tasks WHERE id=$1`, [outcome.result.task.id]);
  return {
    ...outcome,
    result: {
      ...outcome.result,
      task: freshTask ? await serializeTaskFor(freshTask, freshUser!) : outcome.result.task,
      player: freshUser ? await toPlayer(freshUser) : outcome.result.player,
    },
  };
}

// ---------------------------------------------------------------------------
// actions

/** Score a habit up or down; the single place habit scoring is decided. */
export async function scoreHabit(
  client: PoolClient,
  user: UserRow,
  task: TaskRow,
  direction: 'up' | 'down'
): Promise<ActionOutcome> {
  const { factor } = bandOf(task.value);
  let delta = { experience: 0, gold: 0, health: 0, damage: 0 };
  let strike: StrikeEvent | null = null;
  let questEnded = false;
  let leveled = false;
  let fainted = false;

  if (direction === 'up') {
    const xp = experienceFor({ difficulty: task.difficulty, value: task.value, checked: 0, total: 0 });
    const gold = goldCentsFor(xp);
    const damageT = damageTenthsFor(xp);
    delta = { experience: xp, gold: gold / 100, health: 0, damage: fromTenths(damageT) };
    const gains = await applyGains(client, user, {
      experience: xp,
      ledger: { kind: 'task', amountCents: gold, taskId: task.id },
    });
    leveled = gains.leveled;
    fainted = gains.fainted;
    const newValue = clampValue(task.value + 1);
    await client.query(`UPDATE tasks SET value=$2, updated_at=now() WHERE id=$1`, [task.id, newValue]);
    strike = await recordStrike(client, user, task, damageT);
    if (strike) questEnded = await maybeDefeat(client, user.username, strike);
  } else {
    const lossT = habitDownHealthTenths(task.difficulty, task.value);
    delta = { experience: 0, gold: 0, health: -fromTenths(lossT), damage: 0 };
    const gains = await applyGains(client, user, { healthTenthsDelta: -lossT });
    fainted = gains.fainted;
    const newValue = clampValue(task.value - 1);
    await client.query(`UPDATE tasks SET value=$2, updated_at=now() WHERE id=$1`, [task.id, newValue]);
  }

  const freshTask = (await client.query<TaskRow>(`SELECT * FROM tasks WHERE id=$1`, [task.id])).rows[0];
  const freshUser = (await client.query<UserRow>(`SELECT * FROM users WHERE id=$1`, [user.id])).rows[0];
  return {
    result: {
      task: await serializeTaskFor(freshTask, freshUser),
      player: await toPlayer(freshUser),
      delta,
      strike,
      levelUp: leveled,
      fainted,
    },
    questEnded,
    bossDefeated: questEnded,
  };
}

/** Complete a daily or to-do; refuses a done task as already_done. */
export async function completeTask(
  client: PoolClient,
  user: UserRow,
  task: TaskRow
): Promise<ActionOutcome | null> {
  if (task.done) throw new ApiError('already_done');
  if (task.type !== 'daily' && task.type !== 'todo') {
    throw new ApiError('validation');
  }

  const checklist = await loadChecklist(client, task.id);
  const checked = checklist.filter((c) => c.checked).length;
  const total = checklist.length;
  const xp = experienceFor({
    difficulty: task.difficulty,
    value: task.value,
    checked,
    total,
  });
  const gold = goldCentsFor(xp);
  const damageT = damageTenthsFor(xp);

  const gains = await applyGains(client, user, {
    experience: xp,
    ledger: { kind: 'task', amountCents: gold, taskId: task.id },
  });

  const newValue = clampValue(task.value + 1);
  const now = new Date();
  await client.query(`UPDATE tasks SET done=true, done_at=$2, value=$3, updated_at=now() WHERE id=$1`, [
    task.id,
    now.toISOString(),
    newValue,
  ]);

  const party = (
    await client.query<{ party_id: string }>(`SELECT party_id FROM party_members WHERE user_id=$1`, [user.id])
  ).rows[0];
  let questIdForUndo: string | null = null;
  let strike = null as StrikeEvent | null;
  let questEnded = false;
  if (party) {
    const quest = (
      await client.query<{ id: string }>(
        `SELECT id FROM quests WHERE party_id=$1 AND state='active' FOR UPDATE`,
        [party.party_id]
      )
    ).rows[0];
    if (quest) {
      questIdForUndo = quest.id;
      strike = await recordStrike(client, user, task, damageT);
      if (strike) questEnded = await maybeDefeat(client, user.username, strike);
    }
  }

  // Undo record: enough to revert exactly what the tick gave.
  await client.query(
    `INSERT INTO undo_records (task_id, user_id, experience, gold_cents, damage, quest_id, event_id, old_level, old_experience, old_health)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      task.id,
      user.id,
      xp,
      gold,
      fromTenths(damageT).toFixed(1),
      questIdForUndo,
      strike?.id ?? null,
      user.level,
      user.experience,
      fromTenths(tenths(user.health)).toFixed(1),
    ]
  );

  const freshTask = (await client.query<TaskRow>(`SELECT * FROM tasks WHERE id=$1`, [task.id])).rows[0];
  const freshUser = (await client.query<UserRow>(`SELECT * FROM users WHERE id=$1`, [user.id])).rows[0];
  return {
    result: {
      task: await serializeTaskFor(freshTask, freshUser),
      player: await toPlayer(freshUser),
      delta: { experience: xp, gold: gold / 100, health: 0, damage: fromTenths(damageT) },
      strike,
      levelUp: gains.leveled,
      fainted: gains.fainted,
    },
    questEnded,
    bossDefeated: questEnded,
  };
}

/** Undo a tick inside the window, or just clear done after it. */
export async function uncompleteTask(
  client: PoolClient,
  user: UserRow,
  task: TaskRow,
  undoWindowSeconds: number
): Promise<ActionOutcome> {
  if (!task.done || !task.done_at) throw new ApiError('not_done');

  const undo = (
    await client.query<{
      id: string;
      experience: number;
      gold_cents: number;
      damage: string;
      quest_id: string | null;
      event_id: string | null;
      old_level: number;
      old_experience: number;
      old_health: string;
      created_at: Date;
    }>(`SELECT * FROM undo_records WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1`, [task.id])
  ).rows[0];

  const tickAge = Date.now() - new Date(task.done_at).getTime();
  const isUndo = undo && tickAge < undoWindowSeconds * 1000;

  let delta = { experience: 0, gold: 0, health: 0, damage: 0 };

  if (isUndo && undo) {
    const restored = await restoreExperience(client, user, undo);
    void restored;
    delta = { ...delta, experience: -undo.experience, gold: -undo.gold_cents / 100 };

    // Value back down one.
    const newValue = clampValue(task.value - 1);
    await client.query(`UPDATE tasks SET value=$2, updated_at=now() WHERE id=$1`, [task.id, newValue]);

    // Undo ledger entry, and the balance follows it.
    await client.query(
      `INSERT INTO ledger (user_id, kind, amount_cents, task_id) VALUES ($1,'undo',$2,$3)`,
      [user.id, -undo.gold_cents, task.id]
    );
    await client.query(`UPDATE users SET gold_cents = gold_cents + $2 WHERE id=$1`, [
      user.id,
      -undo.gold_cents,
    ]);

    // Boss damage: restore health and remove the strike event, unless the
    // quest has left the active state or the strike ended the quest.
    if (undo.quest_id && undo.event_id) {
      const quest = (
        await client.query<{ state: string; boss_health: string }>(
          `SELECT state, boss_health FROM quests WHERE id=$1 FOR UPDATE`,
          [undo.quest_id]
        )
      ).rows[0];
      const ev = (
        await client.query<{ seq: number; amount: string }>(`SELECT seq, amount FROM quest_events WHERE id=$1`, [
          undo.event_id,
        ])
      ).rows[0];
      if (quest && quest.state === 'active' && ev) {
        const restoredHealth = Math.min(
          tenths(quest.boss_health) + tenths(ev.amount),
          tenths(String(await maxHealthOf(client, undo.quest_id!)))
        );
        await client.query(`DELETE FROM quest_events WHERE id=$1`, [undo.event_id]);
        await client.query(`UPDATE quests SET boss_health=$2 WHERE id=$1`, [
          undo.quest_id,
          fromTenths(restoredHealth).toFixed(1),
        ]);
      }
    }
    await client.query(`DELETE FROM undo_records WHERE id=$1`, [undo.id]);
  }

  await client.query(`UPDATE tasks SET done=false, done_at=NULL, updated_at=now() WHERE id=$1`, [task.id]);

  const freshTask = (await client.query<TaskRow>(`SELECT * FROM tasks WHERE id=$1`, [task.id])).rows[0];
  const freshUser = (await client.query<UserRow>(`SELECT * FROM users WHERE id=$1`, [user.id])).rows[0];
  return {
    result: {
      task: await serializeTaskFor(freshTask, freshUser),
      player: await toPlayer(freshUser),
      delta,
      strike: null,
      levelUp: false,
      fainted: false,
    },
  };
}

async function maxHealthOf(client: PoolClient, questId: string): Promise<string> {
  const r = await client.query<{ max_health: string }>(`SELECT max_health FROM quests WHERE id=$1`, [questId]);
  return r.rows[0].max_health;
}

async function restoreExperience(
  client: PoolClient,
  user: UserRow,
  undo: { old_level: number; old_experience: number; old_health: string; experience: number }
): Promise<void> {
  const current = (
    await client.query<UserRow>(`SELECT * FROM users WHERE id=$1 FOR UPDATE`, [user.id])
  ).rows[0];
  // A tick that caused a level-up restores the exact prior level, experience
  // and health; otherwise the tick's experience is simply subtracted.
  if (current.level !== undo.old_level) {
    await client.query(`UPDATE users SET level=$2, experience=$3, health=$4 WHERE id=$1`, [
      user.id,
      undo.old_level,
      undo.old_experience,
      undo.old_health,
    ]);
  } else {
    await client.query(`UPDATE users SET experience = GREATEST(0, experience - $2) WHERE id=$1`, [
      user.id,
      undo.experience,
    ]);
  }
}

/** Record a strike event when the party has an active quest; null otherwise. */
export async function recordStrike(
  client: PoolClient,
  user: UserRow,
  task: TaskRow,
  damageT: number
): Promise<StrikeEvent | null> {
  const party = (
    await client.query<{ party_id: string }>(`SELECT party_id FROM party_members WHERE user_id=$1`, [user.id])
  ).rows[0];
  if (!party) return null;
  const quest = (
    await client.query<{ id: string; boss_health: string }>(
      `SELECT id, boss_health FROM quests WHERE party_id=$1 AND state='active' FOR UPDATE`,
      [party.party_id]
    )
  ).rows[0];
  if (!quest) return null;

  const damage = fromTenths(damageT);
  const newHealth = Math.max(0, tenths(quest.boss_health) - damageT);
  await client.query(`UPDATE quests SET boss_health=$2 WHERE id=$1`, [quest.id, fromTenths(newHealth).toFixed(1)]);
  const seqRow = await client.query<{ seq: number }>(
    `UPDATE quests SET event_seq = event_seq + 1 WHERE id=$1 RETURNING event_seq AS seq`,
    [quest.id]
  );
  const seq = seqRow.rows[0].seq;
  const ev = await client.query<{ id: string }>(
    `INSERT INTO quest_events (quest_id, seq, kind, username, amount, missed, boss_health_after, task_id)
     VALUES ($1,$2,'strike',$3,$4,NULL,$5,$6) RETURNING id`,
    [quest.id, seq, user.username, damage.toFixed(1), fromTenths(newHealth).toFixed(1), task.id]
  );
  await client.query(`INSERT INTO quest_participants (quest_id, username) VALUES ($1,$2) ON CONFLICT (quest_id, username) DO NOTHING`, [
    quest.id,
    user.username,
  ]);
  return {
    id: ev.rows[0].id,
    seq,
    kind: 'strike',
    username: user.username,
    amount: damage,
    missed: null,
    bossHealthAfter: fromTenths(newHealth),
    createdAt: new Date().toISOString(),
  };
}

/** When a strike takes the boss to 0.0, defeat the quest and pay every member once. */
export async function maybeDefeat(
  client: PoolClient,
  username: string,
  strike: StrikeEvent
): Promise<boolean> {
  if (strike.bossHealthAfter > 0) return false;
  const quest = (
    await client.query<{
      id: string;
      party_id: string;
      reward_gold_cents: number;
      reward_experience: number;
    }>(`SELECT q.* FROM quests q JOIN quest_events e ON e.quest_id=q.id WHERE e.id=$1`, [strike.id])
  ).rows[0];
  if (!quest) return false;
  await client.query(`UPDATE quests SET state='defeated', ended_at=now(), defeated_by=$2 WHERE id=$1`, [
    quest.id,
    username,
  ]);
  const members = await client.query<{ user_id: string }>(
    `SELECT user_id FROM party_members WHERE party_id=$1`,
    [quest.party_id]
  );
  for (const m of members.rows) {
    const u = (await client.query<UserRow>(`SELECT * FROM users WHERE id=$1 FOR UPDATE`, [m.user_id])).rows[0];
    await applyGains(client, u, {
      experience: quest.reward_experience,
      ledger: { kind: 'quest', amountCents: quest.reward_gold_cents },
    });
    await client.query(`INSERT INTO quest_participants (quest_id, username) VALUES ($1,$2) ON CONFLICT (quest_id, username) DO NOTHING`, [
      quest.id,
      u.username,
    ]);
  }
  return true;
}

/** Buy a reward; refuses when the price is above the balance. */
export async function buyReward(
  client: PoolClient,
  user: UserRow,
  task: TaskRow
): Promise<ActionOutcome> {
  if (task.type !== 'reward') throw new ApiError('validation');
  const priceCents = task.price_cents ?? 0;
  if (priceCents > user.gold_cents) {
    throw new ApiError('not_enough_gold', { gold: 'Not enough gold.' });
  }
  await applyGains(client, user, { ledger: { kind: 'reward', amountCents: -priceCents, taskId: task.id } });
  const freshUser = (await client.query<UserRow>(`SELECT * FROM users WHERE id=$1`, [user.id])).rows[0];
  return {
    result: {
      task: await serializeTaskFor(task, freshUser),
      player: await toPlayer(freshUser),
      delta: { experience: 0, gold: -priceCents / 100, health: 0, damage: 0 },
      strike: null,
      levelUp: false,
      fainted: false,
    },
  };
}


