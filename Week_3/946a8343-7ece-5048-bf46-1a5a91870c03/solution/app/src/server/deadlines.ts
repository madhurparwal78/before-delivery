// Work that is due on the server clock. In grading mode it runs when the clock route moves the clock; otherwise a timer
// runs it. Scheduler rounds are separate: they run on a 1 s timer in production and only via the runner routes
// in grading mode.
import { config } from "./config.ts";

type Task = () => Promise<void>;

const dueTasks: Task[] = [];
const roundTasks: Task[] = [];
let dueRunning: Promise<void> | undefined;

export function onDue(task: Task): void {
  dueTasks.push(task);
}

export function onRound(task: Task): void {
  roundTasks.push(task);
}

export async function runDue(): Promise<void> {
  while (dueRunning !== undefined) await dueRunning;
  const current = (async () => {
    for (const task of dueTasks) {
      try {
        await task();
      } catch (error) {
        console.error("deadline task failed", error);
      }
    }
  })();
  dueRunning = current;
  try {
    await current;
  } finally {
    dueRunning = undefined;
  }
}

export function startBackgroundLoops(): void {
  if (config.grading) return;
  let busyDue = false;
  setInterval(() => {
    if (busyDue) return;
    busyDue = true;
    runDue().finally(() => {
      busyDue = false;
    });
  }, 100);
  let busyRound = false;
  setInterval(() => {
    if (busyRound) return;
    busyRound = true;
    (async () => {
      for (const task of roundTasks) {
        try {
          await task();
        } catch (error) {
          console.error("scheduler round failed", error);
        }
      }
    })().finally(() => {
      busyRound = false;
    });
  }, 1000);
}
