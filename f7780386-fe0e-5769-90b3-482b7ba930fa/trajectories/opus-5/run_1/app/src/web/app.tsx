import { useEffect, useState, type ReactNode } from 'react';

import type { Role } from '../shared/api.js';
import { useApp } from './app-state.js';
import { BoardScreen } from './screens/board-screen.js';
import { DocumentsScreen } from './screens/documents.js';
import { HoursScreen } from './screens/hours.js';
import { InvoicesScreen } from './screens/invoices.js';
import { MembersScreen } from './screens/members.js';
import { PacketsScreen } from './screens/packets.js';
import { ReviewScreen } from './screens/review.js';
import { ShiftsScreen } from './screens/shifts.js';
import { SignInScreen } from './screens/sign-in.js';
import { UsageScreen } from './screens/usage.js';

interface NavLink {
  label: string;
  path: string;
}

const NAV_BY_ROLE: Record<Role, NavLink[]> = {
  member: [
    { label: 'Board', path: '/board' },
    { label: 'Hours', path: '/hours' },
    { label: 'Documents', path: '/documents' },
    { label: 'Invoices', path: '/invoices' },
  ],
  crew_cook: [
    { label: 'Shifts', path: '/shifts' },
    { label: 'Board', path: '/board' },
    { label: 'Documents', path: '/documents' },
  ],
  operator: [
    { label: 'Review', path: '/review' },
    { label: 'Board', path: '/board' },
    { label: 'Members', path: '/members' },
    { label: 'Usage', path: '/usage' },
    { label: 'Packets', path: '/packets' },
  ],
};

function LiveRegions(): ReactNode {
  const { live } = useApp();
  return (
    <div className="live-regions">
      <div role="status" aria-label="Updates" aria-live="polite">
        {live.updates === '' ? null : <p className="msg">{live.updates}</p>}
      </div>
      <div role="alert" aria-label="Problems" aria-live="assertive">
        {live.problems === '' ? null : <p className="msg problem">{live.problems}</p>}
      </div>
    </div>
  );
}

function TopBar(): ReactNode {
  const app = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)');
    const apply = (): void => setNarrow(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  const user = app.user;
  if (user === null) return null;
  const links = NAV_BY_ROLE[user.role];

  return (
    <header className="topbar">
      <span className="kitchen-name">{app.kitchen?.name ?? 'Passboard'}</span>
      {narrow ? (
        <button
          type="button"
          className="menu-button"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menu
        </button>
      ) : null}
      <nav aria-label="Main" hidden={narrow && !menuOpen}>
        {links.map((link) => (
          <a
            key={link.path}
            href={link.path}
            aria-current={app.path === link.path ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              setMenuOpen(false);
              app.navigate(link.path);
            }}
          >
            {link.label}
          </a>
        ))}
      </nav>
      <span className="spacer" />
      <button type="button" onClick={() => void app.signOut()}>
        Sign out
      </button>
    </header>
  );
}

function screenFor(path: string, role: Role): ReactNode {
  switch (path) {
    case '/board':
      return <BoardScreen />;
    case '/hours':
      return role === 'member' ? <HoursScreen /> : null;
    case '/documents':
      return role === 'operator' ? null : <DocumentsScreen />;
    case '/invoices':
      return role === 'member' ? <InvoicesScreen /> : null;
    case '/shifts':
      return role === 'crew_cook' ? <ShiftsScreen /> : null;
    case '/review':
      return role === 'operator' ? <ReviewScreen /> : null;
    case '/members':
      return role === 'operator' ? <MembersScreen /> : null;
    case '/usage':
      return role === 'operator' ? <UsageScreen /> : null;
    case '/packets':
      return role === 'operator' ? <PacketsScreen /> : null;
    default:
      return null;
  }
}

function homeFor(role: Role): string {
  if (role === 'operator') return '/review';
  if (role === 'crew_cook') return '/shifts';
  return '/board';
}

export function App(): ReactNode {
  const app = useApp();
  const user = app.user;

  useEffect(() => {
    if (user !== null && screenFor(app.path, user.role) === null) {
      app.navigate(homeFor(user.role));
    }
  }, [app, user]);

  if (user === null) {
    return (
      <>
        <LiveRegions />
        <SignInScreen />
      </>
    );
  }

  return (
    <>
      <a className="skip-link" href="#board-main">
        Skip to the board
      </a>
      <TopBar />
      <LiveRegions />
      <main id="board-main">{screenFor(app.path, user.role)}</main>
    </>
  );
}
