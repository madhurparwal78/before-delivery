// The page header with the four links, collapsed behind Menu below 768 pixels.
import { useEffect, useRef, useState, type JSX } from 'react';
import { navigate } from './ui';
import { useApp } from './appState';

const LINKS = [
  { href: '/garage', label: 'Garage' },
  { href: '/boards', label: 'Leaderboards' },
  { href: '/championship', label: 'Championship' },
  { href: '/lobby/new', label: 'Online lobby' }
];

export function useHeaderNav(): { open: boolean; setOpen: (v: boolean) => void; collapse: () => void } {
  const [open, setOpen] = useState(false);
  const collapse = (): void => setOpen(false);
  // Widening to 768 removes the Menu button and shows the links inline.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (): void => { if (mq.matches) setOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return { open, setOpen, collapse };
}

export function Header({ showLinks }: { showLinks: boolean }): JSX.Element {
  const { me, outage } = useApp();
  const { open, setOpen } = useHeaderNav();
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const menuFirstRef = useRef<HTMLAnchorElement | null>(null);
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onNav = (): void => setPath(window.location.pathname);
    window.addEventListener('kerb-navigate', onNav);
    window.addEventListener('popstate', onPop);
    function onPop(): void { setPath(window.location.pathname); }
    return () => {
      window.removeEventListener('kerb-navigate', onNav);
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        menuRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const go = (href: string): void => {
    setOpen(false);
    navigate(href);
  };

  // The inline nav for wide screens, and the panel nav for narrow ones.
  const navInline = (
    <nav className="nav-inline" aria-label="Pages">
      {LINKS.map(l => (
        <a key={l.href} href={l.href} aria-current={path.startsWith(l.href) ? 'page' : undefined}
           onClick={e => { e.preventDefault(); go(l.href); }}>{l.label}</a>
      ))}
    </nav>
  );
  const navPanel = (
    <nav className="nav-links" aria-label="Pages">
      {LINKS.map((l, i) => (
        <a key={l.href} href={l.href} ref={i === 0 ? menuFirstRef : undefined}
           aria-current={path.startsWith(l.href) ? 'page' : undefined}
           onClick={e => { e.preventDefault(); setOpen(false); go(l.href); }}>{l.label}</a>
      ))}
    </nav>
  );

  return (
    <header className="page-head">
      <a className="brand" href="/" onClick={e => { e.preventDefault(); go(me ? '/garage' : '/'); }}>
        Kerb<span className="accent">line</span>
      </a>
      {outage && (
        <div className="alert" role="alert" style={{ margin: 0, padding: '6px 10px' }}>
          Replay storage is unavailable. Runs are held and will verify when it returns.
        </div>
      )}
      {showLinks && (
        <>
          {navInline}
          <button
            ref={menuRef}
            className="menu-btn"
            aria-expanded={open}
            aria-controls="menu-panel"
            onClick={() => { if (open) { setOpen(false); menuRef.current?.focus(); } else { setOpen(true); menuFirstRef.current?.focus(); } }}
          >
            Menu
          </button>
          <div id="menu-panel" className={`menu-panel ${open ? 'open' : ''}`} hidden={!open}>
            {navPanel}
          </div>
        </>
      )}
    </header>
  );
}
