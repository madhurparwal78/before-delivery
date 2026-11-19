import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { get, RequestFailed } from './api';
import { setClinicZone } from './time';
import { startLiveFeed, useLive } from './live';
import { AnnouncementsRegion, Dialog, Pill, useAnnounce } from './ui';
import { dateDayDdMonYyyy } from './time';
import { TodayScreen } from './screens/today';
import { WardScreen } from './screens/ward';
import { PatientsScreen, PatientRecordScreen } from './screens/patients';
import { ConsultScreen } from './screens/consult';
import { InvoicesScreen, InvoiceDetailScreen } from './screens/invoices';
import { StockScreen } from './screens/stock';
import { StaffScreen } from './screens/staff';
import { LoginScreen, InviteScreen } from './screens/login';
import { PublicBookingScreen, ConfirmationScreen } from './screens/public';

export type Role = 'front-desk' | 'nurse' | 'vet' | 'manager';

export const ROLE_LABELS: Record<Role, string> = {
  'front-desk': 'Front desk',
  nurse: 'Nurse',
  vet: 'Vet',
  manager: 'Manager',
};

export type Session = {
  id: string;
  name: string;
  role: Role;
  email: string;
  clinic: { id: string; name: string; slug: string };
};

export type ClinicTime = { now: string; clinicDate: string; timeZone: string };

type AppContextValue = {
  session: Session | null;
  clinicTime: ClinicTime | null;
  navigate: (path: string) => void;
  path: string;
  search: string;
  reloadSession: () => void;
};

const AppContext = createContext<AppContextValue>({
  session: null,
  clinicTime: null,
  navigate: () => undefined,
  path: '/',
  search: '',
  reloadSession: () => undefined,
});

export function useApp(): AppContextValue {
  return useContext(AppContext);
}

