import { apiPostRaw } from './api.js';

const RESEND_MS = 1500;

interface Submission {
  bytes: string;
  answered: boolean;
}

const submissions = new Map<string, Submission>();
const listeners = new Set<() => void>();

export function onFinishChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function announce(): void {
  for (const listener of listeners) listener();
}

/**
 * Sends a run's finish once and resends the byte-identical body at least every
 * 2 seconds until any HTTP response arrives. The bytes are never re-serialised.
 */
export function sendFinish(runId: string, bytes: string): void {
  if (submissions.has(runId)) return;
  const submission: Submission = { bytes, answered: false };
  submissions.set(runId, submission);
  announce();
  const attempt = async (): Promise<void> => {
    const result = await apiPostRaw<{ runId: string; status: string }>(
      `/v1/runs/${runId}/finish`,
      submission.bytes,
    );
    if (result.kind === 'unconfirmed') {
      window.setTimeout(() => void attempt(), RESEND_MS);
      return;
    }
    submission.answered = true;
    announce();
  };
  void attempt();
}

export function finishPending(runId: string): boolean {
  const submission = submissions.get(runId);
  return submission !== undefined && !submission.answered;
}
