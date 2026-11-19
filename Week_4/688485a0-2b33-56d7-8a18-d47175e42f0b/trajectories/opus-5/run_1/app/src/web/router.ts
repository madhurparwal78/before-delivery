import { useEffect, useState } from 'react';

export type Section = 'documents' | 'queries' | 'pipeline' | 'indexes' | 'schema' | 'rules' | 'members';

export type Route =
  | { name: 'landing' }
  | { name: 'signup' }
  | { name: 'confirm' }
  | { name: 'signin' }
  | { name: 'projects' }
  | { name: 'invites' }
  | { name: 'project'; pid: string }
  | { name: 'members'; pid: string }
  | { name: 'documents'; pid: string; cid: string; did: string | null }
  | { name: 'queries'; pid: string; cid: string }
  | { name: 'pipeline'; pid: string; cid: string }
  | { name: 'indexes'; pid: string; cid: string }
  | { name: 'schema'; pid: string; cid: string }
  | { name: 'rules'; pid: string; cid: string }
  | { name: 'notfound' };

const COLLECTION_SECTIONS: Record<string, Route['name']> = {
  queries: 'queries',
  pipeline: 'pipeline',
  indexes: 'indexes',
  schema: 'schema',
  rules: 'rules',
};

export function parseRoute(pathname: string): Route {
  const parts = pathname.replace(/\/+$/, '').split('/').filter((part) => part.length > 0);
  if (parts.length === 0) return { name: 'landing' };
  if (parts.length === 1) {
    if (parts[0] === 'signup') return { name: 'signup' };
    if (parts[0] === 'confirm') return { name: 'confirm' };
    if (parts[0] === 'signin') return { name: 'signin' };
    if (parts[0] === 'projects') return { name: 'projects' };
    if (parts[0] === 'invites') return { name: 'invites' };
    return { name: 'notfound' };
  }
  if (parts[0] !== 'p') return { name: 'notfound' };
  const pid = parts[1];
  if (parts.length === 2) return { name: 'project', pid };
  if (parts.length === 3 && parts[2] === 'members') return { name: 'members', pid };
  if (parts[2] !== 'c') return { name: 'notfound' };
  const cid = parts[3];
  if (parts.length === 4) return { name: 'documents', pid, cid, did: null };
  if (parts.length === 6 && parts[4] === 'd') return { name: 'documents', pid, cid, did: parts[5] };
  if (parts.length === 5) {
    const section = COLLECTION_SECTIONS[parts[4]];
    if (section === 'queries') return { name: 'queries', pid, cid };
    if (section === 'pipeline') return { name: 'pipeline', pid, cid };
    if (section === 'indexes') return { name: 'indexes', pid, cid };
    if (section === 'schema') return { name: 'schema', pid, cid };
    if (section === 'rules') return { name: 'rules', pid, cid };
  }
  return { name: 'notfound' };
}

const ROUTE_EVENT = 'jarful:route';

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

export function useRoute(): { route: Route; path: string; search: string } {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));
  useEffect(() => {
    const update = (): void => setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener(ROUTE_EVENT, update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener(ROUTE_EVENT, update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return { route: parseRoute(location.path), path: location.path, search: location.search };
}

export function sectionOf(route: Route): Section | null {
  switch (route.name) {
    case 'documents':
      return 'documents';
    case 'queries':
      return 'queries';
    case 'pipeline':
      return 'pipeline';
    case 'indexes':
      return 'indexes';
    case 'schema':
      return 'schema';
    case 'rules':
      return 'rules';
    case 'members':
      return 'members';
    default:
      return null;
  }
}

export const SECTION_LABELS: Record<Section, string> = {
  documents: 'Documents',
  queries: 'Query',
  pipeline: 'Pipeline',
  indexes: 'Indexes',
  schema: 'Schema',
  rules: 'Rules',
  members: 'Members',
};
