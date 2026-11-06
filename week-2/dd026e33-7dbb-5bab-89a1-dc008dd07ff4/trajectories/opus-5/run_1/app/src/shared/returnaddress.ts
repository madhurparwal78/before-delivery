/** The single decision on whether a return address may be honoured. */
export function honouredNext(next: string | null | undefined): string | null {
  if (typeof next !== 'string' || next.length === 0) return null;
  let decoded = next;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/')) return null;
  const second = decoded.charAt(1);
  if (second === '' || second === '/' || second === '\\') return null;
  if (decoded.includes('\\')) return null;
  for (const character of decoded) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return null;
  }
  const path = decoded.split(/[?#]/)[0] ?? '';
  if (path === '/api' || path.startsWith('/api/')) return null;
  if (path === '/sign-in' || path.startsWith('/sign-in/')) return null;
  return decoded;
}
