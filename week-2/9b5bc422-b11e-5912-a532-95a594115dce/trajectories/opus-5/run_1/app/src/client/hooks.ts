import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { snapshot, subscribe, type State } from './store/store.ts';

export function useStore(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export type Viewport = 'phone' | 'tablet' | 'desktop';

function readViewport(): Viewport {
  if (window.matchMedia('(min-width: 1024px)').matches) return 'desktop';
  if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
  return 'phone';
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(readViewport);
  useEffect(() => {
    const update = () => setViewport(readViewport());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return viewport;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** Keeps Tab inside a dialog in both directions and gives focus back to the opener. */
export function useFocusTrap(active: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!active) return;
    opener.current = document.activeElement as HTMLElement | null;
    const container = ref.current;
    if (container) {
      const first = container.querySelector<HTMLElement>('[data-autofocus]') ?? focusable(container)[0];
      first?.focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!ref.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable(ref.current);
      if (!items.length) return;
      const current = document.activeElement as HTMLElement | null;
      const index = current ? items.indexOf(current) : -1;
      if (event.shiftKey) {
        if (index <= 0) {
          event.preventDefault();
          items[items.length - 1].focus();
        }
        return;
      }
      if (index === items.length - 1 || index === -1) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      opener.current?.focus();
    };
  }, [active]);

  return ref;
}

function focusable(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.offsetParent !== null || element.tagName === 'INPUT');
}
