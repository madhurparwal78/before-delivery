/** Random request identifiers for idempotent actions. */

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
