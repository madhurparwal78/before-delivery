// Modal dialogs on native <dialog>, adapted from kit/modules/a11y_dialog: focus moves in on open,
// Tab and Shift+Tab wrap inside, Escape closes, and closing puts focus back on whatever opened it.
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

const FOCUSABLE = "button, input:not([type=hidden]), select, textarea, a[href], [tabindex]";

function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex >= 0 && el.getClientRects().length > 0,
  );
}

interface Props {
  label: string;
  onClose: () => void;
  /** Where focus goes when the dialog closes; defaults to the element focused when it opened. */
  returnFocus?: () => HTMLElement | null | undefined;
  /** Selector of the element to focus first; defaults to the first focusable. */
  initialFocus?: string;
  className?: string;
  children: ComponentChildren;
}

export function Dialog({ label, onClose, returnFocus, initialFocus, className, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const restore = useRef(returnFocus);
  restore.current = returnFocus;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const first = (initialFocus && dialog.querySelector<HTMLElement>(initialFocus)) || focusables(dialog)[0];
    (first ?? dialog).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      } else if (event.key === "Tab") {
        const items = focusables(dialog);
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (!firstItem || !lastItem) return event.preventDefault();
        const active = document.activeElement;
        if (event.shiftKey && (active === firstItem || !dialog.contains(active))) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && (active === lastItem || !dialog.contains(active))) {
          event.preventDefault();
          firstItem.focus();
        }
      }
    };
    const onCancel = (event: Event) => {
      event.preventDefault();
      close.current();
    };
    dialog.addEventListener("keydown", onKey);
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("keydown", onKey);
      dialog.removeEventListener("cancel", onCancel);
      dialog.close();
      const target = restore.current?.() ?? opener;
      if (target?.isConnected) target.focus();
    };
  }, []);

  return (
    <dialog ref={ref} aria-label={label} class={`dialog ${className ?? ""}`}>
      {children}
    </dialog>
  );
}
