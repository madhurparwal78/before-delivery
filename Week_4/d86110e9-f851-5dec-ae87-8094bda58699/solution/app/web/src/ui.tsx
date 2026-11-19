import {
  useEffect, useRef, useState, useSyncExternalStore,
  type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react';
import { settings } from './settings';
import { useShell } from './shell';
import type { Role } from './types';

export const VIEWER_REASON = 'Viewers cannot change this workspace';
export const OWNER_REASON = 'Only owners can do this';

/** True at the canvas breakpoint and wider; the same threshold shows the full nav and the canvas. */
export function useWide(): boolean {
  const query = `(width >= ${settings.canvasBreakpointPx}px)`;
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    () => window.matchMedia(query).matches,
  );
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia('(prefers-reduced-motion: reduce)');
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
}

/** Whether the signed-in member may change things, and the props that disable a control with its reason. */
export function useAccess(): { canWrite: boolean; isOwner: boolean; locked: (level?: 'write' | 'owner') => { disabled?: true; 'aria-describedby'?: string } } {
  const role: Role | undefined = useShell().workspace?.role;
  const canWrite = role === 'owner' || role === 'editor';
  const isOwner = role === 'owner';
  return {
    canWrite,
    isOwner,
    locked: (level = 'write') => {
      if (level === 'owner' && !isOwner) return { disabled: true, 'aria-describedby': role === 'viewer' ? 'reason-viewer' : 'reason-owner' };
      if (!canWrite) return { disabled: true, 'aria-describedby': 'reason-viewer' };
      return {};
    },
  };
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet';
  busy?: boolean;
}

/** Pill button. While `busy` it is disabled, aria-busy and reads `Working...`. */
export function Button({ variant = 'primary', busy = false, className = '', children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={`btn btn-${variant} ${className}`.trim()} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? 'Working...' : children}
    </button>
  );
}

export function Chip({ status, children }: { status: string; children?: ReactNode }) {
  return (
    <span className="chip" data-chip={status}>
      {children ?? status}
    </span>
  );
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
}

interface ModalProps {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Where focus goes back to on close; defaults to what had focus when the dialog opened. */
  returnTo?: HTMLElement | null;
}

/** A modal dialog: focus enters it, Tab wraps inside it, Escape closes it and focus returns to where it opened. */
export function Modal({ label, onClose, children, className = '', returnTo }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current as HTMLDialogElement;
    const opener = returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialog.showModal();
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(dialog)[0] ?? dialog).focus();
    const cancel = (event: Event): void => {
      event.preventDefault();
      close.current();
    };
    dialog.addEventListener('cancel', cancel);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      if (dialog.open) dialog.close();
      opener?.focus();
    };
  }, [returnTo]);
  const wrap = (event: ReactKeyboardEvent<HTMLDialogElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(ref.current as HTMLElement);
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return event.preventDefault();
    const active = document.activeElement;
    if (!ref.current?.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <dialog ref={ref} aria-label={label} className={`modal ${className}`.trim()} onKeyDown={wrap}>
      {children}
    </dialog>
  );
}

/** Fades and lifts into place once, the first time it enters the viewport. */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const element = ref.current as HTMLDivElement;
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShown(true);
        watcher.disconnect();
      }
    });
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`.trim()} data-shown={shown}>
      {children}
    </div>
  );
}

/** A dot lattice with one white rounded square: the empty-state drawing. */
function Lattice({ className = '' }: { className?: string }) {
  return (
    <div className={`lattice ${className}`.trim()} aria-hidden="true">
      <span className="lattice-square" />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <Lattice />
      <p>{children}</p>
    </div>
  );
}

/** The server's refusal for a field, linked to the field it names. */
export function Problem({ message, field }: { message: string | null; field?: string }) {
  if (message === null) return null;
  const go = (): void => {
    if (field !== undefined) document.getElementById(`field-${field}`)?.focus();
  };
  return (
    <div role="alert" aria-label="Problem" className="problem">
      <a
        href={`#field-${field ?? ''}`}
        onClick={(event) => {
          event.preventDefault();
          go();
        }}
      >
        {message}
      </a>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_unused, index) => (
        <span key={index} className="skeleton-row" />
      ))}
    </div>
  );
}
