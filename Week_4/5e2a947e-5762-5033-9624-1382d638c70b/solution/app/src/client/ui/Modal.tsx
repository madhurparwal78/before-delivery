import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert], [hidden]') && el.getClientRects().length > 0);
}

interface ModalProps {
  /** The dialog's accessible name. */
  label: string;
  onClose: () => void;
  /** When false the dialog ignores Escape (Sign in again, Join map). */
  dismissible?: boolean;
  className?: string;
  /** The element focus returns to on close; defaults to the element focused when the dialog opened. */
  opener?: HTMLElement | null;
  /** A role other than dialog for the inner surface, e.g. a toolbar drawer. */
  children: ComponentChildren;
  /** Focus this selector first instead of the first control. */
  autofocus?: string;
}

/** A modal dialog: focus moves in, Tab wraps, Escape closes, focus returns to the opener. Mounted only while open. */
export function Modal(props: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(props.opener ?? (document.activeElement as HTMLElement | null));
  const closing = useRef(false);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    dialog.showModal();
    const target = (props.autofocus ? dialog.querySelector<HTMLElement>(props.autofocus) : null) ?? focusables(dialog)[0] ?? dialog;
    target.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (!closing.current) opener.current?.focus();
    };
  }, []);

  const close = (): void => {
    if (closing.current) return;
    closing.current = true;
    props.onClose();
    queueMicrotask(() => opener.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (props.dismissible !== false) close();
      return;
    }
    if (event.key !== 'Tab' || !ref.current) return;
    const items = focusables(ref.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !ref.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !ref.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      class={`modal ${props.className ?? ''}`}
      aria-label={props.label}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        if (props.dismissible !== false) close();
      }}
    >
      {props.children}
    </dialog>
  );
}
