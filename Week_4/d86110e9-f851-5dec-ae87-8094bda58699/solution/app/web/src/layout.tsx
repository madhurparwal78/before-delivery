import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, navigate, usePath } from './router';
import { settings } from './settings';
import { useShell } from './shell';
import { OWNER_REASON, VIEWER_REASON, useWide } from './ui';

function LogoMark() {
  const squares = [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]];
  return (
    <svg className="logo-mark" viewBox="0 0 18 18" width="20" height="20" aria-hidden="true">
      {squares.map(([x, y]) => (
        <rect key={`${x}${y}`} x={(x ?? 0) * 6} y={(y ?? 0) * 6} width="5" height="5" rx="1.4" />
      ))}
    </svg>
  );
}

function ReleaseBar() {
  return (
    <section aria-label="Release notice" className="release-bar on-dark">
      <p>
        Runs stay on the version they started on.{' '}
        <a className="link-on-dark" href="#preview" onClick={(event) => {
          event.preventDefault();
          document.getElementById('preview')?.scrollIntoView({ block: 'start' });
          window.history.replaceState(null, '', '#preview');
        }}>
          Learn more
        </a>
      </p>
    </section>
  );
}

function Nav() {
  const { me, workspace, signOut } = useShell();
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const path = usePath();
  const home = workspace?.id ?? me?.workspaces[0]?.id;

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const links = (
    <>
      {me && home ? (
        <>
          <Link to={`/w/${home}`}>Automations</Link>
          <Link to={`/w/${home}/runs`}>Runs</Link>
          <Link to={`/w/${home}/tables`}>Tables</Link>
          <Link to={`/w/${home}/members`}>Members</Link>
        </>
      ) : null}
    </>
  );
  const account = me ? (
    <>
      <select aria-label="Workspace" className="nav-select" value={home} onChange={(event) => navigate(`/w/${event.target.value}`)}>
        {me.workspaces.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
        Sign out
      </button>
    </>
  ) : (
    <>
      <Link to="/sign-in" className="nav-text-link">
        Sign in
      </Link>
      <Link to="/sign-up" className="btn btn-primary">
        Create a workspace
      </Link>
    </>
  );

  return (
    <nav aria-label="Main" className="pill-nav">
      <Link to="/" className="logo" aria-label="Pinbyte Switchyard">
        <LogoMark />
        <span aria-hidden="true">Pinbyte Switchyard</span>
      </Link>
      {wide ? (
        <>
          <div className="nav-links">{links}</div>
          <div className="nav-account">{account}</div>
        </>
      ) : (
        <button ref={menuButton} type="button" className="btn btn-secondary nav-menu-button" aria-expanded={open} aria-controls="nav-menu" onClick={() => setOpen(!open)}>
          Menu
        </button>
      )}
      {!wide && open ? (
        <div id="nav-menu" className="nav-menu">
          <div className="nav-links stacked">{links}</div>
          <div className="nav-account stacked">{account}</div>
        </div>
      ) : null}
    </nav>
  );
}

const FOOTER_COLUMNS: Array<{ title: string; links: Array<{ label: string; to: string }> }> = [
  { title: 'Product', links: [{ label: 'Example automations', to: '/#preview' }, { label: 'Step kinds', to: '/#step-kinds' }, { label: 'Automation stories', to: '/#stories' }] },
  { title: 'Workspace', links: [{ label: 'Create a workspace', to: '/sign-up' }, { label: 'Sign in', to: '/sign-in' }] },
  { title: 'Principles', links: [{ label: 'Draft, then publish', to: '/#preview' }, { label: 'Replay a failed run', to: '/#stories' }] },
];

function SocialMark({ index }: { index: number }) {
  const shapes = [
    <rect key="a" x="4" y="4" width="16" height="16" rx="5" />,
    <circle key="b" cx="12" cy="12" r="8" />,
    <path key="c" d="M4 18 12 5l8 13z" />,
    <path key="d" d="M5 5h6v6H5zM13 13h6v6h-6z" />,
    <path key="e" d="M12 3 21 12 12 21 3 12z" />,
  ];
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" className="social-mark" aria-hidden="true">
      {shapes[index]}
    </svg>
  );
}

function Footer() {
  const { me } = useShell();
  return (
    <footer className="site-footer on-dark">
      <div className="footer-top">
        <div className="footer-lattice" aria-hidden="true">
          <span className="lattice-square" />
        </div>
        <div className="footer-columns">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} className="footer-column">
              <p className="mono-label muted-on-dark">{column.title}</p>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link to={link.to} className="footer-link">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <p id="legal" className="footer-legal muted-on-dark">
        Pinbyte Switchyard is a demonstration product. Every person and business shown here is invented.
      </p>
      {me ? <p className="footer-zone mono-label">Times are shown in {settings.timeZone}</p> : null}
      <div className="footer-bottom">
        <ul className="footer-legal-links">
          <li><a className="footer-link" href="#legal">Terms</a></li>
          <li><a className="footer-link" href="#legal">Privacy</a></li>
        </ul>
        <div className="footer-social" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <SocialMark key={index} index={index} />
          ))}
        </div>
        <p className="footer-copy muted-on-dark">© 2026 Pinbyte Switchyard</p>
      </div>
    </footer>
  );
}

function Regions() {
  const { me, runUpdates, notice, alert, dismiss } = useShell();
  return (
    <>
      {me ? (
        <div role="status" aria-label="Run updates" className="sr-only">
          {runUpdates.map((entry) => (
            <p key={entry.id}>{entry.line}</p>
          ))}
        </div>
      ) : null}
      {me ? (
        <span id="reason-viewer" className="sr-only">
          {VIEWER_REASON}
        </span>
      ) : null}
      {me ? (
        <span id="reason-owner" className="sr-only">
          {OWNER_REASON}
        </span>
      ) : null}
      <div role="status" aria-label="Notices" className="notice-slot">
        {notice === '' ? null : <p className="notice">{notice}</p>}
      </div>
      {alert === null ? null : (
        <div role="alert" className="alert-panel on-dark">
          <p>{alert}</p>
          <button type="button" className="link-on-dark alert-dismiss" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

/** The frame every page sits in: release bar on the landing page, floating nav, the status regions and the footer. */
export function Layout({ children, landing = false }: { children: ReactNode; landing?: boolean }) {
  return (
    <div className="app">
      {landing ? <ReleaseBar /> : null}
      <Nav />
      <Regions />
      <main id="main" className="main">
        {children}
      </main>
      <Footer />
    </div>
  );
}
