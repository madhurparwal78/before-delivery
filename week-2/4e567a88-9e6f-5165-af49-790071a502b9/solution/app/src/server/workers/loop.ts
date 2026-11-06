// A background pass that runs every `intervalMs`, never overlaps itself, and can be asked to run now.

import { reason } from "../log";

interface Loop {
  start: () => void;
  nudge: () => void;
}

export function loop(name: string, intervalMs: number, pass: () => Promise<void>): Loop {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;
  const schedule = (ms: number): void => {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  async function run(): Promise<void> {
    running = true;
    try {
      await pass();
    } catch (error) {
      console.error(`${name} pass failed: ${reason(error)}`);
    } finally {
      running = false;
      schedule(again ? 0 : intervalMs);
      again = false;
    }
  }
  return {
    start: () => schedule(0),
    nudge: () => {
      if (running) again = true;
      else schedule(0);
    },
  };
}
