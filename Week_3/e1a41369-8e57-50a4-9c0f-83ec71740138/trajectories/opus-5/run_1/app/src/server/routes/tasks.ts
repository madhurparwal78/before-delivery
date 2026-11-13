import type { Difficulty, TaskType, Weekday } from '../../shared/types.js';
import { query, transaction, type Client } from '../db.js';
import { Router, type Ctx } from '../http/core.js';
import { VALIDATION_MESSAGES, fail, failValidation } from '../http/errors.js';
import { onceWithKey, replyStored } from '../http/idempotency.js';
import { isDifficulty } from '../domain/rewards.js';
import { WEEKDAYS } from '../time.js';
import { buyReward, completeTask, scoreTask, uncompleteTask, type ActionOutcome } from '../services/actions.js';
import {
  publishNoticesSince,
  publishParty,
  publishPlayer,
  publishQuest,
  publishStrike,
  publishTasks,
} from '../services/notify.js';
import { loadUser, type UserRow } from '../services/player.js';
import {
  closeGapAfterDelete,
  countOfType,
  loadChecklist,
  loadListOfType,
  loadTaskLists,
  loadTaskRow,
  moveTask,
  taskJsonById,
  type TaskRow,
} from '../services/tasks.js';
import { memberIds } from '../services/party.js';

const TASK_TYPES: TaskType[] = ['habit', 'daily', 'todo', 'reward'];

async function currentUser(ctx: Ctx): Promise<UserRow> {
  const session = ctx.requireUser();
  const user = await loadUser({ query }, session.id);
  if (!user) throw fail('unauthenticated');
  return user;
}

/** Loads one of the Player's own tasks. Another Player's task answers like one that does not exist. */
async function ownTask(client: Client, user: UserRow, taskId: string): Promise<TaskRow> {
  const row = await loadTaskRow(client, taskId);
  if (!row || row.user_id !== user.id) throw fail('not_found');
  return row;
}

function priceCentsFrom(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber)) return null;
  const cents = Math.round(asNumber * 100);
  if (Math.abs(asNumber * 100 - cents) > 1e-6) return null;
  if (cents < 1 || cents > 999_999) return null;
  return cents;
}

function weekdaysFrom(value: unknown): Weekday[] | null {
  if (!Array.isArray(value)) return null;
  const chosen: Weekday[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !(WEEKDAYS as string[]).includes(entry)) return null;
    if (!chosen.includes(entry as Weekday)) chosen.push(entry as Weekday);
  }
  if (chosen.length === 0) return null;
  return WEEKDAYS.filter((day) => chosen.includes(day));
}

function checklistFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map((entry) =>
    entry.trim(),
  );
}

interface TaskFields {
  title: string;
  difficulty: Difficulty;
  weekdays: Weekday[] | null;
  checklist: string[] | null;
  priceCents: number | null;
}

function readTaskFields(body: Record<string, unknown>, type: TaskType, partial: boolean): TaskFields {
  const errors: Record<string, string> = {};
  const hasTitle = body.title !== undefined;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!partial || hasTitle) {
    if (title.length < 1 || title.length > 80) errors.title = VALIDATION_MESSAGES.title;
  }

  let difficulty: Difficulty = 'easy';
  if (type !== 'reward') {
    if (body.difficulty !== undefined) {
      if (isDifficulty(body.difficulty)) difficulty = body.difficulty;
      else errors.difficulty = VALIDATION_MESSAGES.difficulty;
    }
  }

  let weekdays: Weekday[] | null = null;
  if (type === 'daily') {
    if (body.weekdays !== undefined) {
      weekdays = weekdaysFrom(body.weekdays);
      if (weekdays === null) errors.weekdays = VALIDATION_MESSAGES.weekdays;
    } else if (!partial) {
      weekdays = [...WEEKDAYS];
    }
  }

  let priceCents: number | null = null;
  if (type === 'reward') {
    if (body.price !== undefined) {
      priceCents = priceCentsFrom(body.price);
      if (priceCents === null) errors.price = VALIDATION_MESSAGES.price;
    } else if (!partial) {
      errors.price = VALIDATION_MESSAGES.price;
    }
  }

  const checklist = type === 'todo' && body.checklist !== undefined ? checklistFrom(body.checklist) : null;

  if (Object.keys(errors).length > 0) throw failValidation(errors);
  return { title, difficulty, weekdays, checklist, priceCents };
}

async function publishOwn(userId: string): Promise<void> {
  const client: Client = { query };
  await publishTasks(client, userId);
  await publishPlayer(client, userId);
}

