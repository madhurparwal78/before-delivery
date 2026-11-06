import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { SCREENS_BY_ROLE, type Role, type SeatView, type SessionUser } from '../shared/contract.js';
import { formatHoursMinutes } from '../shared/zone.js';

export const ROLE_LABELS: Record<Role, string> = {
  scheduler: 'Clinic scheduler',
  org_admin: 'Client org admin',
  dispatcher: 'Agency dispatcher',
  billing_lead: 'Agency billing lead',
  interpreter: 'Freelance interpreter',
};

export function landingPathFor(role: Role): string {
  const entry = SCREENS_BY_ROLE[role][0];
  if (entry === undefined) {
    throw new Error(`role ${role} has no screens`);
  }
  return entry.path;
}

export function TopBar({
  user,
  path,
  onNavigate,
  onSignOut,
}: {
  user: SessionUser;
  path: string;
  onNavigate: (to: string) => void;
  onSignOut: () => void;
}): ReactNode {
  return (
    <header className="topbar">
      <span className="topbar__brand">Teamseat</span>
      <span className="topbar__who">
        {user.name} — {ROLE_LABELS[user.role]}
        {user.org === null ? '' : ` · ${user.org.name}`}
      </span>
      <span className="topbar__zone">All times Central (Chicago)</span>
      <nav className="topbar__nav" aria-label="Main">
        {SCREENS_BY_ROLE[user.role].map((entry) => (
          <a
            key={entry.path}
            className="navlink"
            href={entry.path}
            aria-current={path === entry.path ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(entry.path);
            }}
          >
            {entry.label}
          </a>
        ))}
      </nav>
      <span className="topbar__spacer" />
      <button type="button" className="btn btn--quiet" onClick={onSignOut}>
        Sign out
      </button>
    </header>
  );
}

export function StatusRegion({ name, text }: { name: string; text: string }): ReactNode {
  return (
    <p className="status" role="status" aria-label={name}>
      {text}
    </p>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error === undefined ? null : errorId, hint === undefined ? null : hintId]
    .filter((value): value is string => value !== null)
    .join(' ');
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy: describedBy === '' ? undefined : describedBy })}
      {hint === undefined ? null : (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {error === undefined ? null : (
        <span className="field__error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

function useEnterTransition(): boolean {
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntering(false));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return entering;
}

function useFocusReturn(trigger: string): void {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      opener.current = active;
    }
  }, [trigger]);
  useEffect(
    () => () => {
      opener.current?.focus();
    },
    [],
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
  const entering = useEnterTransition();
  const heading = useRef<HTMLHeadingElement | null>(null);
  useFocusReturn(title);

  useEffect(() => {
    heading.current?.focus();
  }, [title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside
      className={`drawer${entering ? ' drawer--entering' : ''}`}
      role="dialog"
      aria-label={title}
    >
      <div className="drawer__head">
        <h2 ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          Close
        </button>
      </div>
      {children}
    </aside>
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
  const entering = useEnterTransition();
  const panel = useRef<HTMLDivElement | null>(null);
  useFocusReturn(title);

  const focusables = useCallback((): HTMLElement[] => {
    const nodes = panel.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    return nodes === undefined ? [] : Array.from(nodes);
  }, []);

  useEffect(() => {
    focusables()[0]?.focus();
  }, [focusables]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusables, onClose]);

  return (
    <>
      <div className="dialog__scrim" />
      <div
        ref={panel}
        className={`dialog${entering ? ' dialog--entering' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </>
  );
}

export function SeatLane({
  seat,
  fill,
  label,
  animating,
  variant,
  children,
}: {
  seat: number;
  fill: number;
  label: string;
  animating: boolean;
  variant?: 'bar';
  children?: ReactNode;
}): ReactNode {
  const held = fill >= 1;
  return (
    <div
      role="group"
      aria-label={`Seat ${seat}`}
      className={`lane${variant === 'bar' ? ' lane--bar' : ''}${animating ? ' lane--animating' : ''}`}
    >
      <span className="lane__fill" style={{ ['--fill' as string]: String(fill) }} />
      <span className={`lane__label${held && label !== 'open' ? ' lane__label--held' : ''}`}>{label}</span>
      {children}
    </div>
  );
}

export function seatLabelOf(seat: SeatView): string {
  return seat.status === 'open' ? 'open' : (seat.interpreter_initials ?? '');
}

export function coveredCountOf(seats: SeatView[]): number {
  return seats.filter((seat) => seat.status !== 'open').length;
}

export function coveredCountText(covered: number, total: number): string {
  return `${covered} of ${total} covered`;
}

export function UncoveredNumeral({ minutes }: { minutes: number }): ReactNode {
  return (
    <span className="num board__uncovered">
      {formatHoursMinutes(minutes)} <span className="board__uncovered-unit">h</span>
    </span>
  );
}
