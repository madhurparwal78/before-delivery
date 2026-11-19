import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Follows the system reduced-motion setting while the page is open. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listen = (): void => setReduced(query.matches);
    query.addEventListener('change', listen);
    return () => query.removeEventListener('change', listen);
  }, []);

  return reduced;
}

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

/**
 * The three published viewports. 768 counts as tablet and 1280 as desktop, and
 * nothing between those edges changes which layout a viewport gets.
 */
export function useBreakpoint(): Breakpoint {
  const read = (): Breakpoint => {
    if (typeof window === 'undefined') return 'desktop';
    const width = window.innerWidth;
    if (width < 768) return 'phone';
    if (width < 1280) return 'tablet';
    return 'desktop';
  };
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(read);

  useEffect(() => {
    const listen = (): void => setBreakpoint(read());
    window.addEventListener('resize', listen);
    listen();
    return () => window.removeEventListener('resize', listen);
  }, []);

  return breakpoint;
}

/** Reports whether an element is on screen at all, for pausing canvases. */
export function useOnScreen<T extends Element>(
  ref: React.RefObject<T | null>,
  rootMargin = '0px',
): boolean {
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setOnScreen(entry.isIntersecting);
      },
      { rootMargin, threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return onScreen;
}

/** Scroll entrances play once, the first time an element enters the viewport. */
export function useEnterOnce<T extends Element>(ref: React.RefObject<T | null>): boolean {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setEntered(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setEntered(true);
          observer.disconnect();
        }
      },
      { rootMargin: '-5% 0px', threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return entered;
}

export function useInterval(callback: () => void, delayMs: number | null): void {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    if (delayMs === null) return;
    const id = window.setInterval(() => latest.current(), delayMs);
    return () => window.clearInterval(id);
  }, [delayMs]);
}

export interface PollResult<T> {
  readonly data: T | null;
  readonly error: Error | null;
  readonly loading: boolean;
  refresh(): void;
}

/** Loads a value now and whenever `refresh` is called or the interval elapses. */
export function useLoader<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  intervalMs: number | null = null,
): PollResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadRef
      .current()
      .then((value) => {
        if (!alive) return;
        setData(value);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  useInterval(refresh, intervalMs);

  return useMemo(() => ({ data, error, loading, refresh }), [data, error, loading, refresh]);
}

/**
 * Keeps Tab and Shift+Tab inside a dialog, closes on Escape and returns focus
 * to the control that opened it.
 */
export function useDialogFocus(
  open: boolean,
  onClose: () => void,
  returnFocusTo: React.RefObject<HTMLElement | null>,
): React.RefObject<HTMLDivElement> {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = (): HTMLElement[] =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) return;
    returnFocusTo.current?.focus();
  }, [open, returnFocusTo]);

  return dialogRef;
}
