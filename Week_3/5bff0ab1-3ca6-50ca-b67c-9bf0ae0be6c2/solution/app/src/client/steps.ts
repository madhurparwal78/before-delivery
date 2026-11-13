import { EASING, STEP_MS, ease, type StepName } from "../shared/motion.js";

/**
 * Every animated step of the stage runs here, timed from the browser's frame callback and monotonic timer and never from
 * the device clock. Each is logged for the probe with its published duration and the one published easing.
 */
export type Step = { name: StepName; ms: number; easing: string; startedAt: number; endedAt: number | null };
export type StepHandle = { cancel: () => void };

const LOG_LIMIT = 64;
const log: Step[] = [];
type Running = { entry: Step; frame: (eased: number) => void; done?: () => void };
const running = new Set<Running>();
let looping = false;

export const stepLog = (): Step[] => log.map((s) => ({ ...s }));
export const stepRunning = (name?: StepName): boolean => [...running].some((r) => !name || r.entry.name === name);
export const clearStepLog = (): void => {
  log.length = 0;
};

function loop(): void {
  const now = performance.now();
  for (const r of [...running]) {
    const t = (now - r.entry.startedAt) / r.entry.ms;
    if (t >= 1) {
      r.frame(1);
      r.entry.endedAt = Math.max(now, r.entry.startedAt + r.entry.ms);
      running.delete(r);
      r.done?.();
    } else if (t > 0) {
      r.frame(ease(t));
    }
  }
  if (running.size > 0) requestAnimationFrame(loop);
  else looping = false;
}

/** Starts a step: `frame` receives the eased fraction 0..1 on every animation frame until it ends. */
export function runStep(name: StepName, frame: (eased: number) => void, done?: () => void): StepHandle {
  const entry: Step = { name, ms: STEP_MS[name], easing: EASING, startedAt: performance.now(), endedAt: null };
  log.push(entry);
  if (log.length > LOG_LIMIT) log.shift();
  const item: Running = { entry, frame, done };
  running.add(item);
  if (!looping) {
    looping = true;
    requestAnimationFrame(loop);
  }
  return {
    cancel: () => {
      if (!running.delete(item)) return;
      const now = performance.now();
      if (now > entry.startedAt) entry.endedAt = now;
      else log.splice(log.indexOf(entry), 1);
    },
  };
}

/** Cancels everything still running, as a lost WebGL context does. */
export function cancelAllSteps(): void {
  for (const r of [...running]) {
    const now = performance.now();
    if (now > r.entry.startedAt) r.entry.endedAt = now;
    else log.splice(log.indexOf(r.entry), 1);
  }
  running.clear();
}
