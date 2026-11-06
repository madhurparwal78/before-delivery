import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from '../hooks';
import { Link, useRouter } from '../router';
import { useApp } from '../state';
import { useDialogFocus } from './dialog';
import { CloseIcon, MenuIcon } from './icons';

const NAV = [
  ['Overview', '/#overview'],
  ['Experiences', '/#experiences'],
  ['TPS Record', '/#record'],
  ['Agenda', '/#agenda'],
  ['Speakers', '/#speakers'],
  ['Sponsors', '/#sponsors'],
] as const;

const SHEET = { duration: 280, easing: 'cubic-bezier(0.2, 0, 0, 1)' };

function AccountControls({ onDone }: { onDone?: () => void }) {
  const { auth, signOut } = useApp();
  const { navigate } = useRouter();
  if (!auth) {
    return (
      <Link className="topbar-link" to="/signin" onClick={onDone}>
        Sign in
      </Link>
    );
  }
  const leave = async () => {
    onDone?.();
    await signOut();
    navigate('/');
  };
  return (
    <>
      <span className="account-name">{auth.account.name}</span>
      {auth.account.role === 'attendee' ? (
        <Link className="topbar-link" to="/my-agenda" onClick={onDone}>
          My Agenda
        </Link>
      ) : (
        <Link className="topbar-link" to="/organiser" onClick={onDone}>
          Organiser
        </Link>
      )}
      <button type="button" className="btn btn-quiet" onClick={() => void leave()}>
        Sign out
      </button>
    </>
  );
}

interface SheetProps {
  closing: boolean;
  onClose: () => void;
  onClosed: () => void;
  menuButton: () => HTMLElement | null;
}

// The sheet slides in from the right and reverses on close; with reduced motion it just appears.
function MenuSheet({ closing, onClose, onClosed, menuButton }: SheetProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  useDialogFocus(sheet, closeButton, onClose, menuButton);
  useLayoutEffect(() => {
    if (reduced) {
      if (closing) onClosed();
      return undefined;
    }
    const direction = closing ? 'reverse' : 'normal';
    const slide = sheet.current?.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { ...SHEET, direction, fill: 'both' });
    const dim = backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], { ...SHEET, direction, fill: 'both' });
    if (closing && slide) slide.onfinish = onClosed;
    return () => {
      slide?.cancel();
      dim?.cancel();
    };
  }, [closing, reduced, onClosed]);
  return (
    <div className="sheet-layer">
      <div ref={backdrop} className="sheet-backdrop" onClick={onClose} />
      <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-label="Menu">
        <button ref={closeButton} type="button" className="icon-button sheet-close" onClick={onClose}>
          <CloseIcon />
          <span>Close menu</span>
        </button>
        <nav aria-label="Menu links">
          <ul className="sheet-links">
            {NAV.map(([label, to]) => (
              <li key={to}>
                <Link to={to} onClick={onClose}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sheet-account">
          <AccountControls onDone={onClose} />
        </div>
      </div>
    </div>
  );
}

function TopBar() {
  const [menu, setMenu] = useState<'closed' | 'open' | 'closing'>('closed');
  const menuButton = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    menuButton.current?.focus();
    setMenu('closing');
  }, []);
  const closed = useCallback(() => setMenu('closed'), []);
  const findMenuButton = useCallback(() => menuButton.current, []);
  return (
    <header className="topbar">
      <Link className="wordmark" to="/">
        Keel
      </Link>
      <nav className="topbar-nav" aria-label="Main">
        <ul>
          {NAV.map(([label, to]) => (
            <li key={to}>
              <Link to={to}>{label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="topbar-account">
        <AccountControls />
        <button
          ref={menuButton}
          type="button"
          className="icon-button menu-button"
          aria-expanded={menu === 'open'}
          onClick={() => setMenu('open')}
        >
          <MenuIcon />
          <span>Menu</span>
        </button>
      </div>
      {menu !== 'closed' && <MenuSheet closing={menu === 'closing'} onClose={close} onClosed={closed} menuButton={findMenuButton} />}
    </header>
  );
}

export function Chrome({ children }: { children: ReactNode }) {
  const { accountMessage } = useApp();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to the page
      </a>
      <div className="banner">
        <Link to="/agenda">Keel Outpost starts this week. Final seats →</Link>
      </div>
      <TopBar />
      <p className="account-line" role="status" aria-label="Account messages">
        {accountMessage}
      </p>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="footer">
        <p className="footer-mark">Keel</p>
        <p>
          <span className="footer-part">Keel Outpost 2026 ·</span> <span className="footer-part">October 31 - November 1 ·</span>{' '}
          <span className="footer-part">Harbour Quay Hall, Port Ashby.</span> Questions about the programme:
          programme@example.com
        </p>
      </footer>
    </>
  );
}

export function Loading() {
  return (
    <p className="loading" role="status">
      Loading
    </p>
  );
}

export function NotFound({ copy }: { copy: string }) {
  return (
    <section className="page page-narrow not-found">
      <h1>{copy}</h1>
      <p className="helper">Head back to the programme to see every session.</p>
      <Link className="btn btn-primary" to="/agenda">
        Back to the agenda
      </Link>
    </section>
  );
}
