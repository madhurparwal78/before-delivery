import { StrictMode, useEffect, useState, useRef, useCallback, createContext, useContext, useMemo, type ReactNode } from 'react';
import { api, ApiError, type Person, type Vault, type Credential, type ClockAnswer, type AsOfAnswer, type Rule, displayOfficeDate } from './api.js';
import { useApp } from './core.js';
import { getEvents } from './events.js';

export interface Navigate {
  (to: string, replace?: boolean): void;
}

/* ------------------------------------------------------------------ */
/* Desk shell                                                          */
/* ------------------------------------------------------------------ */

const NAV_BY_ROLE: Record<string, Array<{ label: string; path: string }>> = {
  office_manager: [
    { label: 'Drawer', path: '/desk' },
    { label: 'Rotations', path: '/rotations' },
    { label: 'Reviews', path: '/reviews' },
    { label: 'People', path: '/people' },
    { label: 'Billing', path: '/billing' },
    { label: 'Health', path: '/health' },
    { label: 'Import', path: '/import' },
    { label: 'Audit', path: '/audit' }
  ],
  managing_partner: [
    { label: 'Drawer', path: '/desk' },
    { label: 'Rotations', path: '/rotations' },
    { label: 'Reviews', path: '/reviews' },
    { label: 'People', path: '/people' },
    { label: 'Billing', path: '/billing' },
    { label: 'Health', path: '/health' },
    { label: 'Audit', path: '/audit' }
  ],
  staff_accountant: [
    { label: 'Drawer', path: '/desk' },
    { label: 'My travel', path: '/travel' }
  ],
  outside_bookkeeper: [
    { label: 'Drawer', path: '/desk' },
    { label: 'My travel', path: '/travel' }
  ]
};

export function DeskShell(props: { navigate: Navigate; children: ReactNode; hideFooter?: boolean }): ReactNode {
  const { me, clock, status, alert } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const role = me?.role ?? 'staff_accountant';
  const links = NAV_BY_ROLE[role] ?? [];
  const seesFooter = role === 'office_manager' || role === 'managing_partner';

  const signOut = async (): Promise<void> => {
    await api('DELETE', '/api/sessions').catch(() => undefined);
    window.location.href = '/sign-in';
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="desk">
      <header className="topbar">
        <span className="wordmark">Wardhouse</span>
        <button
          ref={menuButtonRef}
          className="menu-button"
          aria-expanded={menuOpen}
          aria-controls="desk-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menu
        </button>
        <nav id="desk-nav" aria-label="Desk" className={menuOpen ? 'open' : ''} hidden={!menuOpen && window.innerWidth <= 500 ? true : undefined}>
          {links.map((link) => (
            <a
              key={link.path}
              href={link.path}
              onClick={(event) => {
                event.preventDefault();
                setMenuOpen(false);
                props.navigate(link.path);
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <span className="spacer" />
        <span className="person-name">{me?.full_name}</span>
        {clock ? (
          <span className="clock" aria-label="Office clock">
            {displayOfficeDate(clock.office_date)}, {clock.office_time} {clock.offset}
          </span>
        ) : null}
        <button onClick={() => void signOut()}>Sign out</button>
      </header>
      {props.children}
      {seesFooter && !props.hideFooter ? <BackOfDrawer /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Back of the drawer footer                                           */
/* ------------------------------------------------------------------ */

interface AuditEntry {
  id: string;
  seq: number;
  at: string;
  office_day: string;
  office_time: string;
  offset: string;
  actor: { person_id?: string; name?: string; system?: string };
  action: string;
  subject: { kind: string; id: string; name: string };
  details: Record<string, unknown>;
}

function BackOfDrawer(): ReactNode {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    void api<{ entries: AuditEntry[] }>('GET', '/api/audit/footer')
      .then((answer) => setEntries(answer.entries))
      .catch(() => undefined);
    const events = getEvents();
    events.on('access-changed', () => {
      void api<{ entries: AuditEntry[] }>('GET', '/api/audit/footer')
        .then((answer) => setEntries(answer.entries))
        .catch(() => undefined);
    });
  }, []);
  if (entries === null) return null;
  return (
    <footer className="back-of-drawer" role="contentinfo">
      <h2>Back of the drawer</h2>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className="entry-time">{entry.office_time}</span>{' '}
            <span className="entry-actor">{entry.actor.system ? 'Lockset' : entry.actor.name}</span>{' '}
            <span className="entry-action">{entry.action}</span>{' '}
            <span className="entry-subject">{entry.subject.name}</span>
          </li>
        ))}
      </ul>
    </footer>
  );
}
