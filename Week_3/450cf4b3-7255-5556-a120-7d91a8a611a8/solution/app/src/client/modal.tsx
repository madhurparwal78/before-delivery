// A native modal <dialog> that keeps Tab inside, closes on Escape or a click on its backdrop and
// returns focus to the control that opened it (the a11y_dialog contract).

import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

const FOCUSABLE = "button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex=\"0\"]";

/** Keeps Tab and Shift+Tab cycling inside the open dialog. */
function trapTab(event: KeyboardEvent, dialog: HTMLDialogElement): void {
  if (event.key !== "Tab") return;
  const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

/** Opens modally; on unmount closes first (so the page is no longer inert), then returns focus. */
export function Modal({ label, opener, onClose, children }: { label: string; opener: HTMLElement | SVGElement; onClose: () => void; children: ComponentChildren }): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog ref={ref} class="dialog" aria-label={label}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onKeyDown={(e) => trapTab(e, e.currentTarget)}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="dialog__body">{children}</div>
    </dialog>
  );
}

