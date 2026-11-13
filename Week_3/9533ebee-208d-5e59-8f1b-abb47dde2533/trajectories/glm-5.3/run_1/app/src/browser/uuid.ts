export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export function randomKey(): string {
  return globalThis.crypto.randomUUID();
}
