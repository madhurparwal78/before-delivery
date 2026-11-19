import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { can, ROLE_LABEL } from '../../../shared/domain';
import { del } from '../lib/api';
import { disconnectLive } from '../lib/live';
import { useEnv, useLayout, useMe } from '../lib/env';
import { Link, useRouter } from '../lib/router';
import { Modal } from './Modal';
import { Pill } from './ui';

function useSignOut() {
  const { navigate } = useRouter();
  const { reloadMe } = useEnv();
  return async () => {
    await del('/api/session');
    disconnectLive();
    await reloadMe();
    navigate('/login');
  };
}

function GoToToday({ onDone }: { onDone?: () => void }) {
  const { navigate } = useRouter();
  return (
    <Pill
      variant="mint"
      onClick={() => {
        navigate('/today');
        onDone?.();
      }}
    >
      Go to today
    </Pill>
  );
}

function sections(role: ReturnType<typeof useMe>['role']) {
  return [
    { to: '/today', label: 'Today' },
    { to: '/ward', label: 'Ward' },
    { to: '/patients', label: 'Patients' },
    ...(can(role, 'invoices.read') ? [{ to: '/invoices', label: 'Invoices' }] : []),
  ];
}

function ManageMenu() {
  const me = useMe();
  const { path } = useRouter();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);
  return (
    <div className="manage">
      <button ref={button} type="button" className="nav-link" aria-haspopup="menu" aria-expanded={open} aria-controls="manage-panel" onClick={() => setOpen(!open)}>
        Manage
      </button>
      {open && (
        <div ref={panel} id="manage-panel" role="menu" className="manage-panel">
          <Link to="/stock" role="menuitem" className="menu-item">
            Stock
          </Link>
          {can(me.role, 'staff.manage') && (
            <Link to="/staff" role="menuitem" className="menu-item">
              Staff
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Drawer({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const signOut = useSignOut();
  return (
    <Modal label="Menu" onClose={onClose} className="drawer">
      <nav aria-label="Menu sections" className="drawer-nav">
        {sections(me.role).map((s) => (
          <Link key={s.to} to={s.to} className="drawer-link" onClick={onClose}>
            {s.label}
          </Link>
        ))}
        <Link to="/stock" className="drawer-link" onClick={onClose}>
          Stock
        </Link>
        {can(me.role, 'staff.manage') && (
          <Link to="/staff" className="drawer-link" onClick={onClose}>
            Staff
          </Link>
        )}
      </nav>
      <p className="who">{`${me.name}, ${ROLE_LABEL[me.role]}`}</p>
      <div className="drawer-actions">
        <GoToToday onDone={onClose} />
        <Pill variant="outline" className="on-light" onClick={() => void signOut().then(onClose)}>
          Sign out
        </Pill>
        <Pill variant="blue" onClick={onClose}>
          <X aria-hidden="true" size={18} /> Close menu
        </Pill>
      </div>
    </Modal>
  );
}

function Header() {
  const me = useMe();
  const layout = useLayout();
  const signOut = useSignOut();
  const { path } = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [scrolled, setScrolled] = useState(window.scrollY > 0);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className={`site-header ${scrolled ? 'scrolled' : ''}`}>
      <div className="header-row">
        <Link to="/today" className="brand">
          <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28">
            <rect width="28" height="28" rx="9" fill="#00337F" />
            <path d="M8 15.5c2 3 4 4.2 6 4.2s4-1.200 6-4.200" stroke="#3AE3C0" strokeWidth="2.400" strokeLinecap="round" fill="none" />
            <circle cx="10" cy="10" r="2" fill="#3AE3C0" />
            <circle cx="18" cy="10" r="2" fill="#3AE3C0" />
          </svg>
          <span className="sr-only">Roundbook home</span>
          <span aria-hidden="true">Roundbook</span>
        </Link>
        {layout === 'phone' ? (
          <>
            <span className="grow" />
            <button type="button" className="round-button" aria-label="Open menu" aria-haspopup="dialog" onClick={() => setDrawer(true)}>
              <Menu aria-hidden="true" size={22} />
            </button>
            {drawer && <Drawer onClose={() => setDrawer(false)} />}
          </>
        ) : (
          <>
            <nav aria-label="Clinic sections" className="main-nav">
              {sections(me.role).map((s) => (
                <Link key={s.to} to={s.to} className="nav-link" aria-current={path === s.to ? 'page' : undefined}>
                  {s.label}
                </Link>
              ))}
              <ManageMenu />
            </nav>
            <span className="grow" />
            <p className="who">{`${me.name}, ${ROLE_LABEL[me.role]}`}</p>
            <Pill variant="outline" className="on-light" onClick={() => void signOut()}>
              Sign out
            </Pill>
            <GoToToday />
          </>
        )}
      </div>
    </header>
  );
}

function Footer() {
  const me = useMe();
  const groups = [
    { title: 'Front desk', links: [{ to: '/today', label: 'Day view' }, { to: `/book/${me.clinic.slug}`, label: 'Online booking' }] },
    { title: 'Clinical', links: [{ to: '/ward', label: 'Kennel round' }, { to: '/patients', label: 'Animal records' }] },
    { title: 'Money and supplies', links: [...(can(me.role, 'invoices.read') ? [{ to: '/invoices', label: 'Billing' }] : []), { to: '/stock', label: 'Supplies' }] },
    { title: 'Practice', links: can(me.role, 'staff.manage') ? [{ to: '/staff', label: 'Team access' }] : [] },
  ].filter((g) => g.links.length > 0);
  return (
    <footer className="site-footer">
      <nav aria-label="Workspace links" className="footer-grid">
        {groups.map((g) => (
          <div key={g.title} className="footer-col">
            <h2 className="footer-title">{g.title}</h2>
            <ul>
              {g.links.map((l) => (
                <li key={l.to + l.label}>
                  <Link to={l.to}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <p className="footer-line">Roundbook by Larchmere Veterinary Systems</p>
    </footer>
  );
}

/** Every staff screen: the clinic header, one centred column, the workspace footer. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="page" id="main">
        {children}
      </main>
      <Footer />
    </>
  );
}

/** Opening band of a working screen: navy left half with the headline and actions, live right half, two-tone strip. */
export function SplitBand({ title, aside, actions, children, className = '' }: { title: string; aside?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <>
      <div className={`band ${className}`}>
        <div className="band-left">
          <div className="headline-row">
            <h1 ref={heading} tabIndex={-1} id="screen-heading">
              {title}
            </h1>
            {aside}
          </div>
          {actions && <div className="band-actions">{actions}</div>}
        </div>
        <div className="band-right">{children}</div>
      </div>
      <div className="strip" aria-hidden="true">
        <span />
        <span />
      </div>
    </>
  );
}

