// Username rules, decided here and nowhere else. DP-01.
export type UsernameReason =
  | 'length'
  | 'characters'
  | 'first_character'
  | 'last_character'
  | 'taken';

export type UsernameCheck =
  | { username: string; available: true; reason: null }
  | { username: string; available: false; reason: Exclude<UsernameReason, null> };

const RESERVED = new Set(['halfpenny', 'postmaster', 'airfold']);
const PATTERN = /^[a-z0-9_.]+$/;
const FIRST = /^[a-z]/;
const LAST = /[^.]$/;

// Checks shape in the published order; `taken` (which needs the database) is added by the caller.
export function usernameShape(input: string): { reason: Exclude<UsernameReason, 'taken'> | null; username: string } {
  const username = input.toLowerCase();
  if (username.length < 3 || username.length > 32) return { reason: 'length', username };
  if (!PATTERN.test(username)) return { reason: 'characters', username };
  if (!FIRST.test(username)) return { reason: 'first_character', username };
  if (!LAST.test(username)) return { reason: 'last_character', username };
  return { reason: null, username };
}

export function isReserved(username: string): boolean {
  return RESERVED.has(username.toLowerCase());
}

export function availabilityReason(username: string): Exclude<UsernameReason, 'taken'> | null {
  return usernameShape(username).reason;
}
