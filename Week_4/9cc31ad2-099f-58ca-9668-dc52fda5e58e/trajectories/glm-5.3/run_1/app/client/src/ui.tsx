// Shared UI: dialog with focus trap, nav, focus helpers.
import { useEffect, useRef, type ReactNode, type JSX } from 'react';

export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Moves focus to an element once it exists. */
export function useFocusOnMount<T extends HTMLElement>(active = true): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (active && ref.current) ref.current.focus();
  }, [active]);
  return ref;
}

export function focusElement(el: HTMLElement | null): void {
  el?.focus();
}

/** Tab and Shift+Tab stay inside the dialog. Escape closes it unless escapeless. */
export function Dialog({ title, onClose, children, initialFocus = 'first', escapeless = false,
                          labelledBy, width }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: 'first' | 'last' | 'none';
  escapeless?: boolean;
  labelledBy?: string;
  width?: number;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const focusables = (): HTMLElement[] =>
      Array.from(node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.hasAttribute('disabled'));
    if (initialFocus === 'first') {
      const first = focusables()[0];
      if (first) first.focus();
    } else if (initialFocus === 'last') {
      const all = focusables();
      if (all.length > 0) all[all.length - 1].focus();
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !escapeless) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const all = focusables();
        if (all.length === 0) return;
        const first = all[0];
        const last = all[all.length - 1];
        const current = document.activeElement;
        if (e.shiftKey && (current === first || !node.contains(current))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (current === last || !node.contains(current))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [onClose, escapeless, initialFocus]);

  return (
    <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={labelledBy}
        className="dialog"
        style={width ? { maxWidth: width } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/** A tiny same-origin router over history.pushState. */
export function navigate(path: string, focusSel?: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new CustomEvent('kerb-navigate', { detail: { path, focusSel } }));
}

export function useNavigation(handler: (path: string, focusSel?: string) => void): void {
  useEffect(() => {
    const onNav = (e: Event): void => {
      const detail = (e as CustomEvent<{ path: string; focusSel?: string }>).detail;
      handler(detail.path, detail.focusSel);
    };
    const onPop = (): void => handler(window.location.pathname + window.location.search);
    window.addEventListener('kerb-navigate', onNav);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('kerb-navigate', onNav);
      window.removeEventListener('popstate', onPop);
    };
  }, [handler]);
}
