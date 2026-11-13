import { LIST_KEY, type ActionResult, type LedgerEntry } from "../../shared/api.js";
import { one, pool, rows, type Db } from "../db.js";
import { buy, complete, score, uncomplete, type Outcome } from "../domain/actions.js";
import { balanceCents } from "../domain/ledger.js";
import { closeGap, insertTask, listLength, moveTask } from "../domain/ordering.js";
import { loadUser } from "../domain/progress.js";
import { parseNewTask, parseTaskPatch } from "../domain/taskinput.js";
import { Message, Refusal, invalid } from "../errors.js";
import { isUuid, reply, route, type Context, type Reply } from "../http.js";
import { keyOf, remember, storedReply } from "../idempotency.js";
import { mutate } from "../mutate.js";
import type { Touch } from "../publish.js";
import type { ChecklistRow, LedgerRow, TaskRow, UserRow } from "../records.js";
import { eventView, playerView, taskById, taskLists } from "../views.js";
import { asObject } from "./auth.js";

async function ownTask(db: Db, user: UserRow, id: string): Promise<TaskRow> {
  const task = isUuid(id) ? await one<TaskRow>(db, "SELECT * FROM tasks WHERE id = $1 AND user_id = $2", [id, user.id]) : undefined;
  if (!task) throw Refusal.notFound();
  return task;
}

async function actionResult(db: Db, user: UserRow, outcome: Outcome): Promise<ActionResult> {
  const fresh = await loadUser(db, user.id);
  return {
    task: await taskById(db, fresh, outcome.task.id),
    player: await playerView(db, fresh),
    delta: outcome.delta,
    strike: outcome.strike ? await eventView(db, outcome.strike) : null,
    levelUp: outcome.levelUp,
    fainted: outcome.fainted,
  };
}

/** Error order for an action on one task: 404, replayed key, state conflict and type (409, 422), then the work. */
function action(
  path: string,
  run: (db: Db, touch: Touch, user: UserRow, task: TaskRow, context: Context) => Promise<Outcome>,
): void {
  route("POST", path, async (context) => {
    const account = await context.user();
    return mutate(async (db, touch) => {
      const user = await loadUser(db, account.id);
      const task = await ownTask(db, user, context.params.id!);
      const keyed = keyOf(context.header("idempotency-key"), context.method, context.url.pathname, context.fingerprintBody());
      const stored = await storedReply(db, user.id, keyed);
      if (stored) return stored;
      const result: Reply = reply(200, await actionResult(db, user, await run(db, touch, user, task, context)));
      await remember(db, user.id, keyed, result);
      return result;
    });
  });
}

action("/api/tasks/:id/complete", (db, touch, user, task) => complete(db, touch, user, task, new Date()));
action("/api/tasks/:id/uncomplete", (db, touch, user, task) => uncomplete(db, touch, user, task, new Date()));
action("/api/rewards/:id/buy", (db, touch, user, task) => buy(db, touch, user, task));
action("/api/tasks/:id/score", (db, touch, user, task, context) => {
  if (task.type !== "habit") throw invalid({ type: Message.type });
  const direction = context.json((body) => asObject(body).direction);
  if (direction !== "up" && direction !== "down") throw invalid({ direction: Message.direction });
  return score(db, touch, user, task, direction, new Date());
});

route("GET", "/api/tasks", async (context) => reply(200, await taskLists(pool, await context.user())));

route("POST", "/api/tasks", async (context) => {
  const account = await context.user();
  const input = parseNewTask(context.json(asObject));
  return mutate(async (db, touch) => {
    const user = await loadUser(db, account.id);
    const created = await insertTask(db, user.id, input);
    await replaceChecklist(db, created.id, input.checklist);
    touch.taskList(user.id);
    return reply(201, await taskById(db, user, created.id));
  });
});

