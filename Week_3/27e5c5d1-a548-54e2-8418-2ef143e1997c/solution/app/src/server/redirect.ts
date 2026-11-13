import { CONTROL_CHARACTERS } from '../shared/text.ts';

/** The safe return path: one leading slash, no backslash, no control character, at most 2,000 characters. */
export function safeReturnPath(next: unknown): string {
  if (typeof next !== 'string') return '/';
  const safe =
    next.length <= 2000 &&
    next.startsWith('/') &&
    next[1] !== '/' &&
    next[1] !== '\\' &&
    !next.includes('\\') &&
    !CONTROL_CHARACTERS.test(next);
  return safe ? next : '/';
}
