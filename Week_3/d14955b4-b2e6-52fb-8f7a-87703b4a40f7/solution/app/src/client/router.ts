import { useSyncExternalStore } from 'react';
import { THREAD_STATUSES } from '../shared/types.js';
import type { ThreadStatus } from '../shared/types.js';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const snapshot = (): string => `${window.location.pathname}${window.location.search}`;

export function useLocation(): string {
  return useSyncExternalStore(subscribe, snapshot);
}

export function navigate(url: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  for (const listener of listeners) listener();
}

export interface InboxRoute {
  status: ThreadStatus;
  q: string;
  threadId: string | null;
}

export function inboxUrl(route: InboxRoute): string {
  const params = new URLSearchParams();
  if (route.status !== 'waiting') params.set('status', route.status);
  if (route.q !== '') params.set('q', route.q);
  const query = params.toString();
  return `${route.threadId ? `/inbox/${encodeURIComponent(route.threadId)}` : '/inbox'}${query ? `?${query}` : ''}`;
}

export function parseInbox(location: string): { route: InboxRoute; statusKnown: boolean } {
  const url = new URL(location, window.location.origin);
  const raw = url.searchParams.get('status') ?? 'waiting';
  const statusKnown = (THREAD_STATUSES as readonly string[]).includes(raw);
  const id = /^\/inbox\/([^/]+)$/.exec(url.pathname)?.[1];
  return {
    route: { status: statusKnown ? (raw as ThreadStatus) : 'waiting', q: url.searchParams.get('q') ?? '', threadId: id ? decodeURIComponent(id) : null },
    statusKnown,
  };
}
