import { STEP_MS } from '../shared/movement.js';

type Hold = { down: number; up: number | null };

/** A key counts as held for a step when it went down before the step's moment and came up at or after it. */
export class Holds {
  private readonly holds = new Map<string, Hold[]>();

  down(key: string, at = performance.now()): void {
    const list = this.holds.get(key) ?? [];
    if (list.some((hold) => hold.up === null)) return;
    list.push({ down: at, up: null });
    this.holds.set(key, list);
  }

  up(key: string, at = performance.now()): void {
    const list = this.holds.get(key);
    if (!list) return;
    for (const hold of list) if (hold.up === null) hold.up = at;
  }

  isDown(key: string): boolean {
    return (this.holds.get(key) ?? []).some((hold) => hold.up === null);
  }

  heldAt(key: string, moment: number): boolean {
    return (this.holds.get(key) ?? []).some((hold) => hold.down < moment && (hold.up === null || hold.up >= moment));
  }

  /** The held key pressed most recently, which decides the direction when several are down. */
  latestHeld(keys: ReadonlyArray<string>, moment: number): string | null {
    let best: { key: string; down: number } | null = null;
    for (const key of keys)
      for (const hold of this.holds.get(key) ?? [])
        if (hold.down < moment && (hold.up === null || hold.up >= moment))
          if (!best || hold.down > best.down) best = { key, down: hold.down };
    return best ? best.key : null;
  }

  prune(before: number): void {
    for (const [key, list] of this.holds) {
      const kept = list.filter((hold) => hold.up === null || hold.up >= before);
      if (kept.length === 0) this.holds.delete(key);
      else this.holds.set(key, kept);
    }
  }
}

export type StepLoop = { stop: () => void; stepsDone: () => number };

/** The fixed 100 ms simulation on page time: a late frame runs every step it owes, in order. */
export function startStepLoop(simulate: (moment: number, index: number) => void, render: (now: number) => void): StepLoop {
  const readyAt = performance.now();
  let stepsDone = 0;
  let running = true;
  const frame = (now: number): void => {
    if (!running) return;
    const owed = Math.floor((now - readyAt) / STEP_MS) - stepsDone;
    for (let index = 0; index < owed; index += 1) {
      stepsDone += 1;
      simulate(readyAt + stepsDone * STEP_MS, stepsDone);
    }
    render(now);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return { stop: () => (running = false), stepsDone: () => stepsDone };
}
