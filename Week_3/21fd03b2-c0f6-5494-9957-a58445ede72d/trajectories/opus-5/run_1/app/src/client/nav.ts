import { useEffect, useState } from 'react';

const listeners = new Set<() => void>();

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  for (const listener of listeners) listener();
}

window.addEventListener('popstate', () => {
  for (const listener of listeners) listener();
});

export interface Location {
  path: string;
  search: URLSearchParams;
}

export function useLocation(): Location {
  const read = (): Location => ({
    path: window.location.pathname,
    search: new URLSearchParams(window.location.search),
  });
  const [location, setLocation] = useState<Location>(read);
  useEffect(() => {
    const listener = (): void => setLocation(read());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return location;
}

export type RouteName =
  | 'landing'
  | 'sign-in'
  | 'sign-up'
  | 'new-workspace'
  | 'workspace'
  | 'project'
  | 'editor'
  | 'settings'
  | 'activity'
  | 'invite'
  | 'lab'
  | 'view-project'
  | 'view-scene'
  | 'not-found';

export interface Match {
  name: RouteName;
  params: Record<string, string>;
}

const PATTERNS: readonly { name: RouteName; pattern: RegExp; keys: string[] }[] = [
  { name: 'landing', pattern: /^\/$/, keys: [] },
  { name: 'sign-in', pattern: /^\/sign-in$/, keys: [] },
  { name: 'sign-up', pattern: /^\/sign-up$/, keys: [] },
  { name: 'new-workspace', pattern: /^\/workspaces\/new$/, keys: [] },
  { name: 'settings', pattern: /^\/w\/([^/]+)\/settings$/, keys: ['wid'] },
  { name: 'activity', pattern: /^\/w\/([^/]+)\/activity$/, keys: ['wid'] },
  { name: 'project', pattern: /^\/w\/([^/]+)\/p\/([^/]+)$/, keys: ['wid', 'pid'] },
  { name: 'editor', pattern: /^\/w\/([^/]+)\/s\/([^/]+)$/, keys: ['wid', 'sid'] },
  { name: 'workspace', pattern: /^\/w\/([^/]+)$/, keys: ['wid'] },
  { name: 'invite', pattern: /^\/invite\/([^/]+)$/, keys: ['token'] },
  { name: 'lab', pattern: /^\/lab\/([^/]+)$/, keys: ['token'] },
  { name: 'view-scene', pattern: /^\/view\/([^/]+)\/s\/([^/]+)$/, keys: ['token', 'sid'] },
  { name: 'view-project', pattern: /^\/view\/([^/]+)$/, keys: ['token'] },
];

export function matchPath(path: string): Match {
  for (const route of PATTERNS) {
    const found = route.pattern.exec(path);
    if (!found) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(found[index + 1]);
    });
    return { name: route.name, params };
  }
  return { name: 'not-found', params: {} };
}
