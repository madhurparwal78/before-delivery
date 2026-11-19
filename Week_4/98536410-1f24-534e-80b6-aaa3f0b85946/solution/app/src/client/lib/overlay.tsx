// Sheets, dialogs and panels: data-state opening → open → closing → closed, a Tab trap, Escape,
// and focus returned to the control that opened them.
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MOTION, commit, reducedMotion } from "./motion";

type OverlayState = "opening" | "open" | "closing" | "closed";

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    if (element.closest("[inert]") || element.hasAttribute("disabled") || element.getAttribute("tabindex") === "-1") return false;
    if (element instanceof HTMLInputElement && element.type === "hidden") return false;
    return element.getClientRects().length > 0;
  });
}

const stack: symbol[] = [];
let locks = 0;

function lockScroll(on: boolean): void {
  locks += on ? 1 : -1;
  document.documentElement.classList.toggle("scroll-locked", locks > 0);
}

interface OverlayProps {
  open: boolean;
  label: string;
  role: "dialog" | "alertdialog" | "region" | "status";
  onClose: () => void;
  /** The control that opened it; focus returns here when it starts closing. */
  opener?: RefObject<HTMLElement | null>;
  /** A dialog restored by a reload or a returning session reports open from its first frame. */
  restored?: boolean;
  modal?: boolean;
  className?: string;
  /** Selector of the control that takes focus first; the first focusable control when omitted. */
  initialFocus?: string | null;
  onState?: (state: OverlayState) => void;
  children: ReactNode;
  id?: string;
  /** Keeps focus where the owner put it instead of moving it on open. */
  keepFocus?: boolean;
  /** A band or notice: it has states but takes no focus, no Escape and no Tab trap. */
  passive?: boolean;
  /** Tab wraps inside the overlay; false for a panel whose controls sit in the page's Tab order. */
  trap?: boolean;
}

export function Overlay(props: OverlayProps) {
  const { open, label, role, onClose, opener, restored = false, modal = true, className, initialFocus, onState, children, id, keepFocus, passive = false, trap = true } = props;
  const [state, setState] = useState<OverlayState>(open ? (restored || reducedMotion() ? "open" : "opening") : "closed");
  const timer = useRef<number | undefined>(undefined);
  const node = useRef<HTMLDivElement | null>(null);
  const token = useRef(Symbol("overlay"));
  const remembered = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    onState?.(state);
  }, [state, onState]);

  // desired open/closed drives the state machine; a timer from an earlier transition never wins
  useLayoutEffect(() => {
    window.clearTimeout(timer.current);
    if (open) {
      if (state === "closed") {
        remembered.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setState(restored || reducedMotion() ? "open" : "opening");
      } else if (state === "closing") {
        setState("open");
      } else if (state === "opening") {
        timer.current = window.setTimeout(() => commit(() => setState("open")), MOTION.sheetMs);
      }
    } else if (state === "opening" || state === "open") {
      if (!passive) returnFocus();
      if (reducedMotion()) setState("closed");
      else {
        setState("closing");
      }
    } else if (state === "closing") {
      timer.current = window.setTimeout(() => commit(() => setState("closed")), MOTION.sheetMs);
    }
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state]);

  function returnFocus(): void {
    const target = opener?.current ?? remembered.current;
    if (target && target.isConnected) target.focus();
  }

  // stack membership, scroll lock and first focus
  useLayoutEffect(() => {
    if (state === "closed" || passive) return undefined;
    const mine = token.current;
    stack.push(mine);
    if (modal) lockScroll(true);
    const root = node.current;
    if (root && !keepFocus && state !== "closing" && !root.contains(document.activeElement)) {
      const wanted = initialFocus === undefined ? focusables(root)[0] : initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null;
      wanted?.focus();
    }
    return () => {
      stack.splice(stack.indexOf(mine), 1);
      if (modal) lockScroll(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state === "closed"]);

  useEffect(() => {
    if (state === "closed" || passive) return undefined;
    const keydown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token.current || event.defaultPrevented) return;
      const root = node.current;
      if (!root) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === "Tab" && trap) {
        const items = focusables(root);
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          event.preventDefault();
        } else if (!root.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [state === "closed"]);

  if (state === "closed") return null;
  return (
    <div
      ref={node}
      id={id}
      role={role}
      aria-label={label}
      aria-modal={role === "dialog" || role === "alertdialog" ? modal : undefined}
      data-state={state}
      inert={state === "closing"}
      className={className}
    >
      {children}
    </div>
  );
}
