import { useSyncExternalStore } from 'react';

type Route =
  | { kind: 'signin'; next: string | null }
  | { kind: 'home' }
  | { kind: 'board'; boardId: string; list: string | null }
  | { kind: 'card'; cardId: string }
  | { kind: 'log'; workspaceId: string }
  | { kind: 'unknown' };

export function parseRoute(path: string, search: string): Route {
  const query = new URLSearchParams(search);
  if (path === '/signin') return { kind: 'signin', next: query.get('next') };
  if (path === '/') return { kind: 'home' };
  const board = /^\/boards\/([^/]+)$/.exec(path);
  if (board) return { kind: 'board', boardId: board[1] ?? '', list: query.get('list') };
  const card = /^\/cards\/([^/]+)$/.exec(path);
  if (card) return { kind: 'card', cardId: card[1] ?? '' };
  const log = /^\/workspaces\/([^/]+)\/permission-log$/.exec(path);
  if (log) return { kind: 'log', workspaceId: log[1] ?? '' };
  return { kind: 'unknown' };
}

const listeners = new Set<() => void>();
let snapshot = location.pathname + location.search;

function changed(): void {
  snapshot = location.pathname + location.search;
  for (const listener of listeners) listener();
}

window.addEventListener('popstate', changed);

interface HistoryMark {
  /** The card entry was pushed from a board address, so closing it can go back. */
  fromBoard?: string;
}

export function navigate(path: string, options: { replace?: boolean; mark?: HistoryMark } = {}): void {
  if (options.replace) history.replaceState(options.mark ?? null, '', path);
  else history.pushState(options.mark ?? null, '', path);
  changed();
}

export const historyMark = (): HistoryMark | null => history.state as HistoryMark | null;

export function useAddress(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

export function useRoute(): Route {
  const address = useAddress();
  const at = address.indexOf('?');
  return parseRoute(at < 0 ? address : address.slice(0, at), at < 0 ? '' : address.slice(at));
}
