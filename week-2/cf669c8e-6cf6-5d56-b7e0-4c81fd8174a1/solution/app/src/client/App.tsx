import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Panel } from './components/Panel.js';
import { Link, useLocation } from './router.js';
import { HoldProvider, SessionProvider, useHold, useSession } from './session.js';
import { useNarrow } from './hooks.js';
import { useReducedMotion } from './scene/index.js';
import { Configurator } from './pages/Configurator.js';
import { Story } from './pages/Story.js';
import { Bikes, BikePage } from './pages/Bikes.js';
import { RideList, RidePage } from './pages/Rides.js';
import { OrderList, OrderPage } from './pages/Orders.js';
import { Desk, DeskOrderPage } from './pages/Desk.js';
import { Register, SignIn } from './pages/Accounts.js';
import { NotFound } from './pages/NotFound.js';

const KILLBILL_BANNER = 'Payments are paused. Nothing has been charged.';
const REGISTRY_BANNER = 'Plate registry unreachable. Your fit stays unconfirmed until it answers.';

function ProviderBanner(): ReactNode {
  const { providers } = useSession();
  return (
    <div className="provider-banner" role="alert" aria-label="Provider outage">
      {providers.killbill === 'down' ? <p>{KILLBILL_BANNER}</p> : null}
      {providers.registry === 'down' ? <p>{REGISTRY_BANNER}</p> : null}
    </div>
  );
}

function HoldStatus(): ReactNode {
  const { user } = useSession();
  const hold = useHold();
  if (user?.role !== 'rider') return null;
  const m = Math.floor(hold.seconds / 60);
  const ss = String(hold.seconds % 60).padStart(2, '0');
  return (
    <div className="hold-status">
      <div role="status" aria-label="Test-ride hold">{hold.message}</div>
      {hold.ride ? <span role="timer" aria-label="Hold countdown" aria-live="off" className="num">Hold ends in {m}:{ss}</span> : null}
    </div>
  );
}

function NavLinks({ onNavigate, storyRef }: { onNavigate?: () => void; storyRef?: React.Ref<HTMLAnchorElement> }): ReactNode {
  const { user, signOut } = useSession();
  const { path } = useLocation();
  const link = (to: string, label: string, ref?: React.Ref<HTMLAnchorElement>): ReactNode => (
    <li><Link to={to} ref={ref} aria-current={path === to || (to !== '/' && path.startsWith(`${to}/`)) ? 'page' : undefined} onClick={onNavigate}>{label}</Link></li>
  );
  return (
    <ul className="nav-links">
      {link('/', 'Story', storyRef)}
      {link('/configure', 'Configure')}
      {link('/bikes', 'Bikes')}
      {link('/orders', 'My orders')}
      {link('/rides', 'My rides')}
      {user?.role === 'fitter' ? link('/desk', 'Desk') : null}
      <li>
        {user
          ? <button type="button" className="nav-button" onClick={() => { onNavigate?.(); void signOut(); }}>Sign out</button>
          : <Link to="/sign-in" onClick={onNavigate}>Sign in</Link>}
      </li>
    </ul>
  );
}

function Header(): ReactNode {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  const story = useRef<HTMLAnchorElement>(null);
  const wasOpen = useRef(false);
  wasOpen.current = open;

  useLayoutEffect(() => {
    if (!narrow && wasOpen.current) {
      setOpen(false);
      story.current?.focus();
    }
  }, [narrow]);

  return (
    <header className="site-header">
      <div className="header-row">
        <Link to="/" className="brand" aria-label="Ommezwaai Feeler home">
          <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
            <rect x="1" y="1" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M5 22h22M9 22v-6h9l3-5h4M9 16l-2 6" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="9" cy="23" r="3" fill="var(--ground)" stroke="currentColor" strokeWidth="2" />
            <circle cx="24" cy="23" r="3" fill="var(--ground)" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span className="brand-name">Ommezwaai Feeler</span>
        </Link>
        <HoldStatus />
        <button type="button" ref={menu} className="btn menu-button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(true)}>Menu</button>
        <nav aria-label="Main" className="inline-nav"><NavLinks storyRef={story} /></nav>
      </div>
      <Panel open={open} name="Navigation" variant="drawer" onClose={() => setOpen(false)} opener={() => menu.current}>
        <nav aria-label="Main"><NavLinks onNavigate={() => setOpen(false)} /></nav>
      </Panel>
    </header>
  );
}

function Routes(): ReactNode {
  const { path } = useLocation();
  const parts = path.split('/').filter(Boolean);
  const [first, second, third] = parts;
  if (path === '/') return <Story />;
  if (path === '/configure') return <Configurator />;
  if (path === '/bikes') return <Bikes />;
  if (first === 'bikes' && second && parts.length === 2) return <BikePage id={second} />;
  if (path === '/rides') return <RideList />;
  if (first === 'rides' && second && parts.length === 2) return <RidePage id={second} />;
  if (path === '/orders') return <OrderList />;
  if (first === 'orders' && second && parts.length === 2) return <OrderPage id={second} />;
  if (path === '/sign-in') return <SignIn />;
  if (path === '/register') return <Register />;
  if (path === '/desk') return <Desk />;
  if (first === 'desk' && second === 'orders' && third && parts.length === 3) return <DeskOrderPage id={third} />;
  return <NotFound />;
}

function Main(): ReactNode {
  const { path } = useLocation();
  const reduced = useReducedMotion();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!reduced) main.current?.animate([{ transform: 'translateY(8px)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }, [path, reduced]);
  return <main id="main" ref={main}><Routes /></main>;
}

export function App(): ReactNode {
  return (
    <SessionProvider>
      <HoldProvider>
        <a className="skip-link" href="#main">Skip to content</a>
        <Header />
        <ProviderBanner />
        <Main />
        <footer className="site-footer">
          <p>Ommezwaai Feeler · retrofit kits and built e-mopeds for city riders in the Netherlands, Belgium, Germany and Luxembourg.</p>
        </footer>
      </HoldProvider>
    </SessionProvider>
  );
}
