const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
export const RESERVED_USERNAMES: readonly string[] = ['halfpenny', 'postmaster', 'airfold'];

type UsernameSyntaxReason = 'length' | 'characters' | 'first_character' | 'last_character';
export type UsernameReason = UsernameSyntaxReason | 'taken';

export function normalizeUsername(input: string): string {
  return input.toLowerCase();
}

/** The one place the username rules are decided. `name` is already lowercased. */
export function usernameSyntaxProblem(name: string): UsernameSyntaxReason | null {
  const length = Array.from(name).length;
  if (length < USERNAME_MIN || length > USERNAME_MAX) return 'length';
  if (!/^[a-z0-9_.]+$/.test(name)) return 'characters';
  if (!/^[a-z]/.test(name)) return 'first_character';
  if (name.endsWith('.')) return 'last_character';
  return null;
}
