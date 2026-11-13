export const IDEMPOTENCY_MIN = 1;

/** Two requests under one key are the same when they target the same round and their JSON bodies are equal after parsing. */
export function sameIdempotentRequest(
  storedRound: number,
  storedBody: unknown,
  round: number,
  body: unknown,
): boolean {
  if (storedRound !== round) return false;
  return jsonEqual(storedBody, body);
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!jsonEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    for (const key of ak) {
      if (!jsonEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
    }
    return true;
  }
  return false;
}
