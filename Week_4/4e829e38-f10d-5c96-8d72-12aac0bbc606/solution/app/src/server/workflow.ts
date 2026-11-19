/** Saving a change, running the rules it sets off and publishing it: one place for all callers. */
import { dateOf } from "./clock.js";
import { addDays, daysBetween } from "./dates.js";
import { claim, type Tx } from "./db.js";
import { publish } from "./events.js";
import { nextDue, parseRepeat } from "./recurrence.js";
import {
  fireAdded, fireChanges, newChain, type Chain,
} from "./rules.js";
import {
  applyUpdate, getTaskRow, insertTask, removeTask, type Actor, type NewTask, type Patch, type ProjectContext, type TaskRow,
} from "./tasks.js";

export async function finishChain(tx: Tx, chain: Chain): Promise<void> {
  if (chain.trace.length) {
    await tx.query("UPDATE projects SET trace = $2 WHERE id = $1", [chain.ctx.id, JSON.stringify(chain.trace)]);
  }
  await publish(tx, {
    t: "tasks", team: chain.ctx.teamId, project: chain.ctx.id, ids: [...chain.touched], runs: [...chain.withRuns],
    ...(chain.trace.length ? { trace: chain.trace } : {}),
  });
}

/** Creates the next task of a repeating one, at most once per task. */
export async function spawnSuccessor(tx: Tx, chain: Chain, task: TaskRow, completedOn: string, onlyWhenOpen: boolean): Promise<TaskRow | null> {
  const repeat = parseRepeat(task.recurrence);
  if (!repeat || (onlyWhenOpen && repeat.kind === "after")) return null;
  if (!(await claim(tx, `successor:${task.id}`))) return null;
  const due = nextDue(repeat, task.due ?? completedOn, completedOn);
  const shift = task.due ? daysBetween(task.due, due) : 0;
  const successor = await insertTask(tx, chain.ctx, {
    name: task.name, sectionId: task.sectionId, assigneeId: task.assigneeId, effort: task.effort, recurrence: task.recurrence,
    values: task.values, due, start: task.start ? addDays(task.start, shift) : null,
  }, { name: task.name }, chain.now);
  chain.touched.add(successor.id);
  await fireAdded(tx, chain, successor, 0);
  await publish(tx, { t: "repeat", team: chain.ctx.teamId, project: chain.ctx.id, text: `${task.name} repeats on ${due}` });
  return successor;
}

export async function createTask(tx: Tx, ctx: ProjectContext, input: NewTask, actor: Actor, now: Date): Promise<TaskRow> {
  const chain = await newChain(tx, ctx, now);
  const task = await insertTask(tx, ctx, input, actor, now);
  chain.touched.add(task.id);
  await fireAdded(tx, chain, task, 0);
  await finishChain(tx, chain);
  return getTaskRow(tx, task.id);
}

export async function saveTask(tx: Tx, ctx: ProjectContext, current: TaskRow, patch: Patch, actor: Actor, now: Date): Promise<TaskRow> {
  const chain = await newChain(tx, ctx, now);
  const { task, changes } = await applyUpdate(tx, ctx, current, patch, actor, now);
  chain.touched.add(task.id);
  await fireChanges(tx, chain, task, changes, 0);
  if (changes.some((c) => c.field === "completed" && c.to === true)) {
    await spawnSuccessor(tx, chain, await getTaskRow(tx, task.id), dateOf(now), false);
  }
  await finishChain(tx, chain);
  return getTaskRow(tx, task.id);
}

export async function deleteTask(tx: Tx, ctx: ProjectContext, task: TaskRow): Promise<void> {
  const { rows } = await tx.query("SELECT id FROM tasks WHERE id = $1 OR parent_id = $1", [task.id]);
  await removeTask(tx, task);
  await publish(tx, { t: "tasks", team: ctx.teamId, project: ctx.id, ids: [], deleted: rows.map((r) => r.id as string) });
}