async function publishAction(userId: string, outcome: ActionOutcome): Promise<void> {
  const client: Client = { query };
  await publishOwn(userId);
  await publishNoticesSince(client, userId, outcome.noticeWatermark);
  const questId = outcome.strikeQuestId ?? outcome.undoneStrikeQuestId ?? outcome.defeatedQuestId;
  if (questId) {
    await publishQuest(client, questId);
    if (outcome.strikeQuestId && outcome.result.strike) {
      await publishStrike(client, outcome.strikeQuestId, outcome.result.strike);
    }
  }
  if (outcome.defeatedQuestId) {
    const quest = await query<{ party_id: string }>('select party_id from quests where id = $1', [
      outcome.defeatedQuestId,
    ]);
    const partyId = quest.rows[0]?.party_id;
    if (partyId) {
      for (const memberId of await memberIds(client, partyId)) {
        await publishPlayer(client, memberId);
        await publishNoticesSince(client, memberId, '0');
      }
      await publishParty(client, partyId);
    }
  }
}

export function registerTaskRoutes(router: Router): void {
  router.add('GET', '/api/tasks', async (ctx) => {
    const user = await currentUser(ctx);
    ctx.send(200, await loadTaskLists({ query }, user.id, user.open_date));
  });

  router.add('POST', '/api/tasks', async (ctx) => {
    const user = await currentUser(ctx);
    const body = ctx.json();
    const type = typeof body.type === 'string' && (TASK_TYPES as string[]).includes(body.type) ? (body.type as TaskType) : null;
    if (!type) throw failValidation({ type: VALIDATION_MESSAGES.type });
    const fields = readTaskFields(body, type, false);

    const task = await transaction(async (client) => {
      const position = (await countOfType(client, user.id, type)) + 1;
      const created = await client.query<{ id: string }>(
        `insert into tasks (user_id, type, title, difficulty, value, streak, done, weekdays, price_cents, position,
           updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, date_trunc('milliseconds', now())) returning id`,
        [
          user.id,
          type,
          fields.title,
          type === 'reward' ? null : fields.difficulty,
          type === 'reward' ? null : 0,
          type === 'daily' ? 0 : null,
          type === 'daily' || type === 'todo' ? false : null,
          type === 'daily' ? fields.weekdays : null,
          type === 'reward' ? fields.priceCents : null,
          position,
        ],
      );
      const taskId = created.rows[0]?.id as string;
      const items = fields.checklist ?? [];
      for (let index = 0; index < items.length; index += 1) {
        await client.query('insert into checklist_items (task_id, text, position) values ($1, $2, $3)', [
          taskId,
          items[index] as string,
          index + 1,
        ]);
      }
      return taskJsonById(client, taskId, user.open_date);
    });
    await publishOwn(user.id);
    ctx.send(201, task);
  });

  router.add('PATCH', '/api/tasks/:id', async (ctx) => {
    const user = await currentUser(ctx);
    const existing = await ownTask({ query }, user, ctx.param('id'));
    const body = ctx.json();
    if (typeof body.updatedAt === 'string') {
      const sent = new Date(body.updatedAt).getTime();
      if (!Number.isFinite(sent) || sent !== existing.updated_at.getTime()) throw fail('stale_task');
    }
    const fields = readTaskFields(body, existing.type, true);

    const task = await transaction(async (client) => {
      if (body.title !== undefined) {
        await client.query('update tasks set title = $2 where id = $1', [existing.id, fields.title]);
      }
      if (body.difficulty !== undefined && existing.type !== 'reward') {
        await client.query('update tasks set difficulty = $2 where id = $1', [existing.id, fields.difficulty]);
      }
      if (body.weekdays !== undefined && existing.type === 'daily') {
        await client.query('update tasks set weekdays = $2 where id = $1', [existing.id, fields.weekdays]);
      }
      if (body.price !== undefined && existing.type === 'reward') {
        await client.query('update tasks set price_cents = $2 where id = $1', [existing.id, fields.priceCents]);
      }
      if (existing.type === 'todo' && Array.isArray(body.checklist)) {
        await rewriteChecklist(client, existing.id, body.checklist);
      }
      await client.query(`update tasks set updated_at = date_trunc('milliseconds', now()) where id = $1`, [
        existing.id,
      ]);
      return taskJsonById(client, existing.id, user.open_date);
    });
    await publishOwn(user.id);
    ctx.send(200, task);
  });

  router.add('DELETE', '/api/tasks/:id', async (ctx) => {
    const user = await currentUser(ctx);
    const existing = await ownTask({ query }, user, ctx.param('id'));
    await transaction(async (client) => {
      await client.query('delete from tasks where id = $1', [existing.id]);
      await closeGapAfterDelete(client, user.id, existing.type, existing.position);
    });
    await publishOwn(user.id);
    ctx.sendEmpty(204);
  });

  router.add('POST', '/api/tasks/:id/move', async (ctx) => {
    const user = await currentUser(ctx);
    const existing = await ownTask({ query }, user, ctx.param('id'));
    const body = ctx.json();
    const total = await countOfType({ query }, user.id, existing.type);
    const position = body.position;
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 1 || position > total) {
      throw failValidation({ position: VALIDATION_MESSAGES.position(total) });
    }
    const tasks = await transaction(async (client) => {
      await moveTask(client, existing, position);
      return loadListOfType(client, user.id, existing.type, user.open_date);
    });
    await publishOwn(user.id);
    ctx.send(200, { tasks });
  });

  router.add('POST', '/api/tasks/:id/score', async (ctx) => {
    const user = await currentUser(ctx);
    const existing = await ownTask({ query }, user, ctx.param('id'));
    const stored = await onceWithKey(ctx, user.id, async () => {
      const body = ctx.json();
      const errors: Record<string, string> = {};
      if (existing.type !== 'habit') errors.type = VALIDATION_MESSAGES.type;
      if (body.direction !== 'up' && body.direction !== 'down') errors.direction = VALIDATION_MESSAGES.direction;
      if (Object.keys(errors).length > 0) throw failValidation(errors);
      const outcome = await transaction((client) =>
        scoreTask(client, user, existing.id, body.direction as 'up' | 'down'),
      );
      await publishAction(user.id, outcome);
      return { status: 200, body: outcome.result };
    });
    replyStored(ctx, stored);
  });

  router.add('POST', '/api/tasks/:id/complete', async (ctx) => {
    const user = await currentUser(ctx);
    const existing = await ownTask({ query }, user, ctx.param('id'));
    const stored = await onceWithKey(ctx, user.id, async () => {
      if (existing.type !== 'daily' && existing.type !== 'todo') {
        throw failValidation({ type: VALIDATION_MESSAGES.type });
      }
      const outcome = await transaction((client) => completeTask(client, user, existing.id));
      await publishAction(user.id, outcome);
      return { status: 200, body: outcome.result };
    });
    replyStored(ctx, stored);
  });

  router.add('POST', '/api/tasks/:id/uncomplete', async (ctx) => {
    const user = await currentUser(ctx);
    const existing = await ownTask({ query }, user, ctx.param('id'));
    const stored = await onceWithKey(ctx, user.id, async () => {
      const outcome = await transaction((client) => uncompleteTask(client, user, existing.id));
      await publishAction(user.id, outcome);
      return { status: 200, body: outcome.result };
    });
    replyStored(ctx, stored);
  });

  router.add('PATCH', '/api/tasks/:id/checklist/:itemId', async (ctx) => {
    const user = await currentUser(ctx);
    const existing = await ownTask({ query }, user, ctx.param('id'));
    const itemId = ctx.param('itemId');
    const items = await loadChecklist({ query }, existing.id);
    if (!items.some((item) => item.id === itemId)) throw fail('not_found');
    const body = ctx.json();
    const checked = body.checked === true;
    const task = await transaction(async (client) => {
      await client.query('update checklist_items set checked = $2 where id = $1', [itemId, checked]);
      await client.query(`update tasks set updated_at = date_trunc('milliseconds', now()) where id = $1`, [
        existing.id,
      ]);
      return taskJsonById(client, existing.id, user.open_date);
    });
    await publishOwn(user.id);
    ctx.send(200, task);
  });

  router.add('POST', '/api/rewards/:id/buy', async (ctx) => {
    const user = await currentUser(ctx);
    const existing = await ownTask({ query }, user, ctx.param('id'));
    if (existing.type !== 'reward') throw fail('not_found');
    const stored = await onceWithKey(ctx, user.id, async () => {
      const outcome = await transaction((client) => buyReward(client, user, existing.id));
      await publishAction(user.id, outcome);
      return { status: 200, body: outcome.result };
    });
    replyStored(ctx, stored);
  });

  router.add('GET', '/api/gold/ledger', async (ctx) => {
    const user = await currentUser(ctx);
    const entries = await query<{
      id: string;
      kind: string;
      amount_cents: number;
      task_id: string | null;
      created_at: Date;
    }>('select id, kind, amount_cents, task_id, created_at from gold_ledger where user_id = $1 order by seq', [
      user.id,
    ]);
    const list = entries.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: row.amount_cents / 100,
      taskId: row.task_id,
      createdAt: row.created_at.toISOString(),
    }));
    const balance = list.reduce((total, entry) => total + Math.round(entry.amount * 100), 0) / 100;
    ctx.send(200, { balance, entries: list });
  });
}

async function rewriteChecklist(client: Client, taskId: string, items: unknown[]): Promise<void> {
  const keptIds: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index];
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { id?: unknown; text?: unknown };
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (text === '') continue;
    if (typeof record.id === 'string') {
      const updated = await client.query('update checklist_items set text = $2, position = $3 where id = $1', [
        record.id,
        text,
        index + 1,
      ]);
      if (updated.rowCount === 1) keptIds.push(record.id);
      continue;
    }
    const created = await client.query<{ id: string }>(
      'insert into checklist_items (task_id, text, position) values ($1, $2, $3) returning id',
      [taskId, text, index + 1],
    );
    const createdId = created.rows[0]?.id;
    if (createdId) keptIds.push(createdId);
  }
  if (keptIds.length === 0) {
    await client.query('delete from checklist_items where task_id = $1', [taskId]);
    return;
  }
  await client.query('delete from checklist_items where task_id = $1 and not (id = any($2::uuid[]))', [
    taskId,
    keptIds,
  ]);
}
