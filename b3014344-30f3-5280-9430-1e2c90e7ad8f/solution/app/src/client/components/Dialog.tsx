import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion } from "../lib/motion";

// A modal dialog or drawer: Tab and Shift+Tab cycle inside it, Escape closes it, and focus returns
// to the control that opened it. It fades and rises in about a fifth of a second, or appears at once
// under reduced motion.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function Dialog(props: { open: boolean; label: string; onClose: () => void; children: ReactNode; variant?: "dialog" | "drawer"; className?: string }) {
  const { open, label, onClose, children, variant = "dialog", className = "" } = props;
  const [mounted, setMounted] = useState(open);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    if (open) {
      opener.current = document.activeElement as HTMLElement | null;
      setMounted(true);
    }
  }, [open]);

  useEffect(() => {
    const element = panel.current;
    if (!mounted || !element) return;
    if (open) {
      const first = element.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(element)[0] ?? element;
      first.focus();
      if (!prefersReducedMotion()) {
        element.animate(
          variant === "drawer"
            ? [{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }]
            : [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }],
          { duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        );
      }
      return;
    }
    opener.current?.focus();
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    const exit = element.animate(
      variant === "drawer"
        ? [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(24px)" }]
        : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(12px)" }],
      { duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
    );
    exit.onfinish = () => setMounted(false);
    // Reopened before the exit ends: drop the exit so it neither unmounts nor hides the open dialog.
    return () => {
      exit.onfinish = null;
      exit.cancel();
    };
  }, [open, mounted, variant]);

  useEffect(() => {
    if (!mounted || !open) return;
    const onKey = (event: KeyboardEvent) => {
      const element = panel.current;
      if (!element) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(element);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !element.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !element.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      const element = panel.current;
      if (element && event.target instanceof Node && !element.contains(event.target)) (focusables(element)[0] ?? element).focus();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
    };
  }, [mounted, open]);

  if (!mounted) return null;
  return createPortal(
    <div className={`dialog-layer dialog-layer--${variant}${open ? "" : " is-closing"}`} onMouseDown={(event) => event.target === event.currentTarget && open && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`dialog dialog--${variant} ${className}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
