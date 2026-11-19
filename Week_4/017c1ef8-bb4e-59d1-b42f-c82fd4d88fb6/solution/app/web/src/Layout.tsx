import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AnnouncementRegions } from './announce';
import { NavCountsProvider, useNavCounts } from './navcounts';
import { ConnectionAnnouncer } from './network/ConnectionAnnouncer';
import { useMember, useSession } from './session';
import { useMediaLayout } from './ui/layout';

interface RouteFocus {
  suppress: () => void;
}

/** Lets a page that restores focus itself keep the layout from focusing the page heading on route change. */
const RouteFocusContext = createContext<RouteFocus | null>(null);

/** Call from a page that manages focus on arrival (feed Back, thread list): the heading is not focused for this route. */
export function useManagedFocus(): void {
  // Only member pages call it, and MemberShell provides the context around every one of them.
  const context = useContext(RouteFocusContext) as RouteFocus;
  const { pathname } = useLocation();
  useEffect(() => {
    context.suppress();
  }, [context, pathname]);
}

const countedName = (word: string, count: number, unit: string): string => (count > 0 ? `${word}, ${count} ${unit}` : word);
const invitationsUnit = (n: number): string => (n === 1 ? 'invitation' : 'invitations');

function HeaderSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const onSearchPage = pathname === '/search';
  const urlText = params.get('q') ?? '';
  const [text, setText] = useState(onSearchPage ? urlText : '');

  useEffect(() => {
    if (onSearchPage) setText(urlText);
  }, [onSearchPage, urlText]);

  return (
    <input
      type="search"
      className="input header-search"
      aria-label="Search"
      placeholder="Search"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        if (onSearchPage) {
          const next = new URLSearchParams(params);
          next.set('q', event.target.value);
          setParams(next, { replace: true });
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !onSearchPage) navigate(`/search?type=people&q=${encodeURIComponent(text)}`);
      }}
    />
  );
}

function CountedLink({ to, name, count }: { to: string; name: string; count: number }) {
  return (
    <NavLink to={to} aria-label={name} className="nav-link">
      <span aria-hidden="true">{name.split(',')[0]}</span>
      {count > 0 ? (
        <>
          {' '}
          <span className="nav-count" aria-hidden="true">{count}</span>
        </>
      ) : null}
    </NavLink>
  );
}

function MemberChrome({ children }: { children: ReactNode }) {
  const layout = useMediaLayout();
  const counts = useNavCounts();
  const member = useMember();
  const messaging = countedName('Messaging', counts.unreadConversations, 'unread');
  const notifications = countedName('Notifications', counts.unreadNotifications, 'unread');
  const me = `/in/${member.handle}`;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/feed" className="monogram" aria-label="Plainwork">
          <span className="sr-only">Pw</span>
        </Link>
        <HeaderSearch />
        {layout === 'phone' ? (
          <nav className="header-links" aria-label="Account">
            <CountedLink to="/notifications" name={notifications} count={counts.unreadNotifications} />
            <NavLink to={me} className="nav-link">
              Me
            </NavLink>
          </nav>
        ) : (
          <nav className="primary-nav" aria-label="Primary">
            <NavLink to="/feed" className="nav-link">
              Home
            </NavLink>
            <CountedLink to="/network" name={countedName('My network', counts.invitations, invitationsUnit(counts.invitations))} count={counts.invitations} />
            <NavLink to="/jobs" className="nav-link">
              Jobs
            </NavLink>
            <CountedLink to="/messaging" name={messaging} count={counts.unreadConversations} />
            <CountedLink to="/notifications" name={notifications} count={counts.unreadNotifications} />
            <NavLink to={me} className="nav-link">
              Me
            </NavLink>
          </nav>
        )}
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
      {layout === 'phone' ? (
        <nav className="tab-bar" aria-label="Tabs">
          <NavLink to="/feed" className="tab-link">
            Home
          </NavLink>
          <CountedLink to="/network" name={countedName('Network', counts.invitations, invitationsUnit(counts.invitations))} count={counts.invitations} />
          <Link to="/feed#compose" className="tab-link">
            Post
          </Link>
          <CountedLink to="/messaging" name={messaging} count={counts.unreadConversations} />
          <NavLink to="/jobs" className="tab-link">
            Jobs
          </NavLink>
        </nav>
      ) : null}
      <AnnouncementRegions />
      <ConnectionAnnouncer />
    </>
  );
}

/** Header, navigation, main and announcement regions around a member page; focuses the page heading on route change. */
export function MemberShell({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation();
  const suppressed = useRef(false);
  const context = useRef({ suppress: () => void (suppressed.current = true) });

  useEffect(() => {
    if (suppressed.current || hash) {
      suppressed.current = false;
      return;
    }
    const heading = document.querySelector<HTMLElement>('main h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [pathname, hash]);

  return (
    <NavCountsProvider>
      <RouteFocusContext.Provider value={context.current}>
        <MemberChrome>{children}</MemberChrome>
      </RouteFocusContext.Provider>
    </NavCountsProvider>
  );
}

/** Member pages: a signed-out visit goes to /signin. */
export function MemberLayout() {
  const { member } = useSession();
  if (member === undefined) return null;
  if (member === null) return <Navigate to="/signin" replace />;
  return (
    <MemberShell>
      <Outlet />
    </MemberShell>
  );
}

/** Join, confirm and sign-in: for signed-out visitors; a signed-in visit goes to the feed. */
export function SignedOutLayout() {
  const { member } = useSession();
  if (member === undefined) return null;
  if (member) return <Navigate to="/feed" replace />;
  return <Outlet />;
}

