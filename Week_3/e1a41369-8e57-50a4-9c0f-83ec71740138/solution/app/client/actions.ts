import type { ActionResult, Task, TaskLists } from "../shared/api";
import { LIST_KEY } from "../shared/api";
import { api, ApiError, explain, keyed } from "./api";
import { say } from "./feed";
import { hundredths, tenths } from "./format";
import { announceOwnStrike, beginStrikingAction, endStrikingAction } from "./live";
import { getState, setState } from "./store";

/** The task whose action caused the next level-up or faint dialog, so closing it can return focus there. */
export const noticeReturn: { taskId: string | null } = { taskId: null };

export const STRIKE_CHIP = "strike-chip";

const isPending = (taskId: string): boolean => getState().pendingTasks.includes(taskId);

function setPending(taskId: string, on: boolean): void {
  setState((current) => ({ pendingTasks: on ? [...current.pendingTasks, taskId] : current.pendingTasks.filter((id) => id !== taskId) }));
}

/** An own action shows its server result at once; the live stream then keeps other screens current. */
function applyResult(result: ActionResult): void {
  setState((current) => ({
    me: result.player,
    tasks: current.tasks && { ...current.tasks, [LIST_KEY[result.task.type]]: listOf(current.tasks, result.task).map((task) => (task.id === result.task.id ? result.task : task)) },
  }));
}

function showFailure(error: unknown): void {
  if (error instanceof ApiError && error.status === 409) return;
  setState({ alert: explain(error) });
}

async function act(task: Task, path: string, body: unknown, announce: (result: ActionResult) => void, row: HTMLElement | null): Promise<void> {
  if (isPending(task.id)) return;
  setPending(task.id, true);
  setState({ alert: null });
  beginStrikingAction();
  try {
    const result = await api<ActionResult>("POST", path, body, keyed());
    applyResult(result);
    if (result.levelUp || result.fainted) noticeReturn.taskId = task.id;
    announce(result);
    if (result.strike) {
      announceOwnStrike(result.strike);
      if (row) document.dispatchEvent(new CustomEvent(STRIKE_CHIP, { detail: { from: row.getBoundingClientRect(), amount: result.strike.amount } }));
    }
  } catch (error) {
    showFailure(error);
  } finally {
    endStrikingAction();
    setPending(task.id, false);
  }
}

export const completeTask = (task: Task, row: HTMLElement | null): Promise<void> =>
  act(task, `/api/tasks/${task.id}/complete`, {}, (result) => say(`${task.title} complete: +${result.delta.experience} experience, +${hundredths(result.delta.gold)} gold`), row);

export const uncompleteTask = (task: Task): Promise<void> =>
  act(task, `/api/tasks/${task.id}/uncomplete`, {}, () => say(`${task.title} undone`), null);

export const scoreHabit = (task: Task, direction: "up" | "down", row: HTMLElement | null): Promise<void> =>
  act(
    task,
    `/api/tasks/${task.id}/score`,
    { direction },
    (result) =>
      say(
        direction === "up"
          ? `${task.title} scored: +${result.delta.experience} experience, +${hundredths(result.delta.gold)} gold`
          : `${task.title} scored down: you lost ${tenths(-result.delta.health)} health`,
      ),
    row,
  );

export const buyReward = (task: Task): Promise<void> =>
  act(task, `/api/rewards/${task.id}/buy`, {}, (result) => say(`${task.title} bought for ${hundredths(-result.delta.gold)} gold`), null);

export async function moveTask(task: Task, position: number): Promise<void> {
  try {
    const { tasks } = await api<{ tasks: Task[] }>("POST", `/api/tasks/${task.id}/move`, { position });
    setState((current) => (current.tasks ? { tasks: { ...current.tasks, [LIST_KEY[task.type]]: tasks } } : {}));
    say(`${task.title} moved to position ${tasks.findIndex((moved) => moved.id === task.id) + 1} of ${tasks.length}`);
  } catch (error) {
    showFailure(error);
  }
}

const listOf = (lists: TaskLists, task: Task): Task[] => lists[LIST_KEY[task.type]];
