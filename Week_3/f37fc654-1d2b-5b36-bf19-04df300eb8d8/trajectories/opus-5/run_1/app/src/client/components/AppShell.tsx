import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { signInHref } from '../lib/api.js';
import { useServiceStatus, useSession, useToasts } from '../lib/app-context.js';
import { SESSION_ENDED_MESSAGE } from '../../shared/copy.js';
import { Dialog } from './ui.js';
import { Stage } from './Stage.js';

interface NavLink {
  to: string;
  label: string;
}

function linksFor(roles: readonly string[]): NavLink[] {
  if (roles.includes('producer')) {
    return [
      { to: '/studio', label: 'Studio' },
      { to: '/studio/jobs', label: 'Jobs' },
    ];
  }
  if (roles.includes('crew')) return [{ to: '/crew', label: 'Install days' }];
  if (roles.includes('client')) {
    return [
      { to: '/commissions', label: 'Commissions' },
      { to: '/settings/crm', label: 'CRM settings' },
    ];
  }
  // A sponsor has no links.
  return [];
}

export function TopBar(): JSX.Element {
  const { me, signOut } = useSession();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const links = me ? linksFor(me.roles) : [];
  const returnTo = `${location.pathname}${location.search}`;

  return (
    <header className="top-bar">
      <Link className="wordmark" to="/">
        Spindrift Rooms
      </Link>
      <nav>
        <span className="bar-links">
          {links.map((link) => (
            <Link key={link.to} to={link.to}>
              {link.label}
            </Link>
          ))}
        </span>
        {links.length > 0 ? (
          <button
            type="button"
            className="chip-chrome menu-button"
            onClick={() => setDrawerOpen(true)}
          >
            Menu
          </button>
        ) : null}
        {me ? (
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        ) : (
          <a href={signInHref(returnTo)}>Sign in</a>
        )}
      </nav>
      {drawerOpen ? (
        <Dialog
          title="Navigation"
          closeLabel="Close menu"
          variant="drawer"
          onClose={() => setDrawerOpen(false)}
        >
          <nav className="list">
            {links.map((link) => (
              <Link key={link.to} to={link.to} onClick={() => setDrawerOpen(false)}>
                {link.label}
              </Link>
            ))}
          </nav>
        </Dialog>
      ) : null}
    </header>
  );
}

/** One banner per unreachable service, pinned top-centre, plus the toasts. */
export function Notices(): JSX.Element {
  const { banners } = useServiceStatus();
  const { toasts } = useToasts();
  const { signedOut } = useSession();
  const location = useLocation();
  return (
    <>
      <div className="notices">
        <div role="status" aria-label="Service notices">
          {banners.map((banner) => (
            <p className="notice" key={banner.service}>
              {banner.text}
            </p>
          ))}
        </div>
        <div role="status" aria-label="Notices">
          {toasts.map((toast) => (
            <p className="notice" key={toast.id}>
              {toast.text}
            </p>
          ))}
        </div>
        <div role="status" aria-label="Session">
          {signedOut ? (
            <p className="notice">
              {SESSION_ENDED_MESSAGE}{' '}
              <button
                type="button"
                onClick={() => {
                  window.location.href = signInHref(
                    `${location.pathname}${location.search}`,
                  );
                }}
              >
                Sign in
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <>
      <Stage />
      <Notices />
      <div className="app-shell">
        <TopBar />
        {children}
      </div>
    </>
  );
}
