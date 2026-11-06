/** The return-path rule: a `next` is used only when it is a plain same-site path. */
export function safeNextPath(next: string | null): string {
  if (next === null || next.length === 0) return '/bookings';
  if (!next.startsWith('/')) return '/';
  if (next[1] === '/' || next[1] === '\\') return '/';
  if (next.includes('\\')) return '/';
  for (const character of next) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return '/';
  }
  return next;
}

export const SESSION_ENDED_KEY = 'pakka.session-ended';
