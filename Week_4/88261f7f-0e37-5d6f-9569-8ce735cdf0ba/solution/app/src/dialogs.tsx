import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { PANEL_MS, useReducedMotion } from "./hooks";

interface OpenLayer { id: number; close: () => void; root: RefObject<HTMLElement | null> }

const stack: OpenLayer[] = [];
let nextId = 1;

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute("disabled") && element.getClientRects().length > 0 && !element.closest("[inert]"),
  );
}

function handleKey(event: KeyboardEvent): void {
  const top = stack[stack.length - 1];
  const root = top?.root.current;
  if (!top || !root) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    top.close();
    return;
  }
  if (event.key !== "Tab") return;
  const inside = focusables(root);
  const first = inside[0];
  const last = inside[inside.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (!root.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

let listening = false;
function ensureListener(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("keydown", handleKey, true);
}

interface LayerProps {
  /** Accessible name, exact as published. */
  name: string;
  open: boolean;
  onClose: () => void;
  role?: "dialog" | "alertdialog" | "complementary";
  className?: string;
  children: ReactNode;
  /** Where focus lands on open; defaults to the first control. */
  initialFocus?: string;
}

/**
 * A dialog or docked panel. Opening records the focused control and moves focus in; Tab wraps inside the
 * topmost layer; Escape closes only the topmost; closing returns focus and, on the page clock, hides
 * the layer after its motion. Reopening during that motion cancels the hide.
 */
export function Layer({ name, open, onClose, role = "dialog", className = "", children, initialFocus }: LayerProps) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<"open" | "closing" | "closed">(open ? "open" : "closed");
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    if (open) {
      setPhase("open");
      return;
    }
    if (phase === "open") {
      setPhase(reduced ? "closed" : "closing");
    }
  }, [open, reduced, phase]);

  useEffect(() => {
    if (phase !== "closing") return;
    const timer = window.setTimeout(() => setPhase("closed"), PANEL_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (!open) return;
    ensureListener();
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer: OpenLayer = { id: nextId++, close: () => close.current(), root };
    stack.push(layer);
    const target = initialFocus ? root.current?.querySelector<HTMLElement>(initialFocus) : null;
    (target ?? (root.current ? focusables(root.current)[0] : null) ?? root.current)?.focus();
    return () => {
      stack.splice(stack.indexOf(layer), 1);
      const back = opener.current;
      if (back?.isConnected) back.focus();
    };
  }, [open, initialFocus]);

  if (phase === "closed") return null;
  const modal = className.includes("dialog");
  return createPortal(
    <>
      {modal ? <div className="scrim" data-state={phase} aria-hidden="true" /> : null}
      <div
        ref={root}
        role={role}
        aria-label={name}
        aria-modal={role === "alertdialog" ? true : undefined}
        tabIndex={-1}
        data-state={phase}
        inert={phase === "closing" ? true : undefined}
        className={`layer ${className}`}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
