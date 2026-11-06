import { ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ServiceStatusDto, SessionUser } from '../../shared/api';
import { ROLE_LABELS } from '../../shared/roles';
import { api } from '../lib/api';
import { MAIL_BANNER, NOT_FOUND_HEADING, NOT_FOUND_LINE, STORAGE_BANNER } from '../lib/copy';
import { currentNotices, dismissNotice, subscribeNotices } from '../lib/notices';
import { navigate } from '../lib/router';

export function ServiceBanner(): JSX.Element {
  const [status, setStatus] = useState<ServiceStatusDto | null>(null);
  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const next = await api<ServiceStatusDto>('/api/status');
        if (live) setStatus(next);
      } catch {
        /* the banner simply stays as it was */
      }
    };
    void read();
    const timer = window.setInterval(read, 10000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);
  const lines: string[] = [];
  if (status?.storage === 'down') lines.push(STORAGE_BANNER);
  if (status?.mail === 'down') lines.push(MAIL_BANNER);
  return (
    <div className="service-banner" role="status" aria-label="Service status">
      {lines.map((line) => (
        <p key={line} className="banner-line">
          <span aria-hidden="true" className="banner-icon">
            !
          </span>
          {line}
        </p>
      ))}
    </div>
  );
}

export function Notices(): JSX.Element {
  const notices = useSyncExternalStore(subscribeNotices, currentNotices);
  return (
    <div className="notices" role="status" aria-label="Notices">
      {notices.map((notice) => (
        <div key={notice.id} className="notice">
          <span>{notice.text}</span>
          {notice.action ? (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                notice.action?.run();
                dismissNotice(notice.id);
              }}
            >
              {notice.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

interface TopBarProps {
  user: SessionUser;
  onSignOut: () => void;
}

export function TopBar({ user, onSignOut }: TopBarProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="top-bar">
      <div className="top-bar-main">
        <span className="product-mark">Furrowbook</span>
        <span className="station-name">{user.stationName}</span>
        <button
          type="button"
          className="menu-toggle"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menu
        </button>
      </div>
      <nav className={`top-bar-links${menuOpen ? ' open' : ''}`}>
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          Workbooks
        </a>
        {user.role === 'data_manager' ? (
          <a
            href="/station"
            onClick={(event) => {
              event.preventDefault();
              navigate('/station');
            }}
          >
            Station
          </a>
        ) : null}
        <span className="member-chip">
          <span className="member-name">{user.name}</span>
          <span className="member-role">{ROLE_LABELS[user.role]}</span>
        </span>
        <button type="button" className="ghost-button" onClick={onSignOut}>
          Sign out
        </button>
      </nav>
    </header>
  );
}

export function NotFoundScreen(): JSX.Element {
  return (
    <main className="centre-screen">
      <div className="paper-card">
        <h1>{NOT_FOUND_HEADING}</h1>
        <p>{NOT_FOUND_LINE}</p>
      </div>
    </main>
  );
}

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
}

/** Dialogs trap focus, return it on close and close on Escape. */
export function Dialog({ title, onClose, children, role = 'dialog' }: DialogProps): JSX.Element {
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    return () => {
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [
      ...(panel.current?.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href]',
      ) ?? []),
    ];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-shade" onKeyDown={onKeyDown}>
      <div className="dialog-panel" role={role} aria-label={title} aria-modal="true" ref={panel}>
        <h2 className="dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function FieldError({ text }: { text: string | null }): JSX.Element | null {
  if (!text) return null;
  return (
    <p className="field-error">
      <span aria-hidden="true" className="banner-icon">
        !
      </span>
      {text}
    </p>
  );
}
