import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useApp } from '../lib/app';
import { announce } from '../lib/announce';
import { isMac } from '../lib/util';
import { Announcements } from './Announcements';
import { Menu, CalendarDays, Table2, LayoutTemplate, Trash2, Settings, PanelLeft, X, LogIn } from 'lucide-react';

export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 900);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const listener = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);
  return narrow;
}

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => window.innerWidth <= 600);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 600px)');
    const listener = (e: MediaQueryListEvent) => setPhone(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);
  return phone;
}

const NAV_ITEMS = [
  { to: '/', label: 'Documents', icon: <Menu size={18} aria-hidden /> },
  { to: '/journal', label: 'Journal', icon: <CalendarDays size={18} aria-hidden /> },
  { to: '/records', label: 'Records', icon: <Table2 size={18} aria-hidden /> },
  { to: '/templates', label: 'Templates', icon: <LayoutTemplate size={18} aria-hidden /> },
  { to: '/trash', label: 'Trash', icon: <Trash2 size={18} aria-hidden /> },
  { to: '/settings', label: 'Settings', icon: <Settings size={18} aria-hidden /> },
];

function NavLinks({ onNavigate, firstRef }: { onNavigate?: () => void; firstRef?: React.RefObject<HTMLAnchorElement | null> }) {
  return (
    <>
      {NAV_ITEMS.map((item, i) => (
        <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={onNavigate} ref={i === 0 ? firstRef : undefined}>
          {({ isActive }) => (
            <span aria-current={isActive ? 'page' : undefined}>
              {item.icon} {item.label}
            </span>
          )}
        </NavLink>
      ))}
    </>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const syncSentence = useApp((s) => s.syncSentence());
  const syncState = useApp((s) => s.syncStateValue());
  const notices = useApp((s) => s.notices);
  const dismissNotice = useApp((s) => s.dismissNotice);
  const signedIn = useApp((s) => s.signedIn);
  const email = useApp((s) => s.email);
  const colourScheme = useApp((s) => s.colourScheme);
  const ready = useApp((s) => s.ready);
  const syncingOn = useApp((s) => s.syncingOn);
  const uploadChosen = useApp((s) => s.uploadChosen);
  const mainRef = useRef<HTMLElement>(null);
  const firstNavLinkRef = useRef<HTMLAnchorElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [signinOpen, setSigninOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const isNarrow = useIsNarrow();

  // Announce every change of Sync status sentence.
  const lastSentence = useRef(syncSentence);
  useEffect(() => {
    if (syncSentence !== lastSentence.current) {
      lastSentence.current = syncSentence;
      announce(syncSentence);
    }
  }, [syncSentence]);

  // Colour scheme in force, applied at once and remembered on this device.
  useEffect(() => {
    const root = document.documentElement;
    const apply = (dark: boolean) => root.setAttribute('data-colour-scheme', dark ? 'dark' : 'light');
    if (colourScheme === 'Light') apply(false);
    else if (colourScheme === 'Dark') apply(true);
    else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches);
      const listener = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
  }, [colourScheme]);

  // Offline readiness once the shell and its data are loaded.
  useEffect(() => {
    if (ready) document.documentElement.setAttribute('data-offline-ready', 'true');
  }, [ready]);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // The upload choice comes back at the next load when it was left unanswered.
  useEffect(() => {
    if (signedIn && !uploadChosen && !syncingOn) {
      setUploadOpen(true);
    }
  }, [signedIn, uploadChosen, syncingOn]);

  const openNav = () => {
    setNavOpen(true);
    requestAnimationFrame(() => firstNavLinkRef.current?.focus());
  };

  // Whole app: Mod+Alt+N makes a new document.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (mod && e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        void useApp.getState().newDocument().then((id) => {
          window.location.assign(`/doc/${id}`);
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="shell">
      {/* The skip control is the first Tab stop; it moves focus to main. */}
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to main content
      </a>
      <Announcements />

      {/* Main comes next in the DOM so the list controls follow the skip
          control in Tab order; CSS restores the visual composition. */}
      <div className="shell-main">
        <main id="main" ref={mainRef} className="main" tabIndex={-1}>
          {children}
        </main>
        {!isNarrow && (
          <nav className="navigation-rail" aria-label="Workspace" id="workspace-navigation">
            <NavLinks />
          </nav>
        )}
      </div>

      <header className="banner" role="banner">
        <span className="brand">Oddment</span>
        {isNarrow && (
          <button
            className="button"
            aria-expanded={navOpen}
            aria-controls="workspace-navigation"
            onClick={openNav}
          >
            <PanelLeft size={18} aria-hidden /> Open navigation
          </button>
        )}
        <p className="sync-status status-text" role="status" aria-label="Sync status" data-sync-state={syncState}>
          {syncSentence}
        </p>
        {signedIn ? (
          <span title={email ?? ''}>{email}</span>
        ) : (
          <button className="button" onClick={() => setSigninOpen(true)}>
            <LogIn size={18} aria-hidden /> Sign in
          </button>
        )}
      </header>

      {isNarrow && navOpen && (
        <div className="navigation-drawer-open" id="workspace-navigation">
          <div className="drawer-scrim" onClick={() => setNavOpen(false)} />
          <div className="drawer-panel">
            <button className="button" onClick={() => setNavOpen(false)}>
              <X size={18} aria-hidden /> Close navigation
            </button>
            <nav aria-label="Workspace">
              <NavLinks onNavigate={() => setNavOpen(false)} firstRef={firstNavLinkRef} />
            </nav>
          </div>
        </div>
      )}

      {notices.length > 0 && (
        <div role="region" aria-label="Notices" className="notices">
          {notices.map((n) => (
            <div key={n.id} className="notice">
              <span>{n.text}</span>
              <button className="button" onClick={() => dismissNotice(n.id)}>Dismiss notice</button>
            </div>
          ))}
        </div>
      )}

      {signinOpen && (
        <SignInDialog
          onClose={() => setSigninOpen(false)}
          onSignedIn={() => {
            setSigninOpen(false);
            if (!uploadChosen) setUploadOpen(true);
          }}
        />
      )}
      {uploadOpen && signedIn && (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setUploadOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Upload this workspace?" className="dialog">
            <UploadChoice onClose={() => setUploadOpen(false)} uploadRef={uploadButtonRef} />
          </div>
        </div>
      )}
    </div>
  );
}

