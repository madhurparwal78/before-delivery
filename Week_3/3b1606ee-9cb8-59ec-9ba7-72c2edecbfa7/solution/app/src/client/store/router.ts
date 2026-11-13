import { getState, setState } from './state';

export type Route =
  | { name: 'landing' }
  | { name: 'signup' }
  | { name: 'signin' }
  | { name: 'letters' }
  | { name: 'conversation'; id: string }
  | { name: 'requests' }
  | { name: 'contacts' }
  | { name: 'settings' }
  | { name: 'unknown' };

export function parseRoute(path: string): Route {
  if (path === '/') return { name: 'landing' };
  if (path === '/signup') return { name: 'signup' };
  if (path === '/signin') return { name: 'signin' };
  if (path === '/letters') return { name: 'letters' };
  const conversation = /^\/letters\/([^/]+)$/.exec(path);
  if (conversation) return { name: 'conversation', id: conversation[1]! };
  if (path === '/requests') return { name: 'requests' };
  if (path === '/contacts') return { name: 'contacts' };
  if (path === '/settings') return { name: 'settings' };
  return { name: 'unknown' };
}

let navigated = false;

/** True once a person has moved between screens in this page, so motion that must not run on load can run. */
export const hasNavigated = (): boolean => navigated;

export function navigate(path: string, replace = false): void {
  if (path === location.pathname + location.search) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  navigated = true;
  setState({ route: location.pathname });
}

window.addEventListener('popstate', () => {
  navigated = true;
  if (getState().route !== location.pathname) setState({ route: location.pathname });
});
