import { call, NoResponse } from "../api";

const RESEND_MS = 1500;

interface PendingFinish {
  answered: boolean;
  readonly waiters: (() => void)[];
}

const finishes = new Map<string, PendingFinish>();

// Sends a run's finish body and resends the byte-identical body until any HTTP response arrives.
export function sendFinish(runId: string, body: string): void {
  const pending: PendingFinish = { answered: false, waiters: [] };
  finishes.set(runId, pending);
  const attempt = () => {
    call("POST", `/v1/runs/${runId}/finish`, { body }).then(() => {
      pending.answered = true;
      for (const waiter of pending.waiters.splice(0)) waiter();
    }, (error: unknown) => {
      if (error instanceof NoResponse) window.setTimeout(attempt, RESEND_MS);
    });
  };
  attempt();
}

// Resolves once the run's finish has an HTTP answer (at once when nothing is in flight).
export function finishAnswered(runId: string): Promise<void> {
  const pending = finishes.get(runId);
  if (!pending || pending.answered) return Promise.resolve();
  return new Promise((resolve) => pending.waiters.push(resolve));
}