export type Viewport = 'phone' | 'tablet' | 'desktop';

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(readViewport);
  useEffect(() => {
    const update = (): void => setViewport(readViewport());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return viewport;
}

function readViewport(): Viewport {
  if (window.matchMedia('(max-width: 600px)').matches) return 'phone';
  if (window.matchMedia('(max-width: 1023px)').matches) return 'tablet';
  return 'desktop';
}

export function App(): JSX.Element {
  const [path, setPath] = useState(window.location.pathname);
  const [search, setSearch] = useState(window.location.search);
  const [session, setSession] = useState<Session | null>(null);
  const [clinicTime, setClinicTime] = useState<ClinicTime | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onPop = (): void => {
      setPath(window.location.pathname);
      setSearch(window.location.search);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (target: string): void => {
    const [targetPath, targetSearch = ''] = target.split('?');
    window.history.pushState({}, '', target);
    setPath(targetPath);
    setSearch(targetSearch ? `?${targetSearch}` : '');
  };

  const loadSession = async (): Promise<void> => {
    try {
      const profile = await get<Session>('/api/me');
      setSession(profile);
      startLiveFeed();
    } catch (error) {
      if (error instanceof RequestFailed && error.status === 401) setSession(null);
    } finally {
      setReady(true);
    }
  };

  useEffect(() => {
    void loadSession();
    void get<ClinicTime>('/api/time').then((time) => {
      setClinicZone(time.timeZone);
      setClinicTime(time);
    });
  }, []);

  useLive((message) => {
    if (message.kind === 'role') void loadSession();
    if (message.kind === 'revoked') {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?next=${next}`);
    }
  });

  const value: AppContextValue = {
    session,
    clinicTime,
    navigate,
    path,
    search,
    reloadSession: () => void loadSession(),
  };

  return (
    <AppContext.Provider value={value}>
      <AnnouncementsRegion>
        <ServerAnnouncements />
        <Routes ready={ready} />
      </AnnouncementsRegion>
    </AppContext.Provider>
  );
}

/** Carries the two server-started announcements into the polite region. */
function ServerAnnouncements(): null {
  const announce = useAnnounce();
  const { session, path } = useApp();
  useLive((message) => {
    if (message.kind !== 'announce') return;
    if (message.audience === 'manager' && session?.role !== 'manager') return;
    if (message.audience === 'all' && path !== '/today' && path !== '/ward') return;
    announce(message.text);
  });
  return null;
}

function Routes({ ready }: { ready: boolean }): JSX.Element {
  const { path: asked, session, navigate } = useApp();
  const path = asked === '/' ? '/today' : asked;
  const segments = path.split('/').filter(Boolean);

  if (path === '/login') return <LoginScreen />;
  if (segments[0] === 'invite' && segments[1]) return <InviteScreen token={segments[1]} />;
  if (segments[0] === 'book' && segments[1]) {
    if (segments[2] === 'confirmation' && segments[3]) {
      return <ConfirmationScreen slug={segments[1]} code={segments[3]} />;
    }
    if (segments.length === 2) return <PublicBookingScreen slug={segments[1]} />;
    return <PublicNotFound />;
  }

  if (!ready) return <div className="loading" aria-hidden="true" />;
  if (!session) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login?next=${next}`);
    return <div className="loading" aria-hidden="true" />;
  }

  const screen = ((): ReactNode => {
    if (path === '/today') return <TodayScreen />;
    if (path === '/ward') return <WardScreen />;
    if (path === '/patients') return <PatientsScreen />;
    if (segments[0] === 'patients' && segments[1]) return <PatientRecordScreen patientId={segments[1]} />;
    if (segments[0] === 'consult' && segments[1]) return <ConsultScreen appointmentId={segments[1]} />;
    if (path === '/invoices') return <InvoicesScreen />;
    if (segments[0] === 'invoices' && segments[1]) return <InvoiceDetailScreen invoiceId={segments[1]} />;
    if (path === '/stock') return <StockScreen />;
    if (path === '/staff') return <StaffScreen />;
    return <NotFoundCard onNavigate={navigate} />;
  })();

  return <StaffScreenFrame>{screen}</StaffScreenFrame>;
}

export function NotFoundCard({ onNavigate }: { onNavigate: (path: string) => void }): JSX.Element {
  return (
    <div className="screen-body">
      <div className="empty-card tint-sky">
        <p className="card-title">We couldn&apos;t find that page.</p>
        <Pill onClick={() => onNavigate('/today')}>Back to today</Pill>
      </div>
    </div>
  );
}

function PublicNotFound(): JSX.Element {
  return (
    <main className="public-page">
      <NotFoundCard onNavigate={(target) => window.location.assign(target)} />
    </main>
  );
}

function StaffScreenFrame({ children }: { children: ReactNode; title?: string }): JSX.Element {
  return (
    <>
      <ClinicHeader />
      <main className="workspace">{children}</main>
      <WorkspaceFooter />
    </>
  );
}

function ClinicHeader(): JSX.Element {
  const { session, navigate, path } = useApp();
  const viewport = useViewport();
  const [manageOpen, setManageOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const manageButton = useRef<HTMLButtonElement | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setManageOpen(false), [path]);

  const role = session?.role ?? 'front-desk';
  const canSeeInvoices = role !== 'nurse';
  const canSeeStaff = role === 'manager';

  const signOut = async (): Promise<void> => {
    await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' });
    window.location.replace('/login');
  };

  const links: { label: string; path: string }[] = [
    { label: 'Today', path: '/today' },
    { label: 'Ward', path: '/ward' },
    { label: 'Patients', path: '/patients' },
    ...(canSeeInvoices ? [{ label: 'Invoices', path: '/invoices' }] : []),
  ];

  return (
    <header className={`clinic-header${scrolled ? ' scrolled' : ''}`} role="banner">
      <div className="header-inner">
        <a
          className="header-home"
          href="/today"
          onClick={(event) => {
            event.preventDefault();
            navigate('/today');
          }}
        >
          Roundbook home
        </a>
        {viewport === 'phone' ? (
          <>
            <button
              type="button"
              className="round-button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              <span aria-hidden="true">≡</span>
            </button>
            {drawerOpen ? (
              <Dialog name="Menu" onClose={() => setDrawerOpen(false)} className="menu-drawer">
                <nav aria-label="Clinic sections" className="drawer-links">
                  {links.map((link) => (
                    <a
                      key={link.path}
                      href={link.path}
                      onClick={(event) => {
                        event.preventDefault();
                        setDrawerOpen(false);
                        navigate(link.path);
                      }}
                    >
                      {link.label}
                    </a>
                  ))}
                  <a
                    href="/stock"
                    onClick={(event) => {
                      event.preventDefault();
                      setDrawerOpen(false);
                      navigate('/stock');
                    }}
                  >
                    Stock
                  </a>
                  {canSeeStaff ? (
                    <a
                      href="/staff"
                      onClick={(event) => {
                        event.preventDefault();
                        setDrawerOpen(false);
                        navigate('/staff');
                      }}
                    >
                      Staff
                    </a>
                  ) : null}
                </nav>
                <Pill
                  onClick={() => {
                    setDrawerOpen(false);
                    navigate('/today');
                  }}
                >
                  Go to today
                </Pill>
                <Pill variant="secondary" onClick={() => void signOut()}>
                  Sign out
                </Pill>
                <Pill variant="secondary" onClick={() => setDrawerOpen(false)}>
                  Close menu
                </Pill>
              </Dialog>
            ) : null}
          </>
        ) : (
          <>
            <nav aria-label="Clinic sections" className="header-nav">
              {links.map((link) => (
                <a
                  key={link.path}
                  href={link.path}
                  className={path === link.path ? 'current' : ''}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(link.path);
                  }}
                >
                  {link.label}
                </a>
              ))}
              <div
                className="manage-wrap"
                onKeyDown={(event) => {
                  if (event.key !== 'Escape' || !manageOpen) return;
                  setManageOpen(false);
                  manageButton.current?.focus();
                }}
              >
                <button
                  type="button"
                  ref={manageButton}
                  aria-expanded={manageOpen}
                  aria-haspopup="menu"
                  className="header-manage"
                  onClick={() => setManageOpen((open) => !open)}
                >
                  Manage
                </button>
                {manageOpen ? (
                  <div role="menu" className="manage-panel">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setManageOpen(false);
                        navigate('/stock');
                      }}
                    >
                      Stock
                    </button>
                    {canSeeStaff ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setManageOpen(false);
                          navigate('/staff');
                        }}
                      >
                        Staff
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </nav>
            <div className="header-right">
              <span className="header-person">
                {session ? `${session.name}, ${ROLE_LABELS[session.role]}` : ''}
              </span>
              <button type="button" className="header-signout" onClick={() => void signOut()}>
                Sign out
              </button>
              <Pill onClick={() => navigate('/today')}>Go to today</Pill>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

function WorkspaceFooter(): JSX.Element {
  const { session, navigate } = useApp();
  const role = session?.role ?? 'front-desk';
  const slug = session?.clinic.slug ?? '';
  const columns: { heading: string; links: { label: string; path: string; external?: boolean }[] }[] = [
    {
      heading: 'Front desk',
      links: [
        { label: 'Day view', path: '/today' },
        { label: 'Online booking', path: `/book/${slug}`, external: true },
      ],
    },
    {
      heading: 'Clinical',
      links: [
        { label: 'Kennel round', path: '/ward' },
        { label: 'Animal records', path: '/patients' },
      ],
    },
    {
      heading: 'Money and supplies',
      links: [
        ...(role === 'nurse' ? [] : [{ label: 'Billing', path: '/invoices' }]),
        { label: 'Supplies', path: '/stock' },
      ],
    },
    {
      heading: 'Practice',
      links: role === 'manager' ? [{ label: 'Team access', path: '/staff' }] : [],
    },
  ];
  return (
    <footer className="workspace-footer" role="contentinfo">
      <nav aria-label="Workspace links" className="footer-grid">
        {columns.map((column) => (
          <div key={column.heading} className="footer-column">
            <p className="footer-heading">{column.heading}</p>
            {column.links.map((link) => (
              <a
                key={link.label}
                href={link.path}
                onClick={(event) => {
                  if (link.external) return;
                  event.preventDefault();
                  navigate(link.path);
                }}
              >
                {link.label}
              </a>
            ))}
          </div>
        ))}
      </nav>
      <p className="footer-line">Roundbook by Larchmere Veterinary Systems</p>
    </footer>
  );
}

export function SplitBand({
  headline,
  actions,
  right,
}: {
  headline: ReactNode;
  actions?: ReactNode;
  right: ReactNode;
}): JSX.Element {
  return (
    <section className="split-band">
      <div className="split-grid">
        <div className="split-navy">
          <div className="split-headline">{headline}</div>
          {actions ? <div className="split-actions">{actions}</div> : null}
        </div>
        <div className="split-live">{right}</div>
      </div>
      <div className="split-strip" aria-hidden="true">
        <span />
        <span />
      </div>
    </section>
  );
}

export function ClinicDateText(): JSX.Element {
  const { clinicTime } = useApp();
  return (
    <span className="clinic-date">
      {clinicTime ? dateDayDdMonYyyy(clinicTime.clinicDate) : ''}
    </span>
  );
}

export function ForbiddenCard(): JSX.Element {
  return (
    <div className="screen-body">
      <div className="empty-card tint-rose">
        <p className="card-title">Your role cannot do that.</p>
      </div>
    </div>
  );
}
