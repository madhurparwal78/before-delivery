import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { onStorageChange, storageUnavailable } from './api';

// ------------------------------------------------------------------ routing

type PathListener = (path: string) => void;
const pathListeners = new Set<PathListener>();

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  for (const listener of pathListeners) listener(window.location.pathname + window.location.search);
}

export function useLocation(): string {
  const [path, setPath] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const listener: PathListener = (next) => setPath(next);
    pathListeners.add(listener);
    const onPop = (): void => listener(window.location.pathname + window.location.search);
    window.addEventListener('popstate', onPop);
    return () => {
      pathListeners.delete(listener);
      window.removeEventListener('popstate', onPop);
    };
  }, []);
  return path;
}

export function AppLink(props: {
  to: string;
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}): JSX.Element {
  return (
    <a
      href={props.to}
      className={props.className}
      aria-label={props['aria-label']}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}

// ------------------------------------------------------------------ announcements

type AnnounceListener = (text: string) => void;
const announceListeners = new Set<AnnounceListener>();

export function announce(text: string): void {
  for (const listener of announceListeners) listener(text);
}

export function Announcements(): JSX.Element {
  const [text, setText] = useState('');
  useEffect(() => {
    const listener: AnnounceListener = (next) => {
      setText('');
      window.setTimeout(() => setText(next), 30);
    };
    announceListeners.add(listener);
    return () => {
      announceListeners.delete(listener);
    };
  }, []);
  return (
    <div role="status" aria-label="Announcements" aria-live="polite" className="sr-only">
      {text}
    </div>
  );
}

// ------------------------------------------------------------------ reduced motion

export function useStorageOutage(): boolean {
  const [down, setDown] = useState(() => storageUnavailable());
  useEffect(() => onStorageChange(setDown), []);
  return down;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = (): void => setReduced(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  return reduced;
}

export function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const listener = (): void => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', listener);
    return () => window.removeEventListener('resize', listener);
  }, []);
  return size;
}

export function isPhone(width: number): boolean {
  return width <= 640;
}

// ------------------------------------------------------------------ focus trap

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(onClose: () => void): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (node !== null) {
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus();
    }
    return () => {
      opener.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const node = ref.current;
      if (node === null) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (item) => item.offsetParent !== null || item === document.activeElement,
      );
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return ref;
}

export function Dialog(props: {
  title: string;
  role?: 'dialog' | 'alertdialog';
  onClose: () => void;
  children: React.ReactNode;
  sheet?: boolean;
  label?: string;
}): JSX.Element {
  const ref = useFocusTrap(props.onClose);
  const titleId = `dialog-title-${props.title.replace(/\W+/g, '-')}`;
  const body = (
    <div
      ref={ref}
      role={props.role ?? 'dialog'}
      aria-modal="true"
      aria-label={props.label ?? props.title}
      className={props.sheet === true ? 'sheet' : 'dialog'}
      tabIndex={-1}
    >
      <h2 id={titleId}>{props.title}</h2>
      {props.children}
    </div>
  );
  if (props.sheet === true) return body;
  return <div className="scrim">{body}</div>;
}

// ------------------------------------------------------------------ menus

export function useOutsideClose(onClose: () => void): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return ref;
}

// ------------------------------------------------------------------ async data

export function Wordmark(props: { compact?: boolean }): JSX.Element {
  return (
    <span className="wordmark" aria-hidden="true">
      <strong>CORBEL</strong>
      <span className={props.compact === true ? 'wordmark-tail' : undefined}>
        {props.compact === true ? 'Works' : ' Works'}
      </span>
    </span>
  );
}

export function LoadingStrokes(): JSX.Element {
  return (
    <div className="loading-strokes" aria-hidden="true">
      <svg viewBox="0 0 72 24">
        <path d="M2 18 H26" />
        <path d="M26 18 L40 6" />
        <path d="M40 6 H70" />
      </svg>
    </div>
  );
}

export function EmptyState(props: { line: string }): JSX.Element {
  return (
    <div className="empty-state">
      <svg width="96" height="56" viewBox="0 0 96 56" aria-hidden="true" className="wire">
        <path d="M6 50 H90" />
        <path d="M14 50 V18 H54 V50" />
        <path d="M54 30 H82 V50" />
        <path d="M14 18 L34 6 L54 18" />
      </svg>
      <p>{props.line}</p>
    </div>
  );
}
