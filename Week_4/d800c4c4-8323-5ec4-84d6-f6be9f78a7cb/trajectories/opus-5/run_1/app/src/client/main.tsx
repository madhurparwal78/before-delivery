import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NOT_FOUND_HEADING } from '../shared/copy';
import { landingPath, roleMayUseScreen, screenForPath } from '../shared/screens';
import type { BoardRead, CalendarRead, StatusRead } from '../shared/types';
import { Shell } from './components/Shell';
import { api, ApiFailed } from './lib/api';
import { AppProvider, type AppState, type NavigateOptions, type Viewer } from './lib/app-context';
import { saveDraft, type ScreenDraft } from './lib/draft';
import { usePoll, useReducedMotion } from './lib/hooks';
import { Account } from './screens/Account';
import { Desk } from './screens/Desk';
import { FeeScreen } from './screens/FeeScreen';
import { Join } from './screens/Join';
import { LoanScreen } from './screens/LoanScreen';
import { Office } from './screens/Office';
import { Pegboard } from './screens/Pegboard';
import { SignIn } from './screens/SignIn';

const ALL_WELL: StatusRead = { storage: 'up', billing: 'up' };

function NotFound(): JSX.Element {
  return (
    <>
      <h1>{NOT_FOUND_HEADING}</h1>
      <a href="/">Back to the pegboard</a>
    </>
  );
}

function App(): JSX.Element {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [viewerLoaded, setViewerLoaded] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [sessionEnded, setSessionEnded] = useState(false);
  const [joinLanding, setJoinLanding] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState<ScreenDraft | null>(null);
  const [statusFast, setStatusFast] = useState(false);
  const reducedMotion = useReducedMotion();
  const pendingAnnouncement = useRef<string | null>(null);

  const screen = screenForPath(location.path);
  const onDesk = screen.kind === 'desk';

  const status = usePoll<StatusRead>('/api/status', statusFast ? 1000 : 10000);
  const board = usePoll<BoardRead>('/api/board', onDesk ? 2000 : 10000);
  const calendar = usePoll<CalendarRead>('/api/calendar', 10000);

  const reloadViewer = useCallback(async () => {
    try {
      const read = await api.get<Viewer>('/api/me');
      setViewer(read);
    } catch (error) {
      if (error instanceof ApiFailed && error.status === 401) setViewer(null);
    } finally {
      setViewerLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reloadViewer();
  }, [reloadViewer]);

  useEffect(() => {
    const onPopState = (): void => {
      setLocation({ path: window.location.pathname, search: window.location.search });
      setAnnouncement('');
      setSessionEnded(false);
      setJoinLanding(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((path: string, options?: NavigateOptions) => {
    const [pathname, search] = path.split('?');
    if (options?.replace) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
    setLocation({ path: pathname ?? '/', search: search ? `?${search}` : '' });
    pendingAnnouncement.current = options?.announce ?? null;
    setAnnouncement(options?.announce ?? '');
    setJoinLanding(options?.joinLanding ?? false);
    setSessionEnded(false);
    window.scrollTo(0, 0);
  }, []);

  const announce = useCallback((text: string) => {
    pendingAnnouncement.current = null;
    setAnnouncement(text);
  }, []);

  const noteSessionEnded = useCallback(
    (text: string, draft: Omit<ScreenDraft, 'path' | 'email'>) => {
      setAnnouncement(text);
      setSessionEnded(true);
      saveDraft({ ...draft, path: location.path, email: viewer?.user.email ?? '' });
      setViewer(null);
    },
    [location.path, viewer?.user.email],
  );

  const state: AppState = useMemo(
    () => ({
      path: location.path,
      search: location.search,
      viewer,
      status: status.data ?? ALL_WELL,
      board: board.data,
      calendar: calendar.data,
      announcement,
      sessionEnded,
      reducedMotion,
      joinLanding,
      restoredDraft,
      announce,
      noteSessionEnded,
      navigate,
      offerDraft: setRestoredDraft,
      consumeDraft: () => setRestoredDraft(null),
      reloadViewer,
      reloadBoard: board.reload,
      setStatusPollFast: setStatusFast,
    }),
    [
      location,
      viewer,
      status.data,
      board.data,
      board.reload,
      calendar.data,
      announcement,
      sessionEnded,
      reducedMotion,
      joinLanding,
      restoredDraft,
      announce,
      noteSessionEnded,
      navigate,
      reloadViewer,
    ],
  );

  const role = viewer?.user.role ?? null;
  const allowed = role === null ? true : roleMayUseScreen(role, screen);

  function body(): JSX.Element {
    if (!viewerLoaded) return <div className="loading" />;
    if (screen.kind === 'not-found') return <NotFound />;
    if (role !== null && !allowed) return <NotFound />;
    switch (screen.kind) {
      case 'pegboard':
        return <Pegboard />;
      case 'signin':
        return viewer ? <NotFound /> : <SignIn />;
      case 'join':
        return viewer ? <NotFound /> : <Join />;
      case 'account':
        return <Account />;
      case 'desk':
        return <Desk />;
      case 'office':
        return <Office />;
      case 'loan':
        return <LoanScreen loanId={screen.id} />;
      case 'fee':
        return <FeeScreen feeId={screen.id} />;
      default:
        return <NotFound />;
    }
  }

  // A signed-out visitor reaching a protected screen is sent to sign in.
  useEffect(() => {
    if (!viewerLoaded || viewer !== null || sessionEnded) return;
    const needsSignIn =
      screen.kind === 'account' ||
      screen.kind === 'desk' ||
      screen.kind === 'office' ||
      screen.kind === 'loan' ||
      screen.kind === 'fee';
    if (needsSignIn) {
      window.location.assign(`/signin?next=${encodeURIComponent(location.path)}`);
    }
  }, [viewerLoaded, viewer, screen.kind, location.path, sessionEnded]);

  // A signed-in user who opens sign in or join goes to their landing path.
  useEffect(() => {
    if (!viewer) return;
    if (screen.kind === 'signin' || screen.kind === 'join') {
      navigate(landingPath(viewer.user.role), { replace: true });
    }
  }, [viewer, screen.kind, navigate]);

  return (
    <AppProvider value={state}>
      <Shell>{body()}</Shell>
    </AppProvider>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
