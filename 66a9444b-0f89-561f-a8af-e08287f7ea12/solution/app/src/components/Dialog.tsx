// Keyboard-complete dialogs (adapted from kit/modules/a11y_dialog): focus moves in on open, Tab and Shift+Tab
// stay inside, Escape closes, and focus returns to the control that opened it. Panels rise and settle on open
// and leave in under a fifth of a second; with reduced motion they appear and go without moving.
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

type Props = {
  label: string; onClose: () => void; children: ReactNode; className?: string;
  initialFocus?: RefObject<HTMLElement | null>; returnFocus?: HTMLElement | null;
};

export function Dialog({ label, onClose, children, className = "", initialFocus, returnFocus }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(returnFocus ?? (document.activeElement as HTMLElement | null));
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const target = initialFocus?.current ?? panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current;
    target?.focus();
  }, [initialFocus]);

  useEffect(() => {
    const node = panel.current!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) node.animate([{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      } else if (e.key === "Tab") {
        const items = focusables(node);
        if (!items.length) return e.preventDefault();
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !node.contains(active) || active === node)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (active === last || !node.contains(active))) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key, true);
    const returnTo = opener.current;
    return () => {
      document.removeEventListener("keydown", key, true);
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, []);

  return (
    <div className="dialog-backdrop">
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`dialog ${className}`}>
        {children}
      </div>
    </div>
  );
}

/** Plays the quick closing move before the dialog unmounts (instant with reduced motion). */
export function closeWithMotion(node: HTMLElement | null, done: () => void): void {
  if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return done();
  const panel = node.closest<HTMLElement>('[role="dialog"]') ?? node;
  const motion = panel.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(12px)" }], { duration: 150, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" });
  motion.onfinish = done;
}
