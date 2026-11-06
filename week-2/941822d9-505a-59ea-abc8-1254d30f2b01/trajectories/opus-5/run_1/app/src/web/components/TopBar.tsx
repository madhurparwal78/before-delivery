import { useState, type ReactNode } from 'react';
import { Link, navigate, usePath } from '../lib/router.js';
import { request } from '../lib/api.js';
import type { User } from '../lib/types.js';

interface NavLink {
  readonly to: string;
  readonly label: string;
}

function linksFor(user: User): NavLink[] {
  const links: NavLink[] = [{ to: '/courses', label: 'Courses' }];
  if (user.role === 'learner') {
    links.push({ to: '/learning', label: 'My learning' }, { to: '/transcript', label: 'Transcript' });
  }
  if (user.role === 'coordinator') links.push({ to: '/sponsor', label: 'Hospital seats' });
  if (user.role === 'planner') links.push({ to: '/planner', label: 'Planner' });
  if (user.role === 'author' || user.role === 'planner') links.push({ to: '/author', label: 'Authoring' });
  return links;
}

export function TopBar({ user, onSignedOut }: { readonly user: User; readonly onSignedOut: () => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const path = usePath();

  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Link to="/courses" className="wordmark">
          Credwell
        </Link>
        <button
          type="button"
          className="menu-button quiet"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          Menu
        </button>
        <nav aria-label="Main" className={`nav ${open ? 'nav--open' : ''}`}>
          {linksFor(user).map((link) => (
            <Link
              key={link.to}
              to={link.to}
              aria-current={path === link.to ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="topbar__spacer" />
        <button
          type="button"
          className="quiet"
          onClick={() => {
            void request('/api/session', { method: 'DELETE' }).finally(() => {
              onSignedOut();
              navigate('/signin');
            });
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
