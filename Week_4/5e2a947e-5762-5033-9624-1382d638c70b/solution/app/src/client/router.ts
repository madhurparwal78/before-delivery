import { signal } from './signal.ts';

const here = (): string => `${window.location.pathname}${window.location.search}`;

/** The current location as a reactive value. */
export const location$ = signal(here());

window.addEventListener('popstate', () => location$.set(here()));

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === here()) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  location$.set(here());
}

type Route =
  | { page: 'home' }
  | { page: 'signup' }
  | { page: 'signin' }
  | { page: 'maps' }
  | { page: 'editor'; mapId: string }
  | { page: 'version'; mapId: string; versionId: string }
  | { page: 'share'; code: string }
  | { page: 'audience'; code: string }
  | { page: 'missing' };

export function parseRoute(path: string): Route {
  const [pathname = '/'] = path.split('?');
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [first, second, third, fourth] = parts;
  if (parts.length === 0) return { page: 'home' };
  if (parts.length === 1 && first === 'signup') return { page: 'signup' };
  if (parts.length === 1 && first === 'signin') return { page: 'signin' };
  if (parts.length === 1 && first === 'maps') return { page: 'maps' };
  if (first === 'm' && second && parts.length === 2) return { page: 'editor', mapId: second };
  if (first === 'm' && second && third === 'versions' && fourth && parts.length === 4) return { page: 'version', mapId: second, versionId: fourth };
  if (first === 's' && second && parts.length === 2) return { page: 'share', code: second };
  if (first === 'p' && second && parts.length === 2) return { page: 'audience', code: second };
  return { page: 'missing' };
}
