import { freshKey } from './api.js';

const retained = new Map<string, string>();

/**
 * A press that was refused because billing is down keeps its Idempotency-Key, so
 * pressing the same button for the same row or values retries the same request.
 */
export function keyFor(action: string): string {
  const existing = retained.get(action);
  if (existing !== undefined) return existing;
  const key = freshKey();
  retained.set(action, key);
  return key;
}

export function retainKey(action: string): void {
  if (!retained.has(action)) retained.set(action, freshKey());
}

export function dropKey(action: string): void {
  retained.delete(action);
}
