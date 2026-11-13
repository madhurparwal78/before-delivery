import { useEffect, useState, useCallback } from 'react';
import { api, type SessionUser, type Board, type PostsListing } from './api.js';
import { Landing } from './Landing.js';
import { AuthPage } from './AuthPage.js';
import { Dashboard } from './Dashboard.js';
import { BoardScreen } from './BoardScreen.js';
import { NotFoundScreen, PasswordScreen } from './StateScreens.js';
import { InvitePage } from './InvitePage.js';
import type { JSX } from 'react';

export interface RouteInfo {
  kind: 'landing' | 'signin' | 'signup' | 'dashboard' | 'board' | 'share' | 'embed' | 'invite' | 'unknown';
  id: string;
}

export function parseRoute(pathname: string): RouteInfo {
  if (pathname === '/' || pathname === '') return { kind: 'landing', id: '' };
  if (pathname === '/signin') return { kind: 'signin', id: '' };
  if (pathname === '/signup') return { kind: 'signup', id: '' };
  const boardMatch = /^\/b\/([^/]+)$/.exec(pathname);
  if (boardMatch) return { kind: 'board', id: boardMatch[1]! };
  const shareMatch = /^\/s\/([^/]+)$/.exec(pathname);
  if (shareMatch) return { kind: 'share', id: shareMatch[1]! };
  const embedMatch = /^\/embed\/([^/]+)$/.exec(pathname);
  if (embedMatch) return { kind: 'embed', id: embedMatch[1]! };
  const inviteMatch = /^\/invite\/([^/]+)$/.exec(pathname);
  if (inviteMatch) return { kind: 'invite', id: inviteMatch[1]! };
  return { kind: 'unknown', id: '' };
}

export interface Me {
  user: SessionUser | null;
  loading: boolean;
}

export function App(): JSX.Element {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<RouteInfo>(() => parseRoute(location.pathname));

  const refresh = useCallback(() => {
    setRoute(parseRoute(location.pathname));
  }, []);

  useEffect(() => {
    const onPop = () => refresh();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [refresh]);

  useEffect(() => {
    api<{ user: SessionUser }>('/api/me')
      .then((r) => setMe(r.user))
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  const navigate = useCallback(
    (path: string) => {
      history.pushState(null, '', path);
      refresh();
    },
    [refresh],
  );

  if (loading) return <p className="empty-line">Loading…</p>;

  if (route.kind === 'signin') return <AuthPage mode="signin" me={me} navigate={navigate} onSignedIn={(u) => setMe(u)} />;
  if (route.kind === 'signup') return <AuthPage mode="signup" me={me} navigate={navigate} onSignedIn={(u) => setMe(u)} />;
  if (route.kind === 'dashboard' || route.kind === 'landing') {
    if (me) return <Dashboard me={me} navigate={navigate} onSignedOut={() => setMe(null)} />;
    return <Landing navigate={navigate} />;
  }
  if (route.kind === 'board') {
    return <BoardScreen boardId={route.id} me={me} navigate={navigate} mode="board" onSignedOut={() => setMe(null)} />;
  }
  if (route.kind === 'share') {
    return <BoardScreen boardId={route.id} me={me} navigate={navigate} mode="share" onSignedOut={() => setMe(null)} />;
  }
  if (route.kind === 'embed') {
    return <BoardScreen boardId={route.id} me={me} navigate={navigate} mode="embed" onSignedOut={() => setMe(null)} />;
  }
  if (route.kind === 'invite') {
    return <InvitePage token={route.id} me={me} navigate={navigate} />;
  }
  return <NotFoundScreen navigate={navigate} me={me} />;
}

export type BoardData = { board: Board; posts: PostsListing };
