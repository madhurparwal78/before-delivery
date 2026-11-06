import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { appShell, dialogLayer } from './layers';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const layers: HTMLElement[] = [];

function applyInert(): void {
  const shell = appShell();
  if (shell !== null) shell.inert = layers.length > 0;
  for (const [index, layer] of layers.entries()) {
    layer.inert = index !== layers.length - 1;
  }
}

function pushLayer(element: HTMLElement): void {
  layers.push(element);
  applyInert();
}

function popLayer(element: HTMLElement): void {
  const index = layers.indexOf(element);
  if (index >= 0) layers.splice(index, 1);
  element.inert = false;
  applyInert();
}

export interface DialogProps {
  readonly name: string;
  readonly alert?: boolean;
  readonly closable?: boolean;
  readonly initialFocus?: 'first' | 'last';
  readonly onClose?: () => void;
  /** Where focus goes when the opener no longer exists. */
  readonly fallbackFocus?: () => HTMLElement | null;
  readonly children: ReactNode;
}

/**
 * A modal dialog: focus starts inside, Tab and Shift+Tab wrap, Escape closes, and focus
 * returns to the opener or to the pane heading when the opener has gone.
 */
export function Dialog({
  name,
  alert = false,
  closable = true,
  initialFocus = 'first',
  onClose,
  fallbackFocus,
  children,
}: DialogProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const fallbackRef = useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = ref.current;
    if (element === null) return;
    pushLayer(element);
    const focusable = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const target = initialFocus === 'last' ? focusable[focusable.length - 1] : focusable[0];
    target?.focus();
    return () => {
      popLayer(element);
      const previous = opener.current;
      if (previous !== null && document.contains(previous)) previous.focus();
      else fallbackRef.current?.()?.focus();
    };
  }, [initialFocus]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && closable) {
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const element = ref.current;
    if (element === null) return;
    const focusable = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (candidate) => candidate.offsetParent !== null || candidate === document.activeElement,
    );
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={name}
        ref={ref}
        onKeyDown={onKeyDown}
      >
        <h2 className="dialog-title">{name}</h2>
        {children}
      </div>
    </div>,
    dialogLayer(),
  );
}
