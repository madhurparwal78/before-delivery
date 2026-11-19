import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "../announce.js";

// A modal built on <dialog>: focus moves to the first field, Tab cycles inside, Escape or the cancel
// button closes, and focus returns to the control that opened it (modules/a11y_dialog).

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  title: string;
  open: boolean;
  onClose: () => void;
  alert?: boolean;
  children: ReactNode;
};

export function Dialog({ title, open, onClose, alert = false, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const headingId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      if (!prefersReducedMotion()) {
        dialog.animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      }
    } else if (!open && dialog.open) {
      // Leaving is instant (faster than the entrance), so nothing modal lingers over the page.
      dialog.close();
      if (opener.current?.isConnected) opener.current.focus();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("keydown", trap);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("keydown", trap);
    };
  }, [onClose]);

  return (
    <dialog ref={ref} className="dialog" role={alert ? "alertdialog" : undefined} aria-labelledby={headingId}>
      <h2 id={headingId} className="dialog-title">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
