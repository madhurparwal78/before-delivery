import type { Failure } from './api.ts';
import { el } from './dom.ts';

export const NETWORK_COPY = 'No connection. Check the studio wifi and try again.';
export const SERVER_COPY = 'Something went wrong. Try again.';
export const FIELDS_COPY = 'Fix the highlighted fields.';
export const SESSION_COPY = 'Your session ended. Sign in again.';

export class Region {
  readonly node: HTMLElement;

  constructor(label: string) {
    this.node = el('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': label,
      class: 'live-region',
    });
  }

  say(message: string): void {
    this.node.textContent = message;
  }

  clear(): void {
    this.node.textContent = '';
  }
}

type CopyMap = Record<string, string | undefined>;

/** Turns one API failure into the published copy for its own live region. */
export function failureCopy(failure: Failure, specific: CopyMap): string {
  if (failure.code === 'network') return NETWORK_COPY;
  if (failure.status >= 500 && failure.code !== 'storage_unavailable' && failure.code !== 'billing_unavailable') {
    return SERVER_COPY;
  }
  const own = specific[failure.code];
  if (own !== undefined) return own;
  if (failure.code === 'validation') return FIELDS_COPY;
  return failure.message;
}

/** Runs one async action with its button disabled and its region announcing each step. */
export async function withPending<T>(
  region: Region,
  button: HTMLButtonElement | null,
  pending: string,
  run: () => Promise<T>,
): Promise<T> {
  if (button) button.disabled = true;
  region.say(pending);
  try {
    return await run();
  } finally {
    if (button) button.disabled = false;
  }
}
