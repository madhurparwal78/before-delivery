import type { Route } from './app.ts';

interface Match {
  route: Route;
  params: Record<string, string>;
}

/** Literal segments beat `:parameter` segments, so `/sources/preview` wins over `/sources/:id`. */
export function match(routes: readonly Route[], method: string, pathname: string): Match | null {
  const parts = pathname.split('/');
  let best: (Match & { literals: number }) | null = null;
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split('/');
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let literals = 0;
    let ok = true;
    for (let i = 0; i < pattern.length && ok; i++) {
      const want = pattern[i] ?? '';
      const got = parts[i] ?? '';
      if (want.startsWith(':')) {
        try {
          params[want.slice(1)] = decodeURIComponent(got);
        } catch {
          ok = false;
        }
        if (got === '') ok = false;
      } else if (want === got) literals++;
      else ok = false;
    }
    if (ok && (best === null || literals > best.literals)) best = { route, params, literals };
  }
  return best && { route: best.route, params: best.params };
}
