import { ApiFailure, request } from './api.js';

type Guards = { sessionEnded: () => void; signedOut: () => void };

let guards: Guards = { sessionEnded: () => undefined, signedOut: () => undefined };

export function setGuards(next: Guards): void {
  guards = next;
}

/** Every desk request goes through here, so the two 401s are told apart in one place. */
export async function call<T>(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<T> {
  try {
    return await request<T>(path, options);
  } catch (error) {
    if (error instanceof ApiFailure) {
      if (error.code === 'session_ended') guards.sessionEnded();
      if (error.code === 'signed_out') guards.signedOut();
    }
    throw error;
  }
}

export function currentRoute(): string {
  return `${window.location.pathname}${window.location.search}`;
}
