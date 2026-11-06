import { useEffect, useState } from 'react';

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return path;
}

export interface RouteMatch {
  name: 'signin' | 'list' | 'workbook' | 'station' | 'invite' | 'share' | 'unknown';
  param: string;
}

export function matchRoute(path: string): RouteMatch {
  if (path === '/signin') return { name: 'signin', param: '' };
  if (path === '/') return { name: 'list', param: '' };
  if (path === '/station') return { name: 'station', param: '' };
  const workbook = /^\/w\/([^/]+)$/.exec(path);
  if (workbook) return { name: 'workbook', param: workbook[1] };
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  if (invite) return { name: 'invite', param: invite[1] };
  const share = /^\/s\/([^/]+)$/.exec(path);
  if (share) return { name: 'share', param: share[1] };
  return { name: 'unknown', param: '' };
}
