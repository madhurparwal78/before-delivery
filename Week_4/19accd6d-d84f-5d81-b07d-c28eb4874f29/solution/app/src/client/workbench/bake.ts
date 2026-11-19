import type { BakeFailure, BakeMessage, BakeMode, BakeOutcome } from "../../shared/bake-protocol";
import { failureLine } from "../../shared/bake-protocol";
import { isRegexOperation } from "../../shared/operations/catalogue";
import type { Step } from "../../shared/operations/types";
import { announce } from "../announce";
import { config } from "../api";
import { activeTab, inputBytes, patch, stepsKey, workbench } from "./state";
import type { BakeView } from "./state";

const BUSY_AFTER_MS = 250;

/** A bake the page has handed to the worker and is waiting on. */
interface BakeRun {
  id: number;
  steps: Step[];
  inputLength: number;
  busyTimer: ReturnType<typeof setTimeout>;
  watchdog: ReturnType<typeof setTimeout> | null;
  regexAt: { step: number; branch: number | null } | null;
}

let worker: Worker | null = null;
let sequence = 0;
let running: BakeRun | null = null;
/** The steps of a bake that is paused, which "Resume" and "Step" carry on with. */
let paused: Step[] | null = null;
let autobakeTimer: ReturnType<typeof setTimeout> | null = null;

function startWorker(): Worker {
  const created = new Worker("/assets/bake-worker.js");
  created.onmessage = (event: MessageEvent<BakeMessage>) => receive(event.data);
  return created;
}

function discardWorker(): void {
  worker?.terminate();
  worker = null;
}

function clearRun(): void {
  if (!running) return;
  clearTimeout(running.busyTimer);
  if (running.watchdog) clearTimeout(running.watchdog);
  running = null;
}

function settle(run: BakeRun, outcome: BakeOutcome): void {
  const failure = outcome.failure;
  const bake: BakeView = {
    phase: outcome.status === "done" ? "done" : outcome.status === "paused" ? "paused" : "error",
    busy: false,
    statusText:
      outcome.status === "done"
        ? `Baked in ${Math.round(outcome.runMs)} ms`
        : outcome.status === "paused"
          ? `Paused at step ${(outcome.current as number) + 1}`
          : `Stopped at step ${(failure as BakeFailure).step + 1}`,
    stepsKey: stepsKey(run.steps),
    inputLength: run.inputLength,
    current: outcome.current,
    errorStep: failure ? failure.step : null,
    failureText: failure ? failureLine(failure, run.steps) : null,
    output: outcome.output,
    lengths: outcome.lengths,
    reached: outcome.reached,
  };
  paused = outcome.status === "paused" ? run.steps : null;
  patch({ bake });
  if (outcome.status === "done") announce("Output updated");
  if (outcome.status === "paused") announce(bake.statusText);
}

function receive(message: BakeMessage): void {
  if (!running || message.id !== running.id) return;
  if (message.kind === "regex") {
    running.regexAt = { step: message.step, branch: message.branch };
    return;
  }
  const run = running;
  clearRun();
  settle(run, message.outcome);
}

/** The page's own time budget for a bake with a regular expression step: past it the worker is replaced. */
function stopRegexStep(run: BakeRun): void {
  if (running !== run) return;
  discardWorker();
  clearRun();
  const first = run.steps.findIndex((step) => !step.disabled && isRegexOperation(step.op));
  const failure: BakeFailure = {
    step: run.regexAt?.step ?? first,
    branch: run.regexAt?.branch ?? null,
    message: `Stopped after ${config().regexBudgetMs} ms`,
  };
  settle(run, {
    status: "error", output: new Uint8Array(0), runMs: 0, lengths: [], current: null, reached: 0, failure,
  });
}

function begin(kind: "start" | "continue", mode: BakeMode): void {
  const state = workbench.get();
  let steps: Step[];
  let request;
  let inputLength = state.bake.inputLength;
  if (kind === "start") {
    const bytes = inputBytes(activeTab(state));
    if (!bytes) return;
    inputLength = bytes.length;
    steps = state.steps.map(({ id: _id, ...step }) => step);
    request = { kind, id: 0, input: bytes, steps, mode } as const;
    if (running) discardWorker();
  } else {
    steps = paused as Step[];
    request = { kind, id: 0, mode } as const;
  }
  clearRun();
  if (autobakeTimer) clearTimeout(autobakeTimer);
  worker ??= startWorker();
  const run: BakeRun = {
    id: ++sequence, steps, inputLength, regexAt: null, watchdog: null,
    busyTimer: setTimeout(() => patch({ bake: { ...workbench.get().bake, busy: true } }), BUSY_AFTER_MS),
  };
  if (steps.some((step) => !step.disabled && isRegexOperation(step.op))) {
    run.watchdog = setTimeout(() => stopRegexStep(run), config().regexBudgetMs);
  }
  running = run;
  paused = kind === "start" ? null : paused;
  patch({ bake: { ...state.bake, phase: "running", busy: false } });
  worker.postMessage({ ...request, id: run.id });
}

/** Bakes the selected input from the start, running to the next breakpoint or the end. */
export function bakeFresh(): void {
  begin("start", "run");
}

/** "Bake" and its shortcut: a fresh bake, or "Resume" while paused. */
export function bakeNow(): void {
  if (workbench.get().bake.phase === "paused") begin("continue", "run");
  else begin("start", "run");
}

/** "Step" and F8: one enabled step, from rest or from the pause. */
export function stepNow(): void {
  if (workbench.get().bake.phase === "paused") begin("continue", "step");
  else begin("start", "step");
}

/** A recipe or input change ends any bake in progress and any pause. */
export function cancelBake(): void {
  if (running) discardWorker();
  clearRun();
  paused = null;
  workbench.set((state) => {
    const { bake } = state;
    if (bake.phase !== "running" && bake.phase !== "paused") return state;
    return {
      ...state,
      bake: { ...bake, phase: "idle", busy: false, current: null, statusText: bake.phase === "paused" ? "" : bake.statusText },
    };
  });
}

export function scheduleAutobake(): void {
  if (autobakeTimer) clearTimeout(autobakeTimer);
  autobakeTimer = null;
  if (workbench.get().autoBake) autobakeTimer = setTimeout(bakeFresh, config().autobakeMs);
}

export function stopAutobake(): void {
  if (autobakeTimer) clearTimeout(autobakeTimer);
  autobakeTimer = null;
}
