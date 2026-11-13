/**
 * The landing rule: `next` is used only when it is a path starting with a single `/`,
 * whose second character is neither `/` nor `\`, and that carries no scheme.
 */
export const landingPath = (next: unknown): string => {
  if (typeof next !== 'string') return '/account';
  if (!next.startsWith('/')) return '/account';
  const second = next[1];
  if (second === '/' || second === '\\') return '/account';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(next.slice(1))) return '/account';
  return next;
};
