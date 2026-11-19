const handlePattern = /^[a-z0-9-]{3,24}$/;
const slugPattern = /^[a-z0-9-]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isOwnScreen(path: string): boolean {
  if (path === '/explore') {
    return true;
  }
  const segments = path.slice(1).split('/');
  if (segments[0].startsWith('@')) {
    return segments.length === 1 && handlePattern.test(segments[0].slice(1));
  }
  if (segments[0] === 'c') {
    return segments.length === 2 && uuidPattern.test(segments[1]);
  }
  if (segments[0] === 'w') {
    return segments.length >= 2 && slugPattern.test(segments[1]) && segments.slice(2).every((part) => part !== '');
  }
  return false;
}

/** The one place that decides whether a `next` value may be returned to after sign in or sign up. */
export function isReturnableNext(next: string): boolean {
  if (!next.startsWith('/') || next.length < 2) {
    return false;
  }
  if (next[1] === '/' || next[1] === '\\') {
    return false;
  }
  if (next.includes('\\')) {
    return false;
  }
  const lowered = next.toLowerCase();
  if (lowered.includes('%5c') || lowered.includes('%2f%2f')) {
    return false;
  }
  for (const character of next) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  const path = next.split(/[?#]/)[0];
  return isOwnScreen(path);
}
