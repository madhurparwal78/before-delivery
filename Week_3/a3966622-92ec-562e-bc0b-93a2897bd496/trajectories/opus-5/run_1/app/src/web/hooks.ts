import { useCallback, useEffect, useRef, useState } from 'react';
import { newKey } from './api.ts';

export function useInterval(body: () => void, milliseconds: number): void {
  const latest = useRef(body);
  latest.current = body;
  useEffect(() => {
    const timer = setInterval(() => latest.current(), milliseconds);
    return () => clearInterval(timer);
  }, [milliseconds]);
}

export type KeyedControl = {
  /** The key for this activation: the same key again after a lost reply with unchanged inputs. */
  keyFor: (inputs: string) => string;
  replyReceived: () => void;
  pending: boolean;
  setPending: (value: boolean) => void;
};

export function useKeyedControl(): KeyedControl {
  const key = useRef<string | null>(null);
  const inputs = useRef<string | null>(null);
  const answered = useRef(true);
  const [pending, setPending] = useState(false);

  const keyFor = useCallback((signature: string) => {
    if (key.current === null || inputs.current !== signature || answered.current) {
      key.current = newKey();
      inputs.current = signature;
      answered.current = false;
    }
    return key.current;
  }, []);

  const replyReceived = useCallback(() => {
    answered.current = true;
  }, []);

  return { keyFor, replyReceived, pending, setPending };
}

/** Keeps focus inside the open panel, closes on Escape and returns focus to its opener. */
export function useFocusTrap(
  container: React.RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = container.current;
    if (node === null) return;
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('disabled'));
    const first = focusable()[0];
    if (first !== undefined) first.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const start = items[0] as HTMLElement;
      const end = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (active !== null && !node.contains(active)) {
        event.preventDefault();
        start.focus();
      } else if (event.shiftKey && active === start) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && active === end) {
        event.preventDefault();
        start.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (opener !== null && document.body.contains(opener)) opener.focus();
    };
  }, [open, container]);
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = (): void => setReduced(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const listener = (): void => setWidth(window.innerWidth);
    window.addEventListener('resize', listener);
    return () => window.removeEventListener('resize', listener);
  }, []);
  return width;
}
