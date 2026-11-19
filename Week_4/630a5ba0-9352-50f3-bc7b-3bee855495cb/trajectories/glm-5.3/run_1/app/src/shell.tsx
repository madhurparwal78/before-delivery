import { useEffect, useState, type ReactNode } from 'react';
import { useSession, useAnnouncer } from './api/session';
import { Icon } from './icons/Icon';

export type Route =
  | { page: 'daybook' }
  | { page: 'settings' }
  | { page: 'workspace' }
  | { page: 'operations' }
  | { page: 'signin' }
  | { page: 'trial' }
  | { page: 'join'; token: string };

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '/daybook') return { page: 'daybook' };
  if (pathname === '/settings') return { page: 'settings' };
  if (pathname === '/workspace') return { page: 'workspace' };
  if (pathname === '/operations') return { page: 'operations' };
  if (pathname === '/signin') return { page: 'signin' };
  if (pathname === '/trial') return { page: 'trial' };
  const join = /^\/join\/([A-Za-z0-9_-]+)$/.exec(pathname);
  if (join !== null) return { page: 'join', token: join[1] ?? '' };
  return { page: 'daybook' };
}

export function navigate(to: string): void {
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPop = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

export function routePath(route: Route): string {
  switch (route.page) {
    case 'daybook':
      return '/';
    case 'settings':
      return '/settings';
    case 'workspace':
      return '/workspace';
    case 'operations':
      return '/operations';
    case 'signin':
      return '/signin';
    case 'trial':
      return '/trial';
    case 'join':
      return `/join/${route.token}`;
  }
}

/** The header with the workspace name and the links the role may use. */
export function AppHeader({ current }: { current: Route }): JSX.Element {
  const { me, signOut } = useSession();
  const { announce } = useAnnouncer();
  const role = me?.member.role ?? 'member';

  const onSignOut = (): void => {
    void signOut().then(() => {
      announce('');
      navigate('/signin');
    });
  };

  return (
    <header className="app-header">
      <span className="brand">
        <Icon name="book-open" />
        Tidemark Daybook
      </span>
      {me !== null && me.member.role !== 'operator' ? <span className="workspace-name">{me.workspace.name}</span> : null}
      {me !== null ? (
        <nav aria-label="Main">
          {role !== 'operator' ? (
            <>
              <a href="/" onClick={linkTo('/')} aria-current={current.page === 'daybook' ? 'page' : undefined}>
                Daybook
              </a>
              <a href="/settings" onClick={linkTo('/settings')} aria-current={current.page === 'settings' ? 'page' : undefined}>
                Settings
              </a>
            </>
          ) : null}
          {role === 'owner' ? (
            <a href="/workspace" onClick={linkTo('/workspace')} aria-current={current.page === 'workspace' ? 'page' : undefined}>
              Workspace
            </a>
          ) : null}
          {role === 'operator' ? (
            <a href="/operations" onClick={linkTo('/operations')} aria-current={current.page === 'operations' ? 'page' : undefined}>
              Operations
            </a>
          ) : null}
          <button type="button" onClick={onSignOut} className="sign-out">
            <Icon name="log-out" /> Sign out
          </button>
        </nav>
      ) : null}
    </header>
  );
}

const linkTo = (to: string) => (e: React.MouseEvent<HTMLAnchorElement>): void => {
  e.preventDefault();
  navigate(to);
};

/** The subscription banner, refreshed on load and every 60 seconds. */
export function SubscriptionBanner(): JSX.Element | null {
  const { me, reload } = useSession();
  const { announce } = useAnnouncer();

  useEffect(() => {
    const timer = setInterval(() => {
      void reload();
    }, 60_000);
    return () => clearInterval(timer);
  }, [reload, announce]);

  if (me === null || me.member.role === 'operator') return null;
  const state = me.workspace.state;
  if (state === 'active') return null;

  let copy: string;
  let alert = false;
  if (state === 'trialing') {
    const ends = new Date(me.workspace.trialEndsAt).getTime();
    const left = Math.ceil((ends - Date.now()) / 86_400_000);
    copy = left === 1 ? 'Trial: 1 day left' : `Trial: ${left} days left`;
  } else if (state === 'past_due') {
    copy = 'Payment failed. Planning stays open while billing retries.';
  } else if (state === 'read_only') {
    copy = 'This workspace is read-only. Planning resumes when the subscription is active.';
    alert = true;
  } else {
    copy = 'This subscription is cancelled. Your plans stay readable.';
    alert = true;
  }
  return (
    <section className={`subscription-banner${alert ? ' alert' : ''}`} role="region" aria-label="Subscription">
      {copy}
    </section>
  );
}

export function Screen({ children }: { children: ReactNode }): JSX.Element {
  return <>{children}</>;
}
