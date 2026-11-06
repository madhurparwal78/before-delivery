import { useCallback, useEffect, useRef, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

export function useNarrow(): boolean {
  return useMediaQuery('(max-width: 600px)');
}

export function useInterval(run: () => void, everyMs: number): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const id = window.setInterval(() => latest.current(), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
}

/** Counts from the previous amount to the new one in about a third of a second. */
export function useCountingCents(target: number, instant: boolean): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (instant) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    if (origin === target) return;
    let frame = 0;
    const DURATION = 330;
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / DURATION);
      const eased =
        progress < 0.5 ? 2 * progress * progress : 1 - 2 * (1 - progress) * (1 - progress);
      const value = Math.round(origin + (target - origin) * eased);
      setShown(progress >= 1 ? target : value);
      if (progress < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, instant]);
  useEffect(() => {
    if (instant) from.current = target;
  }, [target, instant]);
  return shown;
}

/** Seconds left on a hold, worked out from the server's clock rather than the device's. */
export function useServerCountdown(
  expiresAt: string | null,
  serverNow: string | null,
): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (expiresAt === null || serverNow === null) {
      setLeft(null);
      return;
    }
    const skew = Date.now() - new Date(serverNow).getTime();
    const expiry = new Date(expiresAt).getTime();
    const tick = (): void => {
      setLeft(Math.max(0, Math.round((expiry - (Date.now() - skew)) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt, serverNow]);
  return left;
}

/** Traps focus inside a dialog, closes on Escape and returns focus to its opener. */
export function useDialog(onClose: () => void): (node: HTMLElement | null) => void {
  const opener = useRef<Element | null>(null);
  const container = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    opener.current = document.activeElement;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !container.current) return;
      const focusable = [
        ...container.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => node.offsetParent !== null || node === document.activeElement);
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
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const node = opener.current;
      if (node instanceof HTMLElement && document.contains(node)) node.focus();
    };
  }, []);

  return useCallback((node: HTMLElement | null) => {
    container.current = node;
  }, []);
}