function SignInDialog({ onClose, onSignedIn }: { onClose: () => void; onSignedIn: () => void }) {
  const setSession = useApp((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<'signin' | 'signup' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const submit = async (signUp: boolean) => {
    setPending(signUp ? 'signup' : 'signin');
    setErrors({});
    try {
      const res = await fetch(signUp ? '/api/accounts' : '/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.user) {
        await setSession(body.user, body.device);
        announce(`Signed in as ${body.user.email}.`);
        onSignedIn();
      } else if (res.status === 503) {
        setErrors({ form: 'We could not reach the server. Nothing has changed on this device.' });
      } else {
        setErrors(body.errors ?? { form: 'We could not reach the server. Nothing has changed on this device.' });
        if (body.errors?.email) emailRef.current?.focus();
      }
    } catch {
      setErrors({ form: 'We could not reach the server. Nothing has changed on this device.' });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sign in"
        className="dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <h2>Sign in</h2>
        {errors.form && <p className="field-error" role="alert">{errors.form}</p>}
        <div className="field" style={{ marginBottom: 10 }}>
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            ref={emailRef}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit(false)}
          />
          {errors.email && <p className="field-error">{errors.email}</p>}
        </div>
        <div className="field" style={{ marginBottom: 10 }}>
          <label htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit(false)}
          />
          {errors.password && <p className="field-error">{errors.password}</p>}
        </div>
        <div className="row">
          <button className="button" onClick={onClose}>Close</button>
          <button className="button" disabled={pending !== null} onClick={() => submit(true)}>
            {pending === 'signup' ? 'Creating account...' : 'Create account'}
          </button>
          <button className="button accent-button" disabled={pending !== null} onClick={() => submit(false)}>
            {pending === 'signin' ? 'Signing in...' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function UploadChoice({ onClose, uploadRef }: { onClose: () => void; uploadRef: React.RefObject<HTMLButtonElement | null> }) {
  const chooseUpload = useApp((s) => s.chooseUpload);
  const chooseKeep = useApp((s) => s.chooseKeep);
  const documents = useApp((s) => s.documents);
  const [pending, setPending] = useState(false);
  const count = documents.filter((d) => !d.trashed && !d.journal).length;

  useEffect(() => {
    uploadRef.current?.focus();
  }, [uploadRef]);

  return (
    <>
      <h2>Upload this workspace?</h2>
      <p>This device holds {count} documents. Nothing leaves this device until you choose.</p>
      <div className="row">
        <button className="button" disabled={pending} onClick={() => { void chooseKeep(); onClose(); }}>
          Keep it on this device
        </button>
        <button
          ref={uploadRef}
          className="button accent-button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await chooseUpload();
            setPending(false);
            onClose();
          }}
        >
          Upload this workspace
        </button>
      </div>
    </>
  );
}
