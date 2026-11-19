// Keyboard-complete dialogs, sheets and menus (brief: Dialogs, sheets and menus). Adapted from
// kit/modules/a11y_dialog: focus moves inside on open, Tab and Shift+Tab wrap, Escape closes and
// focus returns to the opener.
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { Icon } from "./icons";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
}

const FIRST_IN_BODY = ".dialog-head ~ * :is(input:not([readonly]):not([disabled]), select:not([disabled]), textarea, button:not([disabled]), a[href])";

/** Open traps, newest last; only the newest handles keys. */
const traps: HTMLElement[] = [];

/**
 * Traps Tab inside `root` and closes on Escape; returns focus to `returnTo` (or the opener) on unmount.
 * A non-modal panel handles these keys only while focus is inside it, so the rest of the page stays usable.
 */
export function useTrap(root: { current: HTMLElement | null }, onClose: () => void, returnTo?: HTMLElement | SVGElement | null, initial?: string, modal = true) {
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const active = document.activeElement;
    const opener = returnTo ?? (active instanceof HTMLElement || active instanceof SVGElement ? active : null);
    const el = root.current;
    if (!el) return undefined;
    traps.push(el);
    const first = (initial ? el.querySelector<HTMLElement>(initial) : null) ?? focusables(el)[0] ?? el;
    if (first === el) el.tabIndex = -1;
    first.focus();
    const onKey = (e: KeyboardEvent) => {
      if (traps[traps.length - 1] !== el || e.defaultPrevented || (!modal && !el.contains(document.activeElement))) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      } else if (e.key === "Tab") {
        const items = focusables(el);
        if (!items.length) {
          e.preventDefault();
          return;
        }
        const active = document.activeElement;
        const edge = e.shiftKey ? items[0] : items[items.length - 1];
        if (active === edge || !el.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? items[items.length - 1] : items[0])?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      traps.splice(traps.indexOf(el), 1);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
}

interface DialogProps {
  label: string;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  returnTo?: HTMLElement | SVGElement | null;
  initial?: string;
  className?: string;
  /** A non-modal panel floats over the canvas without a scrim, leaving the rails usable. */
  modal?: boolean;
  children: ComponentChildren;
}

/** A modal dialog over a scrim (paper-tinted, never a shadow), or a floating non-modal panel. */
export function Dialog({ label, role = "dialog", onClose, returnTo, initial, className, modal = true, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Focus starts on the first thing to fill in or press below the heading, never on Close.
  useTrap(ref, onClose, returnTo, initial ?? FIRST_IN_BODY, modal);
  const box = (
    <div ref={ref} role={role} aria-modal={modal ? "true" : undefined} aria-label={label} class={`dialog ${modal ? "" : "floating"} ${className ?? ""}`}>
      <header class="dialog-head">
        <h2>{label}</h2>
        <button type="button" class="icon-button" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>
      {children}
    </div>
  );
  if (!modal) return box;
  return (
    <div class="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      {box}
    </div>
  );
}

/** Calls `onOutside` when a pointer goes down outside the element. */
export function useOutside(ref: { current: HTMLElement | null }, onOutside: () => void) {
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, []);
}
