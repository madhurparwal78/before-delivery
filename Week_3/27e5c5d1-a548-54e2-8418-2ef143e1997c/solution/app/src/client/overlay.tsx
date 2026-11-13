import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Open overlays, innermost last: only the innermost one answers Escape. */
const stack: { close: () => void }[] = [];

document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Escape' && stack.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      stack.at(-1)?.close();
    }
  },
  true,
);

function useOverlay(close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    const entry = { close: () => latest.current() };
    stack.push(entry);
    return () => {
      stack.splice(stack.indexOf(entry), 1);
    };
  }, []);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

interface ModalProps {
  label: string;
  role?: 'dialog' | 'alertdialog';
  className?: string;
  onClose: () => void;
  /** Where focus goes if the control that opened the dialog is gone. */
  fallbackFocus?: string;
  children: ReactNode;
}

/** A modal dialog: focus goes in, Tab stays in, Escape closes, and focus goes back to the opener. */
export function Modal({ label, role = 'dialog', className = '', onClose, fallbackFocus, children }: ModalProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  useOverlay(onClose);
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = root.current;
    if (!node) return;
    const first = node.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(node)[0] ?? node;
    // The ring shows on the first control however the dialog was opened, so the reader sees where focus is.
    first.dataset['ring'] = '';
    first.addEventListener('blur', () => delete first.dataset['ring'], { once: true });
    first.focus();
    return () => {
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
      else if (fallbackFocus) document.querySelector<HTMLElement>(fallbackFocus)?.focus();
    };
  }, [fallbackFocus]);

  const trap = (event: ReactKeyboardEvent): void => {
    const node = root.current;
    if (event.key !== 'Tab' || !node) return;
    const items = focusables(node);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const outside = !node.contains(document.activeElement);
    if (event.shiftKey && (document.activeElement === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="scrim">
      <div ref={root} role={role} aria-modal="true" aria-label={label} tabIndex={-1} className={`modal ${className}`} onKeyDown={trap}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

interface MenuProps {
  label: string;
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
}

const GAP = 4;
const MARGIN = 8;

/** A menu in a layer of its own: placed inside the viewport, arrow keys move between items, Escape closes. */
export function Menu({ label, anchor, onClose, children }: MenuProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useOverlay(() => {
    onClose();
    anchor.focus();
  });

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const a = anchor.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = node;
    const left = Math.max(MARGIN, Math.min(a.right - width, window.innerWidth - width - MARGIN));
    const below = a.bottom + GAP;
    const top = below + height + MARGIN <= window.innerHeight ? below : Math.max(MARGIN, a.top - GAP - height);
    setPlace({ left, top });
  }, [anchor]);

  useLayoutEffect(() => {
    if (place) root.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [place]);

  useEffect(() => {
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [anchor, onClose]);

  const move = (event: ReactKeyboardEvent): void => {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (index: number): void => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(items.length - 1);
    else if (event.key === 'Tab') onClose();
  };

  return createPortal(
    <div
      ref={root}
      role="menu"
      aria-label={label}
      className="menu"
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
      onKeyDown={move}
    >
      {children}
    </div>,
    document.body,
  );
}
