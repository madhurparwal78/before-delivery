// Modal dialogs and the drawer (adapted from kit/modules/a11y_dialog): focus moves in on open,
// Tab and Shift+Tab wrap inside, Escape closes, and focus returns to the opener on close.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const EXIT_MS = 250;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const stack: HTMLElement[] = [];

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

interface ModalProps {
  open: boolean;
  title: string;
  onDismiss: () => void;
  children: ReactNode;
  variant?: "dialog" | "drawer";
  /** Where focus goes on close; the opener when absent or when it returns null. */
  returnFocus?: () => HTMLElement | null;
  hideTitle?: boolean;
}

export function Modal({ open, title, onDismiss, children, variant = "dialog", returnFocus, hideTitle = false }: ModalProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const showing = useRef(false);
  const titleId = useId();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const restore = useRef(returnFocus);
  restore.current = returnFocus;

  useLayoutEffect(() => {
    if (open) {
      if (!showing.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      showing.current = true;
      if (!mounted || closing) {
        setMounted(true);
        setClosing(false);
      }
      return;
    }
    if (!mounted || closing) return;
    showing.current = false;
    setClosing(true);
    const target = restore.current?.() ?? opener.current;
    target?.focus();
    const timer = setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!mounted || closing || !element) return;
    stack.push(element);
    const field = element.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled])");
    const first = field ?? focusables(element).find((el) => el.tagName === "BUTTON") ?? focusables(element)[0] ?? element;
    first.focus();
    return () => {
      stack.splice(stack.indexOf(element), 1);
    };
  }, [mounted, closing]);

  useEffect(() => {
    const element = panel.current;
    if (!mounted || closing || !element) return;
    const onKey = (event: KeyboardEvent): void => {
      if (stack.at(-1) !== element) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(element);
      const active = document.activeElement;
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const inside = active instanceof Node && element.contains(active) && active !== element;
      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [mounted, closing]);

  if (!mounted) return null;
  return createPortal(
    <div className={`modal-layer modal-layer--${variant}`} data-state={closing ? "closing" : "open"}>
      <div className="modal-backdrop" aria-hidden="true" />
      <div
        ref={panel}
        className={`modal modal--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} className={hideTitle ? "visually-hidden" : "modal__title"}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
