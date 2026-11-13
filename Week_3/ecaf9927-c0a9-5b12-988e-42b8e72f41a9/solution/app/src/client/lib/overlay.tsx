import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

const FOCUSABLE = 'button, input, select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])';

/** Enabled, visible controls inside the overlay, in document order. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('disabled') && !el.closest('[hidden], [inert]') && !(el instanceof HTMLInputElement && el.type === 'hidden'),
  );
}

const ENTER_MS = { dialog: 160, sheet: 250 } as const;

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CloseContext = createContext<() => void>(() => undefined);

/** The function that closes the surrounding overlay and returns focus to its opener (for Cancel and Close buttons). */
export const useOverlayClose = (): (() => void) => useContext(CloseContext);

interface Props {
  label: string;
  variant: 'dialog' | 'sheet';
  onClose: () => void;
  children: ReactNode;
}

/**
 * A modal dialog or bottom sheet: focus moves in on open, Tab and Shift+Tab wrap inside it, Escape or a tap
 * on the dimmed area closes it, and focus returns to the control that opened it.
 */
export function Overlay({ label, variant, onClose, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [closing, setClosing] = useState(false);
  const [entering, setEntering] = useState(() => !prefersReducedMotion());
  const closed = useRef(false);

  // The dialog is exposed once it has settled in place; its content is already visible while it slides in.
  useEffect(() => {
    if (!entering) return;
    const settle = () => setEntering(false);
    const timer = setTimeout(settle, ENTER_MS[variant] + 40);
    panel.current?.addEventListener('animationend', settle, { once: true });
    return () => clearTimeout(timer);
  }, [entering, variant]);

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    opener.current?.focus();
    if (variant === 'sheet' && !prefersReducedMotion()) {
      setClosing(true);
      setTimeout(onClose, 200);
    } else {
      onClose();
    }
  }, [onClose, variant]);

  useEffect(() => {
    const returnTo = opener.current;
    return () => {
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, []);

  useEffect(() => {
    const root = panel.current;
    if (!root) return;
    const first = root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(root)[0] ?? root;
    first.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = focusables(panel.current);
    const [head, tail] = [items[0], items[items.length - 1]];
    if (!head || !tail) {
      event.preventDefault();
    } else if (event.shiftKey && (document.activeElement === head || document.activeElement === panel.current)) {
      event.preventDefault();
      tail.focus();
    } else if (!event.shiftKey && document.activeElement === tail) {
      event.preventDefault();
      head.focus();
    } else if (!panel.current.contains(document.activeElement)) {
      event.preventDefault();
      head.focus();
    }
  };

  return (
    <CloseContext.Provider value={close}>
      <div className={`overlay ${variant}${closing ? ' closing' : ''}`} onKeyDown={onKeyDown}>
        <div className="backdrop" onClick={close} />
        <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`overlay-panel${entering ? ' entering' : ''}`}>
          <div className="overlay-surface">{children}</div>
        </div>
      </div>
    </CloseContext.Provider>
  );
}
