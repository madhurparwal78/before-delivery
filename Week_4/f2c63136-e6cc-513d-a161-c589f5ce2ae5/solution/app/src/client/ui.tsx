import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { announcement, actionStatus, session, useStore } from './store.ts';
import { Link } from './router.tsx';
import { api } from './api.ts';
import type { ChangeState, TimeView } from '../shared/types.ts';

// ---- icons: drawn inline, one set, stroke 1.75 ----

type IconName = 'check' | 'x' | 'clock' | 'dot' | 'spinner' | 'arrow' | 'merge' | 'lock' | 'file' | 'plus' | 'minus' | 'draft' | 'queue' | 'removed' | 'chevron' | 'alert';

const PATHS: Record<IconName, JSX.Element> = {
  check: <path d="M4 12.5l5 5L20 6.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  dot: <circle cx="12" cy="12" r="4" />,
  spinner: <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  merge: <><circle cx="7" cy="6" r="2.2" /><circle cx="7" cy="18" r="2.2" /><circle cx="17" cy="12" r="2.2" /><path d="M7 8.2v7.6M7 8.2c0 3 3 3.8 7.8 3.8" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  file: <><path d="M7 3.5h7l4 4V20.5H7z" /><path d="M14 3.5v4h4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  draft: <><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3" /></>,
  queue: <path d="M5 7h14M5 12h14M5 17h9" />,
  removed: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12h7" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.2" /></>,
};

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

// ---- status words ----

const STATE_VIEW: Record<ChangeState, { word: string; icon: IconName }> = {
  draft: { word: 'Draft', icon: 'draft' },
  open: { word: 'Open', icon: 'dot' },
  queued: { word: 'Queued', icon: 'queue' },
  merged: { word: 'Merged', icon: 'merge' },
  removed: { word: 'Removed', icon: 'removed' },
};

/** The status bar of a change: a 3 pixel left bar (on the row) plus this icon and word. */
export function StatusWord({ state }: { state: ChangeState }) {
  const view = STATE_VIEW[state];
  return (
    <span className={`status-word status-${state}`}>
      <Icon name={view.icon} size={14} />
      {view.word}
    </span>
  );
}

export function Time({ value }: { value: TimeView }) {
  return <time dateTime={value.iso}>{value.shown}</time>;
}

// ---- buttons and fields ----

type ButtonProps = Omit<JSX.IntrinsicElements['button'], 'size' | 'ref'> & {
  kind?: 'secondary' | 'primary' | 'glow' | 'ghost';
  busy?: boolean;
  buttonRef?: RefObject<HTMLButtonElement>;
};

/** Pending actions keep their label, disable themselves and set aria-busy. */
export function Button({ kind = 'secondary', busy, buttonRef, className, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      ref={buttonRef}
      type={type}
      className={`btn btn-${kind} ${className ?? ''}`}
      disabled={disabled || busy}
      aria-busy={busy ? 'true' : undefined}
    />
  );
}

/** A labelled field; its inline `alert` sits beside the label so the control's name stays exact. */
export function Field({ label, error, children, className }: { label: string; error?: string | null; children: ComponentChildren; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label className="field-control">
        <span className="field-label">{label}</span>
        {children}
      </label>
      {error ? <span role="alert" className="field-error">{error}</span> : null}
    </div>
  );
}

