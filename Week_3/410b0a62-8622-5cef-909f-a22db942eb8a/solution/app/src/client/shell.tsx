import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import type { AthleteRow, LinkRow, Me } from '../shared/types.js';
import { failureMessage, fieldErrors, get, post } from './api.js';
import { useLoaded } from './hooks.js';
import { useLive } from './live.js';
import { Link, navigate, useLocation } from './router.js';
import { useSession } from './session.js';
import { Dialog, Field, focusFirstInvalid, Pill } from './ui.js';

function Wordmark() {
  return (
    <Link to="/" className="wordmark">
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
        <rect width="32" height="32" rx="9" className="wordmark-tile" />
        <path d="M8 23 14 9h5l-6 14z" className="wordmark-stroke" />
        <path d="M17 23 23 9h3l-6 14z" className="wordmark-stroke-2" />
      </svg>
      <span className="wordmark-text">
        <strong>Tempoline</strong>
        <small>Ottermere Sport</small>
      </span>
    </Link>
  );
}

function Notices() {
  const { notices, clearNotices } = useLive();
  const latest = notices[notices.length - 1];
  return (
    <div role="status" aria-label="Notices" className="notices">
      {notices.map((notice) => (
        <span key={notice.id} className={notice === latest ? 'notice notice-latest' : 'sr-only'}>
          {notice.text}
        </span>
      ))}
      {latest && (
        <button type="button" className="notice-dismiss" aria-label="Dismiss notices" onClick={clearNotices}>
          <X aria-hidden="true" size={18} />
        </button>
      )}
    </div>
  );
}

function useLinkedAthletes(enabled: boolean) {
  return useLoaded(() => (enabled ? get<{ athletes: AthleteRow[] }>('/api/athletes').then((body) => body.athletes) : Promise.resolve([])), [enabled]);
}

function AthletesMenu({ athletes }: { athletes: AthleteRow[] }) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const { path } = useLocation();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: MouseEvent): void => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  return (
    <div className="nav-dropdown" ref={holder} onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}>
      <button type="button" className="nav-link" aria-expanded={open} aria-controls="athletes-menu" onClick={() => setOpen((current) => !current)}>
        Athletes
        <ChevronDown className={open ? 'chevron chevron-open' : 'chevron'} aria-hidden="true" size={16} />
      </button>
      {open && (
        <ul id="athletes-menu" className="nav-panel">
          <li>
            <Link to="/coach">All athletes</Link>
          </li>
          {athletes.map((athlete) => (
            <li key={athlete.id}>
              <Link to={`/athletes/${athlete.id}`}>{athlete.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AthleteSwitcher({ athletes }: { athletes: AthleteRow[] }) {
  const { path } = useLocation();
  const current = /^\/athletes\/([^/]+)/.exec(path)?.[1] ?? '';
  const known = athletes.some((athlete) => athlete.id === current);
  return (
    <select
      className="switcher"
      aria-label="Athlete"
      value={known ? current : ''}
      onChange={(event) => event.target.value && navigate(`/athletes/${event.target.value}`)}
    >
      {!known && <option value="">Choose athlete</option>}
      {athletes.map((athlete) => (
        <option key={athlete.id} value={athlete.id}>
          {athlete.name}
        </option>
      ))}
    </select>
  );
}

const navFor = (me: Me): { to: string; label: string }[] =>
  me.role === 'coach'
    ? [
        { to: '/plans', label: 'Plans' },
        { to: '/inbox', label: 'Inbox' }
      ]
    : [
        { to: `/athletes/${me.id}`, label: 'Calendar' },
        { to: `/athletes/${me.id}/builder`, label: 'Builder' },
        { to: '/coaches', label: 'Coaches' }
      ];

export function Header({ me }: { me: Me }) {
  const { signOut } = useSession();
  const { path } = useLocation();
  const [menu, setMenu] = useState(false);
  const linked = useLinkedAthletes(me.role === 'coach');
  const athletes = linked.data ?? [];
  const links = navFor(me);
  const active = (to: string): boolean => path === to;

  useEffect(() => setMenu(false), [path]);

  return (
    <header className="site-header">
      <div className="header-inner">
        <Wordmark />
        <nav aria-label="Primary" className="nav-main">
          {me.role === 'coach' && <AthletesMenu athletes={athletes} />}
          {links.map((link) => (
            <Link key={link.to} to={link.to} className="nav-link" aria-current={active(link.to) ? 'page' : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="header-right">
          {me.role === 'coach' && <AthleteSwitcher athletes={athletes} />}
          <Notices />
          <Pill tone="navy" className="pill-compact" onClick={() => void signOut()}>
            Sign out
          </Pill>
          <button type="button" className="menu-button" aria-label="Menu" onClick={() => setMenu(true)}>
            <Menu aria-hidden="true" size={22} />
          </button>
        </div>
      </div>
      {menu && (
        <Dialog title="Menu" variant="drawer" onClose={() => setMenu(false)} returnFocus={() => document.querySelector<HTMLElement>('.menu-button')}>
          <nav aria-label="Menu" className="drawer-nav">
            {me.role === 'coach' && (
              <>
                <Link to="/coach" className="drawer-link">
                  All athletes
                </Link>
                {athletes.map((athlete) => (
                  <Link key={athlete.id} to={`/athletes/${athlete.id}`} className="drawer-link drawer-sub">
                    {athlete.name}
                  </Link>
                ))}
              </>
            )}
            {links.map((link) => (
              <Link key={link.to} to={link.to} className="drawer-link">
                {link.label}
              </Link>
            ))}
          </nav>
          <Pill tone="ghost" onClick={() => setMenu(false)}>
            Close menu
          </Pill>
        </Dialog>
      )}
    </header>
  );
}

function CoachCodeForm() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (error) focusFirstInvalid(form.current, ['coach_code'], { coach_code: error });
  }, [error]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const { link } = await post<{ link: LinkRow }>('/api/links', { coach_code: code });
      setSentTo(link.coach_name);
    } catch (failure) {
      setError(fieldErrors(failure)?.['coach_code'] ?? failureMessage(failure));
    } finally {
      setPending(false);
    }
  };

  if (sentTo) return <p className="footer-confirm">{`Request sent to ${sentTo}. They'll appear under Coaches once they accept.`}</p>;
  return (
    <form ref={form} onSubmit={(event) => void submit(event)} className="coach-code-form" noValidate>
      <div className="footer-copy">
        <h2>Have a coach?</h2>
        <p>Enter their coach code to send a link request.</p>
      </div>
      <Field label="Coach code" error={error} className="field-on-dark">
        {(props) => <input {...props} data-field="coach_code" type="text" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} />}
      </Field>
      <Pill tone="cobalt" type="submit" pending={pending} pendingText="Sending…">
        Send request
      </Pill>
    </form>
  );
}

export function Footer({ me }: { me: Me }) {
  const links = me.role === 'coach' ? [{ to: '/coach', label: 'Athletes' }, ...navFor(me)] : navFor(me);
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-main">
          {me.role === 'athlete' ? <CoachCodeForm /> : <p className="footer-code">{`Your coach code: ${me.coach_code ?? ''}`}</p>}
        </div>
      </div>
      <div className="wrap footer-base">
        <p className="footer-brand">Ottermere Sport Tempoline</p>
        <nav aria-label="Footer" className="footer-links">
          {links.map((link) => (
            <Link key={link.to} to={link.to}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export function NotFound() {
  return (
    <section className="not-found wrap">
      <h1>Not found</h1>
      <p>This page isn&apos;t available to you.</p>
      <Link to="/" className="pill pill-navy">
        Back to home
      </Link>
    </section>
  );
}

