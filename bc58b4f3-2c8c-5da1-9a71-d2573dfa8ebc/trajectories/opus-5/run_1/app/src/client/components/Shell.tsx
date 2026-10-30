import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CurrentUser, Role } from '../lib/api';
import { ROLE_LABELS } from '../lib/format';
import { useEscapeKey, useFocusTrap } from '../lib/hooks';

export interface NavLink {
  label: string;
  path: string;
}

const NAV_BY_ROLE: Record<Role, NavLink[]> = {
  scheduler: [{ label: 'Requests', path: '/requests' }],
  org_admin: [
    { label: 'Requests', path: '/requests' },
    { label: 'Schedulers', path: '/org' },
  ],
  dispatcher: [{ label: 'Board', path: '/board' }],
  interpreter: [
    { label: 'Open seats', path: '/offers' },
    { label: 'My seats', path: '/my-seats' },
  ],
  billing_lead: [{ label: 'Billing', path: '/billing' }],
};

export function navigationFor(role: Role): NavLink[] {
  return NAV_BY_ROLE[role];
}

export function landingFor(role: Role): string {
  return NAV_BY_ROLE[role][0]?.path ?? '/';
}

export function TopBar({
  user,
  path,
  onNavigate,
  onSignOut,
}: {
  user: CurrentUser;
  path: string;
  onNavigate: (to: string) => void;
  onSignOut: () => void;
}): ReactNode {
  return (
    <header className="top-bar">
      <div className="top-bar-inner">
        <span className="brand">Teamseat</span>
        <span className="who">
          {user.name} · {ROLE_LABELS[user.role] ?? user.role}
        </span>
        <span className="zone-note">All times Central (Chicago)</span>
        <nav aria-label="Main">
          {navigationFor(user.role).map((link) => (
            <a
              key={link.path}
              href={link.path}
              {...(path === link.path ? { 'aria-current': 'page' as const } : {})}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(link.path);
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <button type="button" className="quiet" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}

export function LiveStatus({ name, message }: { name: string; message: string }): ReactNode {
  return (
    <div role="status" aria-label={name}>
      {message}
    </div>
  );
}

export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): ReactNode {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEscapeKey(onClose);
  useFocusTrap(panel);

  useEffect(() => {
    heading.current?.focus();
  }, [title]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={title} ref={setPanel}>
        <div className="drawer-head">
          <h2 tabIndex={-1} ref={heading}>
            {title}
          </h2>
          <button type="button" className="quiet" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): ReactNode {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEscapeKey(onClose);
  useFocusTrap(panel);

  useEffect(() => {
    const opener = document.activeElement;
    heading.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-label={title} ref={setPanel}>
        <h2 tabIndex={-1} ref={heading}>
          {title}
        </h2>
        {children}
      </div>
    </>
  );
}
