/** The `next` check and the published landing addresses. */

export function isValidNext(next: string | null | undefined): next is string {
  if (typeof next !== 'string' || next.length === 0) return false;
  if (next[0] !== '/') return false;
  const second = next[1];
  if (second === '/' || second === '\\') return false;
  if (next.includes('\\')) return false;
  for (const char of next) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export function signInPathFor(pathAndQuery: string): string {
  return `/signin?next=${encodeURIComponent(pathAndQuery)}`;
}

export function pagePath(diagramId: string, pageId: string): string {
  return `/d/${diagramId}/p/${pageId}`;
}

export function invitePath(token: string): string {
  return `/invite/${token}`;
}