async function replaceChecklist(db: Db, taskId: string, items: { id?: string; text: string }[]): Promise<void> {
  const existing = await rows<ChecklistRow>(db, "SELECT * FROM checklist_items WHERE task_id = $1", [taskId]);
  const kept = new Map(existing.map((item) => [item.id, item]));
  await db.query("DELETE FROM checklist_items WHERE task_id = $1", [taskId]);
  for (const [index, item] of items.entries()) {
    const previous = item.id ? kept.get(item.id) : undefined;
    await db.query("INSERT INTO checklist_items (id, task_id, text, checked, position) VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5)", [
      previous?.id ?? null,
      taskId,
      item.text,
      previous?.checked ?? false,
      index + 1,
    ]);
  }
}

route("PATCH", "/api/tasks/:id", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const user = await loadUser(db, account.id);
    const task = await ownTask(db, user, context.params.id!);
    const seen = asObject(context.fingerprintBody()).updatedAt;
    if (typeof seen !== "string" || Date.parse(seen) !== task.updated_at.getTime()) throw Refusal.staleTask();
    const input = context.json(asObject);
    const patch = parseTaskPatch(input, task.type);
    await db.query(
      `UPDATE tasks SET title = COALESCE($2, title), difficulty = COALESCE($3, difficulty), weekdays = COALESCE($4, weekdays),
         price_cents = COALESCE($5, price_cents), updated_at = GREATEST(now(), updated_at + interval '1 millisecond') WHERE id = $1`,
      [task.id, patch.title ?? null, patch.difficulty ?? null, patch.weekdays ?? null, patch.priceCents ?? null],
    );
    if (patch.checklist) await replaceChecklist(db, task.id, patch.checklist);
    touch.taskList(user.id);
    return reply(200, await taskById(db, user, task.id));
  });
});

route("DELETE", "/api/tasks/:id", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const task = await ownTask(db, account, context.params.id!);
    await db.query("DELETE FROM tasks WHERE id = $1", [task.id]);
    await closeGap(db, task);
    touch.taskList(account.id);
    return reply(204);
  });
});

route("POST", "/api/tasks/:id/move", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const user = await loadUser(db, account.id);
    const task = await ownTask(db, user, context.params.id!);
    const position = context.json((body) => asObject(body).position);
    const total = await listLength(db, user.id, task.type);
    if (typeof position !== "number" || !Number.isInteger(position) || position < 1 || position > total) throw invalid({ position: Message.position(total) });
    await moveTask(db, task, position);
    touch.taskList(user.id);
    const lists = await taskLists(db, user);
    return reply(200, { tasks: lists[LIST_KEY[task.type]] });
  });
});

route("PATCH", "/api/tasks/:id/checklist/:itemId", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const user = await loadUser(db, account.id);
    const task = await ownTask(db, user, context.params.id!);
    const checked = context.json((body) => asObject(body).checked) === true;
    const item = isUuid(context.params.itemId!)
      ? await one<ChecklistRow>(db, "UPDATE checklist_items SET checked = $3 WHERE id = $1 AND task_id = $2 RETURNING *", [context.params.itemId, task.id, checked])
      : undefined;
    if (!item) throw Refusal.notFound();
    await db.query("UPDATE tasks SET updated_at = GREATEST(now(), updated_at + interval '1 millisecond') WHERE id = $1", [task.id]);
    touch.taskList(user.id);
    return reply(200, await taskById(db, user, task.id));
  });
});

route("GET", "/api/gold/ledger", async (context) => {
  const user = await context.user();
  const entries = await rows<LedgerRow>(pool, "SELECT id, kind, amount_cents, task_id, created_at FROM ledger WHERE user_id = $1 ORDER BY seq", [user.id]);
  const result: LedgerEntry[] = entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    amount: entry.amount_cents / 100,
    taskId: entry.task_id,
    createdAt: entry.created_at.toISOString(),
  }));
  return reply(200, { balance: (await balanceCents(pool, user.id)) / 100, entries: result });
});

