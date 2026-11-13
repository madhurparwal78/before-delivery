import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openCount = 0;
const open: symbol[] = [];

function setBackgroundInert(inert: boolean): void {
  const root = document.getElementById("root");
  if (root) root.inert = inert;
}

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Props {
  label: string;
  children: ReactNode;
  /** Escape and the dimmed area call this; leave it out for a dialog that closes only through its buttons. */
  onClose?: () => void;
  variant?: "center" | "sheet" | "drawer";
  /** Where focus lands first; the first control when absent. */
  initialFocus?: () => HTMLElement | null;
  /** Where focus goes on close; the control that opened the dialog when absent. */
  returnFocus?: () => HTMLElement | null;
}

/** A modal dialog: focus moves in, Tab and Shift+Tab wrap inside, the page behind is inert, and focus returns on close. */
export function Dialog({ label, children, onClose, variant = "center", initialFocus, returnFocus }: Props): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const me = useRef(Symbol("dialog"));
  const closer = useRef(onClose);
  closer.current = onClose;
  const opener = useRef<HTMLElement | null>(null);
  // A sheet or drawer keeps its dialog hidden until it has finished sliding, so controls are never hit mid-motion.
  const [settled, setSettled] = useState(variant === "center" || prefersReducedMotion());

  useLayoutEffect(() => {
    // Read here, not at render: a dialog this one replaces has already handed focus back by now.
    opener.current = document.activeElement as HTMLElement | null;
    openCount += 1;
    setBackgroundInert(true);
    const first = initialFocus?.() ?? box.current?.querySelector<HTMLElement>(FOCUSABLE) ?? box.current;
    first?.focus();
    return () => {
      openCount -= 1;
      if (openCount === 0) setBackgroundInert(false);
      const target = returnFocus?.() ?? opener.current;
      if (target?.isConnected) target.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape reaches the topmost dialog even when focus has fallen out of it (a button that disabled itself, say).
  useEffect(() => {
    const id = me.current;
    open.push(id);
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape" || open[open.length - 1] !== id || !closer.current || box.current?.contains(event.target as Node)) return;
      event.preventDefault();
      closer.current();
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      open.splice(open.indexOf(id), 1);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  useEffect(() => {
    if (!box.current) return;
    if (!settled) {
      if (box.current.getAnimations().length === 0) setSettled(true);
      return;
    }
    if (!box.current.contains(document.activeElement)) (initialFocus?.() ?? box.current.querySelector<HTMLElement>(FOCUSABLE) ?? box.current).focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && onClose) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === box.current || !box.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !box.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={`overlay ${variant}`} onMouseDown={(event) => event.target === event.currentTarget && onClose?.()} onKeyDown={onKeyDown}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`dialog${settled ? "" : " shell-pending"}`}
        onAnimationEnd={() => setSettled(true)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
