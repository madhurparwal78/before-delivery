import { useState, type ReactNode } from 'react';
import type { Role, SessionUser } from '../../shared/types.js';
import { Link, useNavigation } from '../router.jsx';
import { api } from '../api.js';

interface NavLink {
  to: string;
  label: string;
}

const LINKS_BY_ROLE: Record<Role, NavLink[]> = {
  coordinator: [
    { to: '/board', label: 'Week board' },
    { to: '/credentials', label: 'Credentials' },
  ],
  interpreter: [
    { to: '/open-seats', label: 'Open seats' },
    { to: '/assignments', label: 'My assignments' },
    { to: '/profile', label: 'Profile' },
  ],
  client_scheduler: [
    { to: '/requests', label: 'Requests' },
    { to: '/requests/new', label: 'New request' },
    { to: '/invoices', label: 'Invoices' },
  ],
  billing_admin: [
    { to: '/billing', label: 'Billing' },
    { to: '/invoices', label: 'Invoices' },
  ],
};

export const HOME_BY_ROLE: Record<Role, string> = {
  coordinator: '/board',
  interpreter: '/open-seats',
  client_scheduler: '/requests',
  billing_admin: '/billing',
};

export function AppFrame({
  user,
  onSignedOut,
  children,
}: {
  user: SessionUser;
  onSignedOut: () => void;
  children: ReactNode;
}): ReactNode {
  const { pathname } = useNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const links = LINKS_BY_ROLE[user.role];

  return (
    <>
      <header className="topbar">
        <span className="wordmark">Crosshand Relay</span>
        <nav aria-label="Main">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              aria-current={pathname === link.to ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-right">
          <button
            type="button"
            className="quiet menu-button"
            onClick={() => setMenuOpen((open) => !open)}
          >
            Menu
          </button>
          <span>{user.display_name}</span>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              void api.signOut().finally(onSignedOut);
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      {menuOpen ? (
        <div className="menu-panel">
          {links.map((link) => (
            <Link key={link.to} to={link.to} onClick={() => setMenuOpen(false)}>
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
      {children}
    </>
  );
}
