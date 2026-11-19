import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu as MenuIcon } from 'lucide-react';
import { copy } from '../copy.js';
import { useInlineNav, useReducedMotion } from '../hooks.js';
import { Link, useLocation } from '../router.js';
import { useMe, useStatus } from '../store.js';
import { takeGarageLinkFocus } from '../focus-intent.js';
import { registerMenu } from './menu-state.js';

const NAV_LINKS: { to: string; label: string }[] = [
  { to: '/garage', label: 'Garage' },
  { to: '/boards', label: 'Leaderboards' },
  { to: '/championship', label: 'Championship' },
  { to: '/lobby/new', label: 'Online lobby' },
];

function OutageBanner() {
  const status = useStatus();
  if (status.replayStorage !== 'unavailable') return null;
  return (
    <div role="alert" className="banner">
      {copy.outageBanner}
    </div>
  );
}

function Header({ brandOnly }: { brandOnly: boolean }) {
  const inline = useInlineNav();
  const [expanded, setExpanded] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setExpanded(false), [location.pathname]);
  useEffect(() => registerMenu(() => setExpanded(false)), []);

  useEffect(() => {
    if (inline && takeGarageLinkFocus()) {
      document.getElementById('nav-garage')?.focus();
    }
  }, [inline, location.pathname]);

  useEffect(() => {
    if (!expanded) return;
    panel.current?.querySelector<HTMLElement>('a')?.focus();
  }, [expanded]);

  return (
    <>
      <header className="page-header">
        <Link to="/garage" className="brand">
          Kerbline
        </Link>
        {!brandOnly &&
          (inline ? (
            <nav className="nav-links">
              {NAV_LINKS.map((link) => (
                <Link key={link.to} to={link.to} id={`nav-${link.label.toLowerCase().split(' ')[0]}`}>
                  {link.label}
                </Link>
              ))}
            </nav>
          ) : (
            <button
              type="button"
              className="menu-button"
              ref={menuButton}
              aria-expanded={expanded}
              aria-controls="menu-panel"
              onClick={() => setExpanded((open) => !open)}
            >
              <MenuIcon size={18} aria-hidden="true" />
              Menu
            </button>
          ))}
      </header>
      {!brandOnly && !inline && expanded && (
        <div
          id="menu-panel"
          ref={panel}
          className="menu-panel"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setExpanded(false);
              menuButton.current?.focus();
            }
          }}
        >
          {NAV_LINKS.map((link) => (
            <Link key={link.to} to={link.to}>
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function Page({
  gutter,
  children,
  brandOnly = false,
}: {
  gutter: string[];
  children: ReactNode;
  brandOnly?: boolean;
}) {
  const { me } = useMe();
  const reduced = useReducedMotion();
  return (
    <div className={`app${reduced ? ' reduced' : ''}`}>
      <OutageBanner />
      <Header brandOnly={brandOnly || me === null} />
      <div className="layout">
        <div className="gutter" aria-hidden="true">
          {gutter.map((label, index) => (
            <span className="gutter-entry" key={label}>
              <strong>{(index + 1).toString().padStart(2, '0')}</strong>
              {label}
            </span>
          ))}
        </div>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
