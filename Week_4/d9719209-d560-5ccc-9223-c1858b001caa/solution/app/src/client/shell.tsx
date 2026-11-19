import { useEffect, useRef, useState } from 'react';
import type { CommunityView } from '../shared/types.js';
import { ApiError, api, get } from './api.js';
import { announce, Toasts } from './announce.js';
import { useLive, useLiveStatus } from './live.js';
import { Link, usePath } from './router.js';
import { useSession } from './session.js';
import { Banner, Button, MenuIcon } from './ui.js';

function Rail({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const { user, loading } = useSession();
  const path = usePath();
  const [items, setItems] = useState<CommunityView[]>([]);
  const userId = user?.id ?? null;
  const load = (): void => {
    void get<{ items: CommunityView[] }>(userId ? '/api/communities/mine' : '/api/communities').then((r) => setItems(r.items), () => undefined);
  };
  useEffect(() => { if (!loading) load(); }, [userId, loading, path === '/' ? 'home' : path.startsWith('/c/') ? 'c' : 'other']);
  useLive(['home'], (event) => { if (event === 'membership' && userId) load(); });
  return (
    <>
      {open && <button type="button" className="drawer-scrim" aria-label="Close communities" tabIndex={-1} onClick={onClose} />}
      <nav className="rail" aria-label="Communities" id="community-rail" data-open={open} {...(open ? {} : { 'data-closed': 'true' })}>
        <h2>Communities</h2>
        {items.length > 0
          ? <ul>{items.map((c) => <li key={c.id}><Link to={`/c/${c.name}`} aria-current={path.toLowerCase() === `/c/${c.name}`.toLowerCase() ? 'page' : undefined}>{`c/${c.name}`}</Link></li>)}</ul>
          : <p className="muted">{user ? 'You have not joined a community yet.' : 'No communities yet.'}</p>}
        <p><Link to="/communities">All communities</Link></p>
      </nav>
    </>
  );
}

function Masthead({ drawerOpen, onToggle, toggleRef }: { drawerOpen: boolean; onToggle: () => void; toggleRef: React.RefObject<HTMLButtonElement | null> }): React.JSX.Element {
  const { user, loading, signOut } = useSession();
  const status = useLiveStatus();
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <Link to="/" className="wordmark">Moothall</Link>
        <button ref={toggleRef} type="button" className="btn btn-plain drawer-toggle" aria-expanded={drawerOpen} aria-controls="community-rail" onClick={onToggle}>
          <MenuIcon size={20} />Communities
        </button>
        <span id="live-indicator" className="live" data-state={status === 'live' ? 'live' : 'paused'}>{status === 'paused' ? 'Live updates paused' : 'Live'}</span>
        {!loading && (
          <nav className="account-controls" aria-label="Account">
            {user ? (
              <>
                <Link to="/communities/new" className="nav-link">Create community</Link>
                {user.role === 'admin' && <Link to="/admin/reports" className="nav-link">Admin</Link>}
                <Link to={`/u/${user.username}`} className="nav-link">{user.username}</Link>
                <Link to="/settings" className="nav-link">Settings</Link>
                <Button onClick={() => void signOut()}>Sign out</Button>
              </>
            ) : (
              <>
                <Link to="/login" className="nav-link">Sign in</Link>
                <Link to="/signup" className="nav-link">Create account</Link>
              </>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}

export function ResendButton(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const resend = async (): Promise<void> => {
    setBusy(true);
    try {
      await api('POST', '/api/auth/verify/resend');
      announce('Confirmation email sent');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RATE_LIMITED') announce('Too many emails sent — try again later');
      else announce("The email didn't send", true);
    } finally {
      setBusy(false);
    }
  };
  return <Button disabled={busy} onClick={() => void resend()}>Resend email</Button>;
}

export function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user } = useSession();
  const path = usePath();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLElement>(null);

  useEffect(() => { setDrawerOpen(false); }, [path]);
  useEffect(() => {
    const node = document.getElementById('community-rail');
    if (!node) return;
    const narrow = window.matchMedia('(max-width: 767px)');
    const apply = (): void => { node.inert = narrow.matches && !drawerOpen; };
    apply();
    narrow.addEventListener('change', apply);
    return () => narrow.removeEventListener('change', apply);
  }, [drawerOpen]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { setDrawerOpen(false); toggle.current?.focus(); }
    };
    document.addEventListener('keydown', key);
    document.getElementById('community-rail')?.querySelector<HTMLElement>('a')?.focus();
    return () => document.removeEventListener('keydown', key);
  }, [drawerOpen]);
  void rail;

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Masthead drawerOpen={drawerOpen} onToggle={() => setDrawerOpen((o) => !o)} toggleRef={toggle} />
      {user && !user.emailVerified && (
        <div className="frame-banner">
          <Banner tone="warn">
            <p>Confirm your email address to vote, post and reply.</p>
            <ResendButton />
          </Banner>
        </div>
      )}
      <div className="frame">
        <Rail open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        <main id="main" className="page" tabIndex={-1}>{children}</main>
      </div>
      <Toasts />
    </>
  );
}
