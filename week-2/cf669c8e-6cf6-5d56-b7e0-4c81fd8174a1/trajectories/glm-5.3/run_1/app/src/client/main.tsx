import { useEffect, useRef, useState } from 'preact/hooks';
import { render } from 'preact';
import type { ComponentChild } from 'preact';
import { api } from './api';
import type { User } from './types';
import { Configurator } from './configurator';
import { OrdersList, OrderPage, NotFound } from './screens';
import { BikesList, BikePage, RidesList, RidePage, Desk, DeskOrder, SignIn, Register, Story } from './screens2';
import { useDialog } from './screens';

// App shell: routing, session and the sign-in-again dialog.

let currentUser: User | null = null;
const userListeners = new Set<(u: User | null) => void>();

function setUser(u: User | null): void {
  currentUser = u;
  for (const l of userListeners) l(u);
}

function useUser(): User | null {
  const [u, setU] = useState<User | null>(currentUser);
  useEffect(() => {
    userListeners.add(setU);
    return () => {
      userListeners.delete(setU);
    };
  }, []);
  return u;
}

function Header({ path }: { path: string }): ComponentChild {
  const user = useUser();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const links: { href: string; label: string }[] = [
    { href: '/', label: 'Story' },
    { href: '/configure', label: 'Configure' },
    { href: '/bikes', label: 'Bikes' },
    { href: '/orders', label: 'My orders' },
    { href: '/rides', label: 'My rides' },
  ];
  if (user?.role === 'fitter') links.push({ href: '/desk', label: 'Desk' });
  const closeDrawer = () => {
    setDrawerOpen(false);
    menuRef.current?.focus();
  };
  const nav = (onClickItem?: () => void) => (
    <nav aria-label="Main">
      {links.map((l) => (
        <a key={l.href} href={l.href} data-route onClick={onClickItem} aria-current={path === l.href ? 'page' : undefined}>{l.label}</a>
      ))}
      {user ? (
        <a href="/sign-out" data-route id="sign-out-link">Sign out</a>
      ) : (
        <a href="/sign-in" data-route onClick={onClickItem}>Sign in</a>
      )}
    </nav>
  );
  return (
    <header class="site-header">
      <a class="brand" href="/" data-route>Ommezwaai <em>Feeler</em></a>
      <div class="nav-links">{nav()}</div>
      {user && user.role === 'rider' ? <HoldIndicator /> : null}
      <button
        ref={menuRef}
        class="menu-button"
        aria-expanded={drawerOpen}
        aria-controls="nav-drawer"
        onClick={() => setDrawerOpen(true)}
      >Menu</button>
      {drawerOpen ? (
        <div
          class="nav-drawer"
          id="nav-drawer"
          role="dialog"
          aria-label="Navigation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDrawer();
          }}
        >
          <aside>
            <button onClick={closeDrawer}>Close</button>
            {nav(closeDrawer)}
          </aside>
        </div>
      ) : null}
    </header>
  );
}

function HoldIndicator(): ComponentChild {
  const user = useUser();
  const [hold, setHold] = useState<{ id: string; remaining: number } | null>(null);
  useEffect(() => {
    if (!user) return;
    let stopped = false;
    const tick = async () => {
      try {
        const rides = await api<{ rides: { id: string; state: string; remainingSeconds: number }[] }>('GET', '/api/test-rides');
        if (stopped) return;
        const live = rides.rides.find((r) => r.state === 'held');
        setHold(live ? { id: live.id, remaining: live.remainingSeconds } : null);
      } catch {
        /* session answers are handled by the sign-in-again dialog */
      }
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [user?.id]);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!hold) return;
    setSeconds(hold.remaining);
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [hold?.id, hold?.remaining]);
  const minutes = Math.ceil(seconds / 60);
  return (
    <div class="hold-area">
      <p role="status" aria-live="polite" aria-label="Test-ride hold" style="margin:0">
        {hold && seconds > 0 ? `Hold ends in ${minutes} min.` : ''}
      </p>
      {hold && seconds > 0 ? (
        <div role="timer" aria-label="Hold countdown" aria-live="off">
          Hold ends in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </div>
      ) : null}
    </div>
  );
}

function SignAgainDialog({ open, onClose }: { open: boolean; onClose: () => void }): ComponentChild {
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useDialog(open, onClose, openerRef);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  if (!open) return null;
  return (
    <dialog ref={dialogRef} aria-label="Sign in again">
      <h2>Sign in again</h2>
      <p>Your session ended. Sign in to carry on.</p>
      <form onSubmit={async (e) => {
        e.preventDefault();
        try {
          const user = await api<User>('POST', '/api/auth/sign-in', { email: currentUser?.email ?? '', password });
          setUser(user);
          onClose();
        } catch {
          setError('Email or password is wrong.');
        }
      }}>
        <div class="field">
          <label for="sa-email">Email</label>
          <input id="sa-email" aria-label="Email" value={currentUser?.email ?? ''} readOnly />
        </div>
        <div class="field">
          <label for="sa-password">Password</label>
          <input id="sa-password" aria-label="Password" type="password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        </div>
        {error ? <p class="alert-banner">{error}</p> : null}
        <div class="dialog-actions">
          <span />
          <button class="primary" type="submit">Sign in</button>
        </div>
      </form>
    </dialog>
  );
}

function Screen({ path }: { path: string }): ComponentChild {
  const url = new URL(window.location.href);
  const seg = path.split('/').filter(Boolean);
  if (path === '/' || path === '') return <Story />;
  if (path === '/configure') return <Configurator url={url} />;
  if (path === '/bikes') return <BikesList />;
  if (seg[0] === 'bikes' && seg[1]) return <BikePage bikeId={decodeURIComponent(seg[1])} />;
  if (path === '/rides') return <RidesList />;
  if (seg[0] === 'rides' && seg[1]) return <RidePage rideId={decodeURIComponent(seg[1])} />;
  if (path === '/orders') return <OrdersList />;
  if (seg[0] === 'orders' && seg[1]) return <OrderPage orderId={decodeURIComponent(seg[1])} />;
  if (path === '/sign-in') return <SignIn />;
  if (path === '/register') return <Register />;
  if (path === '/desk') return <Desk />;
  if (seg[0] === 'desk' && seg[1] === 'orders' && seg[2]) return <DeskOrder orderId={decodeURIComponent(seg[2])} />;
  if (path === '/sign-out') return <SignOut />;
  return <NotFound />;
}

function SignOut(): ComponentChild {
  useEffect(() => {
    void api('POST', '/api/auth/sign-out').then(() => {
      setUser(null);
      window.location.href = '/';
    });
  }, []);
  return <main class="narrow"><h1>Signing out…</h1></main>;
}

function App(): ComponentChild {
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  const [signAgain, setSignAgain] = useState(false);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener('popstate', onPop);
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a[data-route]') as HTMLAnchorElement | null;
      if (!target) return;
      e.preventDefault();
      history.pushState(null, '', target.pathname + target.search);
      setPath(target.pathname + target.search);
    };
    document.addEventListener('click', onClick);
    const onSignAgain = () => setSignAgain(true);
    window.addEventListener('sign-again', onSignAgain);
    void api<User>('GET', '/api/me').then((u) => setUser(u)).catch(() => setUser(null));
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onClick);
      window.removeEventListener('sign-again', onSignAgain);
    };
  }, []);
  const pathname = path.split('?')[0] ?? '/';
  return (
    <div>
      <Header path={pathname} />
      <Screen path={pathname} />
      <SignAgainDialog open={signAgain} onClose={() => setSignAgain(false)} />
    </div>
  );
}

render(<App />, document.getElementById('root')!);
