// Page addresses, shared so the server decides the status code of each address and the browser
// renders the same screen for it.

export type PageRoute =
  | { name: 'home' }
  | { name: 'signup' }
  | { name: 'login' }
  | { name: 'confirm'; token: string }
  | { name: 'inbox' }
  | { name: 'repos' }
  | { name: 'org'; org: string }
  | { name: 'repo'; org: string; repo: string }
  | { name: 'blob'; org: string; repo: string; branch: string; path: string }
  | { name: 'edit'; org: string; repo: string; branch: string; path: string }
  | { name: 'revision'; org: string; repo: string; id: string }
  | { name: 'changes'; org: string; repo: string }
  | { name: 'newChange'; org: string; repo: string }
  | { name: 'change'; org: string; repo: string; number: number }
  | { name: 'queue'; org: string; repo: string }
  | { name: 'settings'; org: string; repo: string };

export const RESERVED_SLUGS = ['inbox', 'repos', 'login', 'signup', 'confirm', 'api', 'assets', 'fonts'];

export function parsePath(pathname: string): PageRoute | null {
  const parts = pathname.split('/').filter((part) => part !== '').map((part) => decodeURIComponent(part));
  const [a, b, c, d, ...rest] = parts;
  if (pathname.length > 1 && pathname.endsWith('/')) return null;
  if (parts.length === 0) return { name: 'home' };
  if (parts.length === 1) {
    if (a === 'signup' || a === 'login' || a === 'inbox' || a === 'repos') return { name: a };
    return RESERVED_SLUGS.includes(a) ? null : { name: 'org', org: a };
  }
  if (a === 'confirm' && parts.length === 2) return { name: 'confirm', token: b };
  if (RESERVED_SLUGS.includes(a)) return null;
  if (parts.length === 2) return { name: 'repo', org: a, repo: b };
  if (c === 'blob' && d && parts.length >= 5) return { name: 'blob', org: a, repo: b, branch: d, path: rest.join('/') };
  if (c === 'edit' && d && parts.length >= 5) return { name: 'edit', org: a, repo: b, branch: d, path: rest.join('/') };
  if (parts.length === 4 && c === 'revisions') return { name: 'revision', org: a, repo: b, id: d };
  if (parts.length === 3 && c === 'changes') return { name: 'changes', org: a, repo: b };
  if (parts.length === 4 && c === 'changes' && d === 'new') return { name: 'newChange', org: a, repo: b };
  if (parts.length === 4 && c === 'changes' && /^[1-9][0-9]*$/.test(d)) return { name: 'change', org: a, repo: b, number: Number(d) };
  if (parts.length === 3 && c === 'queue') return { name: 'queue', org: a, repo: b };
  if (parts.length === 3 && c === 'settings') return { name: 'settings', org: a, repo: b };
  return null;
}
