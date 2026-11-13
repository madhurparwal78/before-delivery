import type { ActionResult, StrikeEvent } from '../../shared/types.js';
import type { Client } from '../db.js';
import { config } from '../config.js';
import { fail, failNotEnoughGold } from '../http/errors.js';
import { clampValue, healthLossTenths, payoutFor } from '../domain/rewards.js';
import { experienceToLevel } from '../domain/levels.js';
import { activeQuest } from './party.js';
import {
  awardExperience,
  faintIfDown,
  goldCents,
  loadUser,
  loseHealth,
  playerJson,
  setLevelState,
  partyIdOf,
  writeLedger,
  type UserRow,
} from './player.js';
import { applyStrike, loadQuest, removeStrikeEvent } from './quest.js';
import { loadChecklist, loadTaskRow, taskJson, type TaskRow } from './tasks.js';

export interface ActionOutcome {
  result: ActionResult;
  strikeQuestId: string | null;
  defeatedQuestId: string | null;
  undoneStrikeQuestId: string | null;
  noticeWatermark: string;
}

async function lockTask(client: Client, taskId: string): Promise<TaskRow | null> {
  const found = await client.query<TaskRow>(
    `select id, user_id, type, title, difficulty, value, streak, done, weekdays, price_cents, position, updated_at
     from tasks where id = $1 for update`,
    [taskId],
  );
  return found.rows[0] ?? null;
}

async function watermark(client: Client, userId: string): Promise<string> {
  const found = await client.query<{ mark: string }>(
    'select coalesce(max(seq), 0)::text as mark from notices where user_id = $1',
    [userId],
  );
  return found.rows[0]?.mark ?? '0';
}

async function buildResult(
  client: Client,
  user: UserRow,
  taskId: string,
  before: { level: number; experience: number; healthTenths: number; goldCents: number },
  damageTenths: number,
  strike: StrikeEvent | null,
  levelsGained: number,
  fainted: boolean,
): Promise<ActionResult> {
  const fresh = await loadUser(client, user.id);
  if (!fresh) throw fail('not_found');
  const task = await loadTaskRow(client, taskId);
  if (!task) throw fail('not_found');
  const checklist = task.type === 'todo' ? await loadChecklist(client, taskId) : [];
  const cents = await goldCents(client, user.id);
  const player = await playerJson(client, fresh);
  const experienceDelta =
    totalExperience(fresh.level, fresh.experience) - totalExperience(before.level, before.experience);
  return {
    task: taskJson(task, checklist, fresh.open_date),
    player,
    delta: {
      experience: experienceDelta,
      gold: (cents - before.goldCents) / 100,
      health: (fresh.health_tenths - before.healthTenths) / 10,
      damage: damageTenths / 10,
    },
    strike,
    levelUp: levelsGained > 0,
    fainted,
  };
}

function totalExperience(level: number, experience: number): number {
  let total = experience;
  for (let step = 1; step < level; step += 1) total += experienceToLevel(step);
  return total;
}

async function snapshot(client: Client, user: UserRow) {
  return {
    level: user.level,
    experience: user.experience,
    healthTenths: user.health_tenths,
    goldCents: await goldCents(client, user.id),
  };
}

async function strikeIfOnQuest(
  client: Client,
  user: UserRow,
  damageTenths: number,
): Promise<{ strike: StrikeEvent | null; questId: string | null; defeated: boolean }> {
  const partyId = await partyIdOf(client, user.id);
  if (!partyId) return { strike: null, questId: null, defeated: false };
  const quest = await activeQuest(client, partyId);
  if (!quest) return { strike: null, questId: null, defeated: false };
  const outcome = await applyStrike(client, quest.id, user.id, damageTenths);
  if (!outcome) return { strike: null, questId: null, defeated: false };
  return { strike: outcome.event, questId: quest.id, defeated: outcome.defeated };
}

