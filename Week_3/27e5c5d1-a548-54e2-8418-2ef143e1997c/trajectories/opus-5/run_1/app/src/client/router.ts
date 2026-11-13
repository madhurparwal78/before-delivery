export interface Address {
  kind: 'signin' | 'home' | 'board' | 'card' | 'permissionLog' | 'unknown';
  boardId?: string;
  cardId?: string;
  workspaceId?: string;
  listId?: string | null;
  next?: string | null;
}

export function readAddress(): Address {
  const url = new URL(window.location.href);
  const parts = url.pathname.split('/').filter((part) => part.length > 0);
  const listId = url.searchParams.get('list');
  if (parts.length === 0) return { kind: 'home', listId };
  if (parts.length === 1 && parts[0] === 'signin') return { kind: 'signin', next: url.searchParams.get('next') };
  if (parts.length === 2 && parts[0] === 'boards') return { kind: 'board', boardId: parts[1], listId };
  if (parts.length === 2 && parts[0] === 'cards') return { kind: 'card', cardId: parts[1] };
  if (parts.length === 3 && parts[0] === 'workspaces' && parts[2] === 'permission-log') {
    return { kind: 'permissionLog', workspaceId: parts[1] };
  }
  return { kind: 'unknown' };
}

export function boardPath(boardId: string | null, listId: string | null): string {
  const base = boardId === null ? '/' : `/boards/${boardId}`;
  if (listId === null || window.innerWidth >= 1200) return base;
  return `${base}?list=${encodeURIComponent(listId)}`;
}

export function push(path: string): void {
  window.history.pushState({}, '', path);
}

export function replace(path: string): void {
  window.history.replaceState({}, '', path);
}

export function signInPath(): string {
  const url = new URL(window.location.href);
  const target = `${url.pathname}${url.search}`;
  if (url.pathname === '/') return '/signin';
  return `/signin?next=${encodeURIComponent(target)}`;
}

export function onNavigate(handler: () => void): void {
  window.addEventListener('popstate', handler);
}
