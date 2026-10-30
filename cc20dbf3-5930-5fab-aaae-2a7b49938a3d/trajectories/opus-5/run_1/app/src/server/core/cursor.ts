import { signPayload, verifyPayload } from './signing.js';

/** A cursor marks a position in a list's order and nothing else. */
export interface CursorPosition {
  readonly instant: string;
  readonly id: string;
}

export function encodeCursor(secret: Buffer, kind: 'holds' | 'loans', position: CursorPosition): string {
  return signPayload(secret, JSON.stringify([kind, position.instant, position.id]));
}

export function decodeCursor(
  secret: Buffer,
  kind: 'holds' | 'loans',
  cursor: string,
): CursorPosition | null {
  const payload = verifyPayload(secret, cursor);
  if (payload === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) return null;
  const [parsedKind, instant, id] = parsed as unknown[];
  if (parsedKind !== kind || typeof instant !== 'string' || typeof id !== 'string') return null;
  if (Number.isNaN(Date.parse(instant))) return null;
  return { instant, id };
}
