import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

// Modal confirmations on the native <dialog>: focus on the first field or the safe button, Tab and Shift+Tab kept
// inside, Escape or the safe button closes, focus returns to the opener (brief: Interactions, Dialogs). Adapted from
// kit/modules/a11y_dialog.

const FOCUSABLE = "button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href]";

export function reducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface DialogProps {
  title: string;
  open: boolean;
  /** Escape or the safe button asks to close. */
  onClose: () => void;
  /** Runs once the dialog has faded out and focus is back on the opener. */
  onClosed: () => void;
  children: ComponentChildren;
}

/** Open state for one dialog; `hide()` resolves once it has fully closed, so success copy lands after it. */
export function useDialog() {
  const [open, setOpen] = useState(false);
  const closed = useRef<(() => void) | null>(null);
  return {
    open,
    show: () => setOpen(true),
    hide: () => new Promise<void>((resolve) => {
      closed.current = resolve;
      setOpen(false);
    }),
    props: {
      open,
      onClose: () => setOpen(false),
      onClosed: () => {
        closed.current?.();
        closed.current = null;
      },
    },
  };
}

/** A dialog's safe button ("Keep draft", "Cancel"…) carries `data-safe` and gets focus when there is no field. */
export function Dialog({ title, open, onClose, onClosed, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      const field = dialog.querySelector<HTMLElement>("input, textarea, select");
      (field ?? dialog.querySelector<HTMLElement>("[data-safe]") ?? dialog.querySelector<HTMLElement>(FOCUSABLE))?.focus();
      if (!reducedMotion()) {
        dialog.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }],
          { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" });
      }
    } else if (!open && dialog.open) {
      const finish = () => {
        dialog.close();
        if (opener.current?.isConnected) opener.current.focus();
        onClosed();
      };
      if (reducedMotion()) finish();
      else {
        const fade = dialog.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(4px)" }],
          { duration: 160, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
        const settle = () => {
          finish();
          fade.cancel();
        };
        fade.finished.then(settle, settle);
      }
    }
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const titleId = `dialog-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <dialog ref={ref} class="dialog" aria-labelledby={titleId} onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}>
      <h2 id={titleId} class="dialog__title">{title}</h2>
      {children}
    </dialog>
  );
}