/** Completing a daily or a to-do. */
export async function completeTask(client: Client, user: UserRow, taskId: string): Promise<ActionOutcome> {
  const task = await lockTask(client, taskId);
  if (!task) throw fail('not_found');
  if (task.done) throw fail('already_done');

  const mark = await watermark(client, user.id);
  const before = await snapshot(client, user);
  const checklist = task.type === 'todo' ? await loadChecklist(client, taskId) : [];
  const checked = checklist.filter((item) => item.checked).length;
  const payout = payoutFor(task.difficulty ?? 'easy', task.value ?? 0, checked, checklist.length);

  await client.query(
    `update tasks set done = true, value = $2, updated_at = date_trunc('milliseconds', now()) where id = $1`,
    [taskId, clampValue((task.value ?? 0) + 1)],
  );
  const levelsGained = await awardExperience(client, user.id, payout.experience);
  await writeLedger(client, user.id, 'task', payout.goldCents, taskId);
  const { strike, questId, defeated } = await strikeIfOnQuest(client, user, payout.damageTenths);

  await client.query(
    `insert into ticks (task_id, user_id, experience, gold_cents, damage_tenths, quest_id, strike_event_id,
       prev_level, prev_experience, prev_health_tenths, caused_level_up)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      taskId,
      user.id,
      payout.experience,
      payout.goldCents,
      strike ? Math.round(strike.amount * 10) : 0,
      questId,
      strike ? strike.id : null,
      before.level,
      before.experience,
      before.healthTenths,
      levelsGained > 0,
    ],
  );

  return {
    result: await buildResult(
      client,
      user,
      taskId,
      before,
      strike ? Math.round(strike.amount * 10) : 0,
      strike,
      levelsGained,
      false,
    ),
    strikeQuestId: strike ? questId : null,
    defeatedQuestId: defeated ? questId : null,
    undoneStrikeQuestId: null,
    noticeWatermark: mark,
  };
}

/** Unticking a daily or a to-do. Inside the undo window it reverts exactly what the tick gave. */
export async function uncompleteTask(client: Client, user: UserRow, taskId: string): Promise<ActionOutcome> {
  const task = await lockTask(client, taskId);
  if (!task) throw fail('not_found');
  if (!task.done) throw fail('not_done');

  const mark = await watermark(client, user.id);
  const before = await snapshot(client, user);
  const ticks = await client.query<{
    id: string;
    created_at: Date;
    experience: number;
    gold_cents: number;
    damage_tenths: number;
    quest_id: string | null;
    strike_event_id: string | null;
    prev_level: number;
    prev_experience: number;
    prev_health_tenths: number;
    caused_level_up: boolean;
  }>(
    `select id, created_at, experience, gold_cents, damage_tenths, quest_id, strike_event_id,
            prev_level, prev_experience, prev_health_tenths, caused_level_up
     from ticks where task_id = $1 and open = true order by created_at desc limit 1`,
    [taskId],
  );
  const tick = ticks.rows[0];
  const now = await serverNow(client);
  const withinWindow =
    tick !== undefined && now - tick.created_at.getTime() < config.undoWindowSeconds * 1000;

  await client.query(
    `update tasks set done = false, updated_at = date_trunc('milliseconds', now()) where id = $1`,
    [taskId],
  );
  if (tick) await client.query('update ticks set open = false where id = $1', [tick.id]);

  let undoneStrikeQuestId: string | null = null;
  if (tick && withinWindow) {
    if (tick.caused_level_up) {
      await setLevelState(client, user.id, tick.prev_level, tick.prev_experience, tick.prev_health_tenths);
    } else {
      await client.query('update users set experience = experience - $2 where id = $1', [user.id, tick.experience]);
    }
    await writeLedger(client, user.id, 'undo', -tick.gold_cents, taskId);
    await client.query(
      `update tasks set value = $2, updated_at = date_trunc('milliseconds', now()) where id = $1`,
      [taskId, clampValue((task.value ?? 0) - 1)],
    );
    if (tick.strike_event_id && tick.quest_id) {
      const quest = await loadQuest(client, tick.quest_id);
      if (quest && quest.state === 'active') {
        await removeStrikeEvent(client, tick.strike_event_id, tick.quest_id);
        undoneStrikeQuestId = tick.quest_id;
      }
    }
  }

  return {
    result: await buildResult(client, user, taskId, before, 0, null, 0, false),
    strikeQuestId: null,
    defeatedQuestId: null,
    undoneStrikeQuestId,
    noticeWatermark: mark,
  };
}

/** Scoring a habit up or down. */
export async function scoreTask(
  client: Client,
  user: UserRow,
  taskId: string,
  direction: 'up' | 'down',
): Promise<ActionOutcome> {
  const task = await lockTask(client, taskId);
  if (!task) throw fail('not_found');
  const mark = await watermark(client, user.id);
  const before = await snapshot(client, user);
  const value = task.value ?? 0;

  if (direction === 'up') {
    const payout = payoutFor(task.difficulty ?? 'easy', value);
    await client.query(
      `update tasks set value = $2, updated_at = date_trunc('milliseconds', now()) where id = $1`,
      [taskId, clampValue(value + 1)],
    );
    const levelsGained = await awardExperience(client, user.id, payout.experience);
    await writeLedger(client, user.id, 'task', payout.goldCents, taskId);
    const { strike, questId, defeated } = await strikeIfOnQuest(client, user, payout.damageTenths);
    return {
      result: await buildResult(
        client,
        user,
        taskId,
        before,
        strike ? Math.round(strike.amount * 10) : 0,
        strike,
        levelsGained,
        false,
      ),
      strikeQuestId: strike ? questId : null,
      defeatedQuestId: defeated ? questId : null,
      undoneStrikeQuestId: null,
      noticeWatermark: mark,
    };
  }

  const lost = healthLossTenths(task.difficulty ?? 'easy', value);
  await client.query(`update tasks set value = $2, updated_at = date_trunc('milliseconds', now()) where id = $1`, [
    taskId,
    clampValue(value - 1),
  ]);
  await loseHealth(client, user.id, lost);
  const fainted = await faintIfDown(client, user.id);
  return {
    result: await buildResult(client, user, taskId, before, 0, null, 0, fainted),
    strikeQuestId: null,
    defeatedQuestId: null,
    undoneStrikeQuestId: null,
    noticeWatermark: mark,
  };
}

/** Buying a reward. A price above the balance is refused and changes nothing. */
export async function buyReward(client: Client, user: UserRow, taskId: string): Promise<ActionOutcome> {
  const task = await lockTask(client, taskId);
  if (!task) throw fail('not_found');
  const mark = await watermark(client, user.id);
  const before = await snapshot(client, user);
  const price = task.price_cents ?? 0;
  if (price > before.goldCents) throw failNotEnoughGold();
  await writeLedger(client, user.id, 'reward', -price, taskId);
  return {
    result: await buildResult(client, user, taskId, before, 0, null, 0, false),
    strikeQuestId: null,
    defeatedQuestId: null,
    undoneStrikeQuestId: null,
    noticeWatermark: mark,
  };
}

async function serverNow(client: Client): Promise<number> {
  const found = await client.query<{ now: Date }>('select now() as now');
  const value = found.rows[0];
  return value ? value.now.getTime() : Date.now();
}
