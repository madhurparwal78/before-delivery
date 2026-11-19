// Screen routing: parse the location, decide which screen to render, and follow the
// sign-in `next` rule in exactly one place.

export type Screen =
  | { name: 'pegboard' }
  | { name: 'signin'; next: string | null }
  | { name: 'join' }
  | { name: 'account' }
  | { name: 'loan'; id: number }
  | { name: 'fee'; id: number }
  | { name: 'desk' }
  | { name: 'office' }
  | { name: 'notfound' };

export function parseScreen(path: string): Screen {
  if (path === '/' || path === '') return { name: 'pegboard' };
  if (path === '/signin') return { name: 'signin', next: null };
  if (path === '/join') return { name: 'join' };
  if (path === '/account') return { name: 'account' };
  if (path === '/desk') return { name: 'desk' };
  if (path === '/office') return { name: 'office' };
  const loan = /^\/loans\/(\d+)$/.exec(path);
  if (loan !== null) return { name: 'loan', id: Number(loan[1]) };
  const fee = /^\/fees\/(\d+)$/.exec(path);
  if (fee !== null) return { name: 'fee', id: Number(fee[1]) };
  return { name: 'notfound' };
}

/** The sign-in form's next parameter, percent-encoded by the sender. */
export function signInNext(path: string): string {
  return `/signin?next=${encodeURIComponent(path)}`;
}

export function readNextParam(search: string): string | null {
  const params = new URLSearchParams(search);
  const next = params.get('next');
  return next;
}

/**
 * Whether a decoded next path is followed after sign-in: it must be the Pegboard or a
 * published screen path the role may use, with no scheme, host, query or fragment.
 */
export function nextAllowed(next: string, role: 'coordinator' | 'volunteer' | 'member'): string | null {
  if (!next.startsWith('/') || next.length < 2) return null;
  if (next[1] === '/' || next[1] === '\\') return null;
  const illegal = next.slice(1);
  if (illegal.includes(':') || illegal.includes('?') || illegal.includes('#')) return null;
  if (next === '/') return '/';
  const loan = /^\/loans\/(\d+)$/.exec(next);
  if (loan !== null) return next;
  const fee = /^\/fees\/(\d+)$/.exec(next);
  if (fee !== null) return next;
  if (next === '/account' && role === 'member') return next;
  if (next === '/desk' && (role === 'volunteer' || role === 'coordinator')) return next;
  if (next === '/office' && role === 'coordinator') return next;
  return null;
}

/** The role's landing path. */
export function landingPath(role: 'coordinator' | 'volunteer' | 'member'): string {
  if (role === 'coordinator') return '/office';
  if (role === 'volunteer') return '/desk';
  return '/account';
}

/** Whether a path is one of the protected screens that bounce signed-out visitors to sign-in. */
export function isProtectedPath(path: string): boolean {
  if (path === '/account' || path === '/desk' || path === '/office') return true;
  if (/^\/loans\/\d+$/.test(path)) return true;
  if (/^\/fees\/\d+$/.test(path)) return true;
  return false;
}
