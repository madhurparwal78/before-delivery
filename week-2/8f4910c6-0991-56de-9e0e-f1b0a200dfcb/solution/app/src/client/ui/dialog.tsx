// Modal dialogs and bottom sheets (adapted from kit/modules/a11y_dialog).
//
// <Dialog title="Record advance" onClose={…} actions={<Button…/>} sheet?>…</Dialog>
// - role=dialog (or alertdialog via <AlertDialog>), named by its h2, aria-modal; the page behind is inert.
// - Focus goes to `initialFocus` or the first control; Tab is trapped; Escape calls onClose.
// - On close, focus returns to `returnFocus` (or the element focused at open) unless restoreFocus={false}.
// - Opens with a short fade and slight growth; with `sheet`, at ≤ 767px it rises from the bottom over the
//   middle duration and `actions` sit in a sticky bar. Reduced motion: a short cross-fade only.

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { PHONE, prefersReducedMotion } from "./media.js";

const stack: string[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

function setInert(on: boolean): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.inert = on;
  document.body.style.overflow = on ? "hidden" : "";
}

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  sheet?: boolean;
  wide?: boolean;
  role?: "dialog" | "alertdialog";
  initialFocus?: RefObject<HTMLElement | null>;
  returnFocus?: () => HTMLElement | null;
  restoreFocus?: boolean;
  closeOnScrim?: boolean;
  describedBy?: string;
}

export function Dialog({ title, onClose, children, actions, sheet = false, wide = false, role = "dialog", initialFocus,
  returnFocus, restoreFocus = true, closeOnScrim = role === "dialog", describedBy }: DialogProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const restore = useRef({ returnFocus, restoreFocus });
  restore.current = { returnFocus, restoreFocus };

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(id);
    setInert(true);
    const element = panel.current;
    if (element) {
      const target = initialFocus?.current ?? focusables(element)[0] ?? element;
      target.focus();
      const quiet = prefersReducedMotion();
      if (quiet) {
        element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
      } else if (sheet && matchMedia(PHONE).matches) {
        element.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }],
          { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
      } else {
        element.animate([{ opacity: 0, transform: "scale(0.98)" }, { opacity: 1, transform: "scale(1)" }],
          { duration: 140, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
      }
      scrim.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
    }
    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || !panel.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(panel.current);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (stack[stack.length - 1] !== id || !panel.current) return;
      if (event.target instanceof Node && !panel.current.contains(event.target)) {
        (focusables(panel.current)[0] ?? panel.current).focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      stack.splice(stack.indexOf(id), 1);
      if (!stack.length) setInert(false);
      const { returnFocus: target, restoreFocus: should } = restore.current;
      if (should) {
        const back = target?.() ?? opener;
        if (back?.isConnected) back.focus();
      }
    };
  }, []); // mounts once: the dialog's lifetime is this effect's lifetime

  return createPortal(
    <div ref={scrim} className={`scrim${sheet ? " sheet-scrim" : ""}`}
      onClick={(event) => {
        if (closeOnScrim && event.target === event.currentTarget) close.current();
      }}>
      <div ref={panel} role={role} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={describedBy}
        tabIndex={-1} className={`dialog${sheet ? " sheet" : ""}${wide ? " wide" : ""}`}>
        <div className="dialog-body">
          <h2 id={`${id}-title`}>{title}</h2>
          {children}
        </div>
        {actions ? <div className="dialog-actions">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function AlertDialog(props: Omit<DialogProps, "role">) {
  return <Dialog {...props} role="alertdialog" />;
}
