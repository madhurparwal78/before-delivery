import { useEffect, useLayoutEffect, useRef, type AnchorHTMLAttributes, type ReactNode, type RefObject } from 'react';
import { formatNumber } from '../shared/domain';
import { navigate } from './router';
import type { Store } from './store';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.closest('[hidden], [inert]'));
}

/** Tab wraps inside `root` while `active`; Escape runs `onEscape` when given. */
export function useFocusTrap(root: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void): void {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      const element = root.current;
      if (element === null) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        escape.current?.();
      }
      if (event.key !== 'Tab') return;
      const items = focusablesIn(element);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!element.contains(current)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [active, root]);
}

/** Returns focus to the opener, or to the screen's main heading when the opener has gone. */
export function restoreFocus(opener: HTMLElement | null): void {
  if (opener !== null && opener.isConnected) opener.focus();
  else document.querySelector<HTMLElement>('h1')?.focus();
}

interface ModalProps {
  label: string;
  role?: 'dialog' | 'alertdialog';
  onEscape?: () => void;
  children: ReactNode;
}

export function Modal({ label, role = 'dialog', onEscape, children }: ModalProps): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, true, onEscape);
  useLayoutEffect(() => {
    const element = box.current as HTMLDivElement;
    (focusablesIn(element)[0] ?? element).focus();
  }, []);
  return (
    <>
      <div className="modal-backdrop" />
      <div ref={box} className="modal" role={role} aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </>
  );
}

export function Link({ href, children, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): ReactNode {
  return (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        navigate(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/** Big Shoulders has no tabular digits and its 1 is half as wide as the rest, so each digit sits in a cell of one width. */
export function Figures({ text }: { text: string }): ReactNode {
  return <span className="figures-run">{[...text].map((char, index) => (/\d/.test(char) ? <span className="digit" key={index}>{char}</span> : char))}</span>;
}

function ChipValue({ label, value, stale }: { label: string; value: number | undefined; stale: boolean }): ReactNode {
  return (
    <span className="chip">
      <span className="caption" aria-hidden="true">{label}</span>
      <span role="status" aria-label={label} className="chip-value">
        {value === undefined ? (stale ? null : '–') : <Figures text={formatNumber(value)} />}
        {stale && <>{value === undefined ? '' : ' '}<span className="stale">Stale</span></>}
      </span>
    </span>
  );
}

export function Chips({ store, className }: { store: Store; className: string }): ReactNode {
  return (
    <div className={className}>
      <ChipValue label="Coins" value={store.me?.coins} stale={store.outage} />
      <ChipValue label="Cash" value={store.me?.cash} stale={store.outage} />
    </div>
  );
}

export function TopBar({ store, brandLink = true }: { store: Store; brandLink?: boolean }): ReactNode {
  return (
    <header className="topbar">
      {brandLink ? <Link href="/home" className="brand">Headstring</Link> : <span className="brand">Headstring</span>}
      {store.auth === 'player' && <Chips store={store} className="chips" />}
    </header>
  );
}

export function Screen({ store, title, intro, children }: { store: Store; title: string; intro?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <>
      <TopBar store={store} />
      <main className="page">
        <div className="page-head">
          <h1 tabIndex={-1}>{title}</h1>
          {intro}
        </div>
        {children}
      </main>
    </>
  );
}

export function HeadingScreen({ store, heading, children }: { store: Store; heading: string; children?: ReactNode }): ReactNode {
  return (
    <>
      <TopBar store={store} />
      <main className="heading-screen">
        <h1 tabIndex={-1}>{heading}</h1>
        {children}
        <Link href="/home" className="button">Home</Link>
      </main>
    </>
  );
}

export function RackGlyph(): ReactNode {
  const balls = [[32, 12], [24, 26], [40, 26], [16, 40], [32, 40], [48, 40]];
  return (
    <svg width="64" height="56" viewBox="0 0 64 56" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M32 2 60 52H4Z" strokeLinejoin="round" />
      {balls.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy + 2} r="6.4" />)}
    </svg>
  );
}

const GLYPHS: Record<string, string> = {
  'Play 1-on-1': 'M9 22a6 6 0 1 1 0-12 6 6 0 0 1 0 12Zm14 0a6 6 0 1 1 0-12 6 6 0 0 1 0 12Z',
  'Play Special': 'M16 4l3.6 7.6 8.4 1.1-6.1 5.8 1.6 8.3L16 22.8l-7.5 4 1.6-8.3L4 12.7l8.4-1.1Z',
  'Play with Friends': 'M11 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM3 27c0-5 3.6-8 8-8s8 3 8 8M21 6a5 5 0 0 1 0 9M24 19c3 .8 5 3.4 5 8',
  'Practice Offline': 'M6 26 26 6M21 6h5v5M16 26a10 10 0 1 1 0-20',
  Shop: 'M5 11h22l-2 16H7ZM11 11V8a5 5 0 0 1 10 0v3',
  Settings: 'M4 9h14M24 9h4M4 23h4M14 23h14M21 5v8M11 19v8',
  Tournaments: 'M4 5h7v8h7v6h-7v8H4M11 9h3M11 23h3M18 16h10',
  Clubs: 'M4 27V10l12-6 12 6v17M11 27v-9h10v9',
  Leaderboards: 'M5 27V15h7v12M12 27V7h8v20M20 27V12h7v15',
};

export function ModeGlyph({ name }: { name: string }): ReactNode {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPHS[name]} />
    </svg>
  );
}
