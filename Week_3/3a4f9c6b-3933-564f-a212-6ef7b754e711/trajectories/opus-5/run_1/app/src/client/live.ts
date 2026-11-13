import { ApiCallFailed, type ApiFailure } from './api.js';
import { copy } from './copy.js';

function region(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Live region ${id} is missing`);
  return node;
}

let activityTimer = 0;
let progressTimer = 0;

/** Pending and success copy goes to status "Activity". */
export function announce(message: string, settle = false): void {
  const node = region('activity');
  node.textContent = message;
  window.clearTimeout(activityTimer);
  if (settle) activityTimer = window.setTimeout(() => (node.textContent = ''), 6000);
}

/** Error copy goes to alert "Problem". */
export function problem(message: string): void {
  region('problem').textContent = message;
}

export function clearProblem(): void {
  region('problem').textContent = '';
}

/** status "Promotion progress" announces each phase change once, then stands aside. */
export function progress(message: string): void {
  const node = region('progress');
  node.textContent = message;
  window.clearTimeout(progressTimer);
  progressTimer = window.setTimeout(() => (node.textContent = ''), 12_000);
}

export type FailureCopy = (failure: ApiFailure) => string | null;

/**
 * Turns a call failure into the copy its action asks for, falling back to the shared role,
 * session and network lines.
 */
export function failureMessage(cause: unknown, specific?: FailureCopy): string {
  if (!(cause instanceof ApiCallFailed)) return copy.networkFailed;
  const failure = cause.failure;
  const chosen = specific?.(failure);
  if (chosen) return chosen;
  if (failure.code === 'forbidden') return copy.roleRefused;
  if (failure.code === 'unauthenticated') return copy.sessionEnded;
  if (failure.code === 'validation' && failure.fields) {
    return Object.values(failure.fields)[0] ?? copy.networkFailed;
  }
  if (failure.code === 'network' || failure.status >= 500) return copy.networkFailed;
  return failure.message;
}

export function isSessionGone(cause: unknown): boolean {
  return cause instanceof ApiCallFailed && cause.failure.code === 'unauthenticated';
}
