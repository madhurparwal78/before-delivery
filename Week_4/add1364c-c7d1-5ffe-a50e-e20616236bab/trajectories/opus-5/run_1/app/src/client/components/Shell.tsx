import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Clock, Person, Role } from '../api.js';
import { officeStamp } from '../format.js';
import { useAnnouncements } from '../live.js';
import { DrawerLink, go, useLocation } from '../router.js';
import { BackOfDrawer } from './BackOfDrawer.js';

const LINKS: { to: string; label: string; roles: readonly Role[] }[] = [
  { to: '/desk', label: 'Drawer', roles: ['office_manager', 'managing_partner', 'staff_accountant', 'outside_bookkeeper'] },
  { to: '/rotations', label: 'Rotations', roles: ['office_manager', 'managing_partner'] },
  { to: '/reviews', label: 'Reviews', roles: ['office_manager', 'managing_partner'] },
  { to: '/people', label: 'People', roles: ['office_manager', 'managing_partner'] },
  { to: '/billing', label: 'Billing', roles: ['office_manager', 'managing_partner'] },
  { to: '/health', label: 'Health', roles: ['office_manager', 'managing_partner'] },
  { to: '/import', label: 'Import', roles: ['office_manager'] },
  { to: '/audit', label: 'Audit', roles: ['office_manager', 'managing_partner'] },
  { to: '/travel', label: 'My travel', roles: ['staff_accountant', 'outside_bookkeeper'] },
];

export function showsFooter(role: Role): boolean {
  return role === 'office_manager' || role === 'managing_partner';
}

export function Shell(props: {
  me: Person;
  clock: Clock;
  onSignOut: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const where = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const menuButton = useRef<HTMLButtonElement>(null);
  const footer = useRef<HTMLElement>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  const announcements = useAnnouncements();
  const links = LINKS.filter((link) => link.roles.includes(props.me.role));

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const listen = (): void => setNarrow(media.matches);
    media.addEventListener('change', listen);
    return () => media.removeEventListener('change', listen);
  }, []);

  useEffect(() => {
    if (!narrow) setMenuOpen(false);
  }, [narrow]);

  useEffect(() => {
    setMenuOpen(false);
  }, [where.path]);

  useLayoutEffect(() => {
    const node = footer.current;
    if (node === null) {
      setFooterHeight(0);
      return;
    }
    const measure = (): void => setFooterHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  });

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const nav = (
    <nav aria-label="Desk">
      <ul>
        {links.map((link) => (
          <li key={link.to}>
            <DrawerLink
              to={link.to}
              onNavigate={() => {
                setMenuOpen(false);
                menuButton.current?.focus();
              }}
            >
              {link.label}
            </DrawerLink>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="desk">
      <header className="top-bar">
        <span className="wordmark">Wardhouse</span>
        {narrow ? null : nav}
        {narrow ? (
          <button type="button" ref={menuButton} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            Menu
          </button>
        ) : null}
        <span className="spacer" />
        <span>{props.me.full_name}</span>
        <span className="office-stamp stamp">
          {officeStamp(props.clock.office_date, props.clock.office_time, props.clock.offset)}
        </span>
        <button type="button" onClick={props.onSignOut}>
          Sign out
        </button>
      </header>

      {narrow && menuOpen ? <div className="menu-panel">{nav}</div> : null}

      <p className="hidden-live" role="status" aria-label="Desk status">
        {announcements.status}
      </p>
      <p className="hidden-live" role="alert" aria-label="Desk alert">
        {announcements.alert}
      </p>

      <div
        className="desk-main"
        style={{
          position: 'relative',
          zIndex: 1,
          background: 'var(--paper)',
          marginBottom: showsFooter(props.me.role) ? `${footerHeight}px` : undefined,
        }}
      >
        {props.children}
      </div>

      {showsFooter(props.me.role) ? <BackOfDrawer clock={props.clock} nodeRef={footer} /> : null}
    </div>
  );
}

export function SessionEnded(props: { route: string }): React.ReactElement {
  return (
    <main className="desk-main">
      <div className="folder">
        <span className="folder-tab" aria-hidden="true">
          Session
        </span>
        <div className="folder-band folder-band--surface">
          <div className="slip">
            <h1>Your reveal session has ended</h1>
            <p>Sign in again to reveal logins.</p>
            <p>
              <a
                href={`/sign-in?next=${encodeURIComponent(props.route)}`}
                onClick={(event) => {
                  event.preventDefault();
                  go(`/sign-in?next=${encodeURIComponent(props.route)}`);
                }}
              >
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export function NotFound(): React.ReactElement {
  return (
    <main className="desk-main">
      <div className="folder">
        <span className="folder-tab" aria-hidden="true">
          Drawer
        </span>
        <div className="folder-band folder-band--surface">
          <div className="slip">
            <h1>Nothing in this drawer</h1>
            <p>
              <DrawerLink to="/desk">Drawer</DrawerLink>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
