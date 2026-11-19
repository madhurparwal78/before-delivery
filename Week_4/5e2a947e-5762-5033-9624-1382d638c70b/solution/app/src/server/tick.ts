const tasks: (() => Promise<void> | void)[] = [];

/** Register work that re-evaluates deadlines against the server clock. */
export function onTick(task: () => Promise<void> | void): void {
  tasks.push(task);
}

let running: Promise<void> | null = null;

/** Run every registered deadline check once. Calls made while a run is in flight wait for the next run. */
export async function runTick(): Promise<void> {
  while (running) await running;
  running = (async () => {
    for (const task of tasks) {
      try {
        await task();
      } catch (error) {
        process.stderr.write(`tick: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  })();
  try {
    await running;
  } finally {
    running = null;
  }
}

export function startTicker(): void {
  setInterval(() => void runTick(), 1000).unref();
}
