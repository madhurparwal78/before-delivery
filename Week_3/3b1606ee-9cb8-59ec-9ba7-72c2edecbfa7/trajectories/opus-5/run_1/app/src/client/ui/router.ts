export type RouteName =
  | 'landing'
  | 'signup'
  | 'signin'
  | 'letters'
  | 'conversation'
  | 'requests'
  | 'contacts'
  | 'settings'
  | 'unknown';

export interface Route {
  name: RouteName;
  path: string;
  conversationId: string | null;
}

const CONVERSATION = /^\/letters\/([0-9a-f-]{36})$/;

export function parseRoute(path: string): Route {
  const conversation = CONVERSATION.exec(path);
  if (conversation !== null) {
    return { name: 'conversation', path, conversationId: conversation[1] as string };
  }
  const names: Record<string, RouteName> = {
    '/': 'landing',
    '/signup': 'signup',
    '/signin': 'signin',
    '/letters': 'letters',
    '/requests': 'requests',
    '/contacts': 'contacts',
    '/settings': 'settings',
  };
  return { name: names[path] ?? 'unknown', path, conversationId: null };
}

let listener: ((route: Route) => void) | null = null;

export function currentRoute(): Route {
  return parseRoute(location.pathname);
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace === true) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  listener?.(currentRoute());
}

export function startRouter(onChange: (route: Route) => void): void {
  listener = onChange;
  window.addEventListener('popstate', () => onChange(currentRoute()));
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (anchor === null || anchor === undefined) return;
    const href = anchor.getAttribute('href');
    if (href === null || !href.startsWith('/')) return;
    event.preventDefault();
    navigate(href);
  });
  onChange(currentRoute());
}
