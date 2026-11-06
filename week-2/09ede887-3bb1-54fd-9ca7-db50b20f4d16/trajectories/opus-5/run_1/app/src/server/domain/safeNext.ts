/**
 * `next` is accepted only when it starts with exactly one `/` and its second
 * character is neither `/` nor `\`. Everything else lands on `/agenda`.
 */
export function safeNext(next: string | null | undefined): string {
  if (next === null || next === undefined) return '/agenda';
  if (!next.startsWith('/')) return '/agenda';
  const second = next[1];
  if (second === '/' || second === '\\') return '/agenda';
  return next;
}