// ---- dialog: native <dialog>, focus kept inside, returns focus to its opener ----

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, onClose, returnFocus, initialFocus, children, className }: {
  title: string;
  onClose: () => void;
  /** The element that gets focus back when the dialog closes. */
  returnFocus: () => HTMLElement | null;
  initialFocus?: string;
  children: ComponentChildren;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const back = useRef(returnFocus);
  back.current = returnFocus;
  const id = useRef(`dialog-${Math.random().toString(36).slice(2, 8)}`);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    const first = (initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) : null) ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      if (dialog.open) dialog.close();
      back.current()?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className ?? ''}`}
      aria-labelledby={id.current}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close.current();
          return;
        }
        if (event.key !== 'Tab') return;
        const items = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
          if (el instanceof HTMLInputElement && el.type === 'radio') {
            // Only the checked radio of a group (or its first, when none is checked) is in the Tab order.
            const group = [...ref.current!.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${el.name}"]`)].filter((radio) => !radio.disabled);
            return el === (group.find((radio) => radio.checked) ?? group[0]);
          }
          return el.offsetParent !== null || el === document.activeElement;
        });
        if (!items.length) return;
        const active = document.activeElement as HTMLElement;
        const last = items[items.length - 1];
        const first = items[0];
        if (event.shiftKey && (active === first || !ref.current!.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !ref.current!.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <h2 id={id.current} className="dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}

// ---- page chrome ----

function Wordmark() {
  return (
    <Link href="/" className="wordmark" aria-label="Ridgestack">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="M3 17l5-8 4 5 3-4 6 7z" />
      </svg>
      <span aria-hidden="true">Ridgestack</span>
    </Link>
  );
}

function Nav() {
  const user = useStore(session);
  return (
    <nav className="nav-pill" aria-label="Workspace">
      <Wordmark />
      <div className="nav-links">
        {user ? (
          <>
            <Link href="/inbox">Inbox</Link>
            <Link href="/repos">Repositories</Link>
            <button
              type="button"
              className="nav-button"
              onClick={async () => {
                await api('POST', '/api/logout');
                window.location.assign('/');
              }}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link href="/login">Log in</Link>
            <Link href="/signup" className="nav-signup">Sign up</Link>
          </>
        )}
      </div>
    </nav>
  );
}

function AnnouncementStrip() {
  const note = useStore(announcement);
  if (!note) return null;
  return (
    <div role="alert" aria-label="Announcement" className="strip">
      <Icon name="alert" size={18} />
      <span>{note.message}</span>
      {note.action}
    </div>
  );
}

function ActionStatus() {
  const text = useStore(actionStatus);
  return (
    <div role="status" aria-label="Action status" className={`action-status ${text ? 'has-text' : ''}`}>
      {text}
    </div>
  );
}

/** Every signed-in or signed-out screen: announcement strip, nav pill, action status, content. */
export function Screen({ children, className }: { children: ComponentChildren; className?: string }) {
  return (
    <>
      <AnnouncementStrip />
      <div className="shell">
        <Nav />
        <ActionStatus />
        <main className={className}>{children}</main>
      </div>
    </>
  );
}

/** Two-pane working screen: stage (about 640px) and rail (about 420px); one column with the rail first below 1024px. */
export function TwoPane({ stage, rail }: { stage: ComponentChildren; rail: ComponentChildren }) {
  return (
    <div className="two-pane">
      <section className="rail" aria-label="Rail">{rail}</section>
      <section className="stage">{stage}</section>
    </div>
  );
}

export function Crosshairs() {
  return (
    <>
      {['tl', 'tr', 'bl', 'br'].map((corner) => (
        <svg key={corner} className={`xh xh-${corner}`} width="11" height="11" viewBox="0 0 11 11" aria-hidden="true" focusable="false">
          <path d="M5.5 0v11M0 5.5h11" stroke="currentColor" stroke-width="1" />
        </svg>
      ))}
    </>
  );
}

/** Loading shows the frame with crosshair marks in its four corners and nothing else. */
export function Loading() {
  return (
    <div className="frame loading" aria-busy="true">
      <Crosshairs />
    </div>
  );
}

export function NotFound() {
  return (
    <Screen className="not-found">
      <div className="card not-found-card">
        <h1>We couldn't find that page</h1>
        <p>It may not exist, or you may not have access to it.</p>
        <Link href="/inbox" className="arrow-link">Back to the inbox</Link>
      </div>
    </Screen>
  );
}

// ---- the Review updates region: every event is appended, the latest three show as toasts ----

export function ReviewUpdates({ lines }: { lines: { id: number; text: string }[] }) {
  return (
    <div role="status" aria-label="Review updates" className="toasts">
      {lines.map((line) => (
        <div key={line.id} className="toast">{line.text}</div>
      ))}
    </div>
  );
}
