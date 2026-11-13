/** The one place that decides whether a return path may be followed after sign-in. */
export function safeReturnPath(next: unknown): string {
  if (typeof next !== 'string') return '/';
  if (next.length > 2000) return '/';
  if (!next.startsWith('/')) return '/';
  const second = next[1];
  if (second === '/' || second === '\\') return '/';
  if (next.includes('\\')) return '/';
  for (const character of next) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return '/';
  }
  return next;
}
