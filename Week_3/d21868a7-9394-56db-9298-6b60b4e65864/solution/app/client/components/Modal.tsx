// Dialogs, sheets and the drawer: native <dialog> opened modally, Tab and Shift+Tab wrap inside, Escape
// closes, and focus returns to the control that opened it (adapted from kit/modules/a11y_dialog).
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

const LEAVE_FALLBACK_MS = 400;

/** The exit motion: a closed dialog is gone from the page, focus order and accessibility tree at
 * once, so reopening it is never undone by a timer; what fades out over --sheet-out is an inert,
 * hidden picture of it that removes itself when its animation ends. */
function leave(dialog: HTMLDialogElement): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !dialog.open) return;
  const box = dialog.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = `${dialog.className} modal-leaving`;
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, { inset: "auto", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  for (const child of dialog.childNodes) ghost.append(child.cloneNode(true));
  for (const named of ghost.querySelectorAll("[id]")) named.removeAttribute("id");
  document.body.append(ghost);
  const done = () => ghost.remove();
  ghost.addEventListener("animationend", done);
  setTimeout(done, LEAVE_FALLBACK_MS);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden], [inert]"));
}

interface ModalProps {
  label?: string;
  labelledBy?: string;
  role?: "dialog" | "alertdialog";
  variant?: "dialog" | "alert" | "sheet" | "drawer" | "full";
  returnFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  /** Fills the whole screen below 600 pixels (the Capacity table conflict dialog). */
  fullOnPhone?: boolean;
  children: ReactNode;
}

export function Modal({ label, labelledBy, role = "dialog", variant = "dialog", returnFocus, onClose, initialFocus, fullOnPhone = false, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const dialog = ref.current!;
    return () => leave(dialog);
  }, []);

  useEffect(() => {
    const dialog = ref.current!;
    const opener = returnFocus;
    // Reopened while its leaving picture is still fading: it comes straight back instead of fading
    // out and in again.
    const leaving = document.querySelector(".modal-leaving");
    if (leaving) {
      leaving.remove();
      dialog.dataset.resumed = "";
    }
    dialog.showModal();
    (initialFocus?.current ?? focusables(dialog)[0] ?? dialog).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const items = focusables(dialog);
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return event.preventDefault();
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !dialog.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onCancel = (event: Event) => {
      event.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener("keydown", onKey);
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("keydown", onKey);
      dialog.removeEventListener("cancel", onCancel);
      dialog.close();
      opener.current?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal modal-${variant}${fullOnPhone ? " modal-phone-full" : ""}`}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-modal="true"
    >
      {children}
    </dialog>
  );
}
