import { useCallback, useRef, useState } from 'preact/hooks';
import { reducedMotion } from './motion.js';

export type OverlayPhase = 'closed' | 'open' | 'leaving';

export interface OverlayState {
  phase: OverlayPhase;
  /** Whether the overlay is in the document at all. */
  mounted: boolean;
  /** Whether it is open: a leaving overlay is already inert and out of the a11y tree. */
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** Called once the leave animation has run; a reopen in the meantime wins. */
  settle: () => void;
  openerRef: (node: HTMLElement | null) => void;
  opener: () => HTMLElement | null;
  returnFocus: () => void;
}

/**
 * SR2: closing returns focus to the opener at once and leaves the page usable while the
 * closing animation still runs. Pressing the opener again during that animation opens the
 * overlay again for good, because the reopen moves the phase out of `leaving` and the
 * leave animation is cancelled with its effect.
 */
export function useOverlay(): OverlayState {
  const [phase, setPhase] = useState<OverlayPhase>('closed');
  const opener = useRef<HTMLElement | null>(null);

  const returnFocus = useCallback(() => {
    opener.current?.focus();
  }, []);

  const open = useCallback(() => {
    setPhase('open');
  }, []);

  const close = useCallback(() => {
    setPhase((current) => {
      if (current !== 'open') return current;
      return reducedMotion() ? 'closed' : 'leaving';
    });
    returnFocus();
  }, [returnFocus]);

  const settle = useCallback(() => {
    setPhase((current) => (current === 'leaving' ? 'closed' : current));
  }, []);

  const openerRef = useCallback((node: HTMLElement | null) => {
    opener.current = node;
  }, []);

  return {
    phase,
    mounted: phase !== 'closed',
    isOpen: phase === 'open',
    open,
    close,
    settle,
    openerRef,
    opener: () => opener.current,
    returnFocus,
  };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (candidate) => candidate.offsetParent !== null || candidate === document.activeElement,
  );
}

/** Opening a dialog moves focus to its first field, or its first button when it has none. */
export function focusFirst(node: HTMLElement): void {
  const problems = node.querySelector<HTMLElement>('[data-problems-summary]');
  if (problems !== null) {
    problems.focus();
    return;
  }
  const fields = [...node.querySelectorAll<HTMLElement>('input, select, textarea')].filter(
    (field) => !field.hasAttribute('disabled'),
  );
  const target = fields[0] ?? node.querySelector<HTMLElement>('button:not([disabled])');
  target?.focus();
}

/** Tab and Shift+Tab wrap inside a dialog or sheet. */
export function trapTab(event: KeyboardEvent, node: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const focusable = focusableIn(node);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0] as HTMLElement;
  const last = focusable[focusable.length - 1] as HTMLElement;
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (active === first || active === null || !node.contains(active))) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
